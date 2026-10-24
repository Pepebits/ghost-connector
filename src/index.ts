#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import pLimit from 'p-limit';
import type { PendingQA } from './agents/resolve.agent.js';
import { getConfig } from './config.js';
import { clearArtifactIndex, upsertArtifactIndex } from './db/repo.js';
import { listDrafts, readDraft, readRawPost } from './ghost/posts.js';
import { logger } from './logger.js';
import { assertBudget } from './agents/budget.js';
import { processDraft } from './orchestrator/pipeline.js';
import { commitResolve, previewResolve } from './orchestrator/resolveFlow.js';
import { applyArtifact } from './orchestrator/writeback.js';
import { renderDiff } from './review/diff.js';
import { listAllArtifacts, listArtifacts, loadArtifact, newRunId, saveArtifact } from './review/store.js';
import { readPostSummaries, syncPostStates, type PostSummary } from './state/postState.js';
import { extractPendingQuestions } from './util/pending.js';

// Everything this tool writes (data, plans, images, backups, .env) is private to its user.
process.umask(0o077);

const program = new Command();
program
  .name('ghost-connector')
  .description('Ghost connector with AI subagents (multi-model). Never publishes: it only leaves updated drafts in draft status.');

program
  .command('setup')
  .description('Interactive wizard: configure Ghost, the AI and images (tests each connection) without editing the .env by hand')
  .action(async () => {
    const { runSetup } = await import('./setup/wizard.js');
    await runSetup();
  });

program
  .command('list')
  .description('List the drafts matching DRAFT_FILTER (.env)')
  .option('--filter <nql>', 'NQL filter for this run (default: DRAFT_FILTER from .env)')
  .action(async (opts: { filter?: string }) => {
    const drafts = await listDrafts({ filter: opts.filter });
    for (const d of drafts) {
      console.log(`${d.id}  ${d.updated_at}  ${d.title}`);
    }
    console.log(`\n${drafts.length} draft(s).`);
  });

function summaryLine(s: PostSummary): string {
  const issueTag = s.issues.length > 0 ? ` [${s.issues.length} issue(s)]` : '';
  const pendingTag = s.pendingCount > 0 ? ` [${s.pendingCount} pending]` : '';
  return `${s.id}  ${s.kind.padEnd(16)}${issueTag}${pendingTag}  ${s.title}`;
}

program
  .command('status')
  .description('Draft status. Reads the local index by default (fast, no network); --sync re-reads Ghost.')
  .option('--sync', 'Ignore the local index and re-read Ghost before showing the status')
  .option('--filter <nql>', 'NQL filter for --sync (default: DRAFT_FILTER from .env)')
  .option('--kind <kind>', 'Filter by kind: never-planned|planned|plan-stale|applied|applied-degraded|has-pending|blocked|failed')
  .option('--json', 'Output JSON instead of a table')
  .action(async (opts: { sync?: boolean; filter?: string; kind?: string; json?: boolean }) => {
    let summaries: PostSummary[] = opts.sync ? [] : readPostSummaries();

    if (opts.sync || summaries.length === 0) {
      if (!opts.sync) logger.warn('Local index empty; syncing with Ghost (this repopulates it for next time).');
      const states = await syncPostStates({ filter: opts.filter });
      summaries = states.map((s) => ({
        id: s.post.id,
        title: s.post.title,
        slug: s.post.slug,
        url: s.post.url,
        updatedAt: s.post.updatedAt,
        featureImage: s.post.featureImage,
        wordCount: s.post.wordCount,
        tags: s.post.tags,
        aiProcessed: s.post.aiProcessed,
        pendingCount: s.live.pendingQuestions.length,
        kind: s.kind,
        issues: s.issues,
        syncedAt: s.syncedAt,
      }));
    }

    const filtered = opts.kind ? summaries.filter((s) => s.kind === opts.kind) : summaries;

    if (opts.json) {
      console.log(JSON.stringify(filtered, null, 2));
      return;
    }

    for (const s of filtered) console.log(summaryLine(s));
    console.log(`\n${filtered.length}/${summaries.length} draft(s)${opts.kind ? ` with kind="${opts.kind}"` : ''}.`);
  });

program
  .command('reindex')
  .description('Rebuild the SQLite index (<DATA_DIR>/index.db) from the saved artifacts. Never touches Ghost.')
  .action(async () => {
    clearArtifactIndex();
    const all = await listAllArtifacts();
    for (const a of all) upsertArtifactIndex(a);
    console.log(`Indexed ${all.length} artifacts. Run "status --sync" to repopulate posts_live too.`);
  });

program
  .command('plan')
  .description('Run the subagents (writing/SEO/image) over drafts. Writes nothing to Ghost.')
  .option('--post <id>', 'Process a single post by id')
  .option('--posts <ids>', 'Process several posts by id, comma-separated')
  .option('--limit <n>', 'Maximum number of posts to process', (v) => Number.parseInt(v, 10))
  .option('--filter <nql>', 'Filtro NQL para esta ejecucion (por defecto, DRAFT_FILTER de .env)')
  .option('--instructions <text>', 'Extra instructions for the WriterAgent in this plan')
  .action(async (opts: { post?: string; posts?: string; limit?: number; filter?: string; instructions?: string }) => {
    const cfg = getConfig();
    const runId = newRunId();
    const filter = opts.filter ?? cfg.DRAFT_FILTER;
    const explicitIds = opts.posts
      ? opts.posts.split(',').map((s) => s.trim()).filter(Boolean)
      : opts.post
        ? [opts.post]
        : null;
    const drafts = explicitIds
      ? await Promise.all(explicitIds.map((id) => readDraft(id)))
      : await listDrafts({ filter, limit: opts.limit ?? cfg.MAX_POSTS_PER_RUN });

    if (drafts.length === 0) {
      logger.warn({ filter }, 'No drafts match the filter.');
      return;
    }

    logger.info(
      { runId, count: drafts.length, concurrency: cfg.CONCURRENCY, instructions: opts.instructions ?? null },
      'Starting plan (dry-run, does not write to Ghost)',
    );
    // Bounded concurrency across POSTS; within each post, the limiters in
    // src/util/limiter.ts further bound concurrency toward each API.
    const limit = pLimit(cfg.CONCURRENCY);
    await Promise.all(
      drafts.map((draft) =>
        limit(async () => {
          try {
            assertBudget();
          } catch (err) {
            logger.warn({ id: draft.id }, (err as Error).message);
            return;
          }
          logger.info({ id: draft.id, title: draft.title }, 'Processing draft');
          const artifact = await processDraft(runId, draft, { extraInstructions: opts.instructions });
          const filePath = await saveArtifact(artifact);
          logger.info(
            { id: draft.id, status: artifact.status, usd: artifact.cost.usd.toFixed(5), filePath },
            'Artifact saved',
          );
        }),
      ),
    );
    console.log(`\nRun: ${runId}`);
    console.log(`Review with: npm run dev -- diff --run ${runId}`);
  });

program
  .command('diff')
  .description('Show the readable diff of a run saved in DATA_DIR')
  .requiredOption('--run <runId>', 'Run id')
  .option('--post <id>', 'Show only one post from that run')
  .action(async (opts: { run: string; post?: string }) => {
    const artifacts = opts.post ? [await loadArtifact(opts.run, opts.post)] : await listArtifacts(opts.run);
    for (const artifact of artifacts) {
      console.log(renderDiff(artifact));
      console.log(`\n${'-'.repeat(80)}\n`);
    }
  });

program
  .command('apply')
  .description('Write the changes of an already planned run to Ghost. Asks for confirmation unless --yes. Never publishes (always stays in draft).')
  .requiredOption('--run <runId>', 'Run id')
  .option('--post <id>', 'Apply a single post from that run')
  .option('--yes', 'Do not ask for interactive confirmation')
  .option('--allow-pending', 'Allow applying even if the text has unresolved [[PENDING:]] markers')
  .option('--auto-image', 'If you did not pick an image in the UI, use the first one found (without this, it is applied without an image)')
  .option('--allow-links', 'Allow applying even if the text has links that come from no known source (review them first with diff)')
  .action(async (opts: { run: string; post?: string; yes?: boolean; allowPending?: boolean; allowLinks?: boolean; autoImage?: boolean }) => {
    const artifacts = opts.post ? [await loadArtifact(opts.run, opts.post)] : await listArtifacts(opts.run);
    const planned = artifacts.filter((a) => a.status === 'planned');

    if (planned.length === 0) {
      logger.warn({ run: opts.run }, 'No artifacts with status "planned" to apply in this run.');
      return;
    }

    console.log(`About to apply ${planned.length} post(s) from run ${opts.run} (they stay in draft, never published):\n`);
    for (const a of planned) console.log(`  - ${a.postId}  ${a.postTitle}`);

    if (!opts.yes) {
      const { createInterface } = await import('node:readline/promises');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question('\nType "apply" to confirm (anything else cancels): ');
      rl.close();
      if (answer.trim().toLowerCase() !== 'apply') {
        console.log('Cancelled. Nothing was written to Ghost.');
        return;
      }
    }

    for (const artifact of planned) {
      const result = await applyArtifact(artifact, { allowPending: opts.allowPending, allowUnknownLinks: opts.allowLinks, autoImage: opts.autoImage });
      logger.info({ id: artifact.postId, title: artifact.postTitle, ...result }, 'Apply result');
    }
  });

program
  .command('resolve')
  .description(
    'Answer the [[PENDING:]] markers of a real Ghost post and rewrite only those parts of the content.',
  )
  .requiredOption('--post <id>', 'Post id in Ghost')
  .option('--yes', 'Do not ask for confirmation before writing to Ghost')
  .option('--dry-run', 'Generate and show the result but write nothing to Ghost')
  .option(
    '--answers-file <path>',
    'JSON with the answers instead of asking interactively: {"0": "answer to question 1", ...} (0-based indexes; missing ones stay unanswered)',
  )
  .action(async (opts: { post: string; yes?: boolean; dryRun?: boolean; answersFile?: string }) => {
    const fresh = await readRawPost(opts.post);
    if (fresh.status !== 'draft') {
      logger.warn({ id: opts.post, status: fresh.status }, 'The post is not a draft; resolve only works on drafts.');
      return;
    }

    const questions = extractPendingQuestions(fresh.html ?? '');
    if (questions.length === 0) {
      console.log(`"${fresh.title}" has no [[PENDING:]] markers. Nothing to resolve.`);
      return;
    }

    console.log(`Found ${questions.length} pending item(s) in "${fresh.title}":`);

    const qas: PendingQA[] = [];
    if (opts.answersFile) {
      const answersByIndex = JSON.parse(await readFile(opts.answersFile, 'utf8')) as Record<string, string>;
      questions.forEach((question, i) => qas.push({ question, answer: answersByIndex[String(i)] ?? '' }));
    } else {
      const { createInterface } = await import('node:readline/promises');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      for (const [i, question] of questions.entries()) {
        console.log(`\n[${i + 1}/${questions.length}] ${question}`);
        const answer = await rl.question('Your answer (Enter to leave it pending): ');
        qas.push({ question, answer });
      }
      rl.close();
    }

    if (qas.every((qa) => !qa.answer.trim())) {
      console.log('\nNo answers given. Cancelled; the agent was not called and nothing was written.');
      return;
    }

    const preview = await previewResolve(opts.post, qas);

    console.log(
      `\nResolved: ${qas.filter((qa) => qa.answer.trim()).length}/${questions.length}. Still pending: ${preview.unresolved.length}.`,
    );
    for (const c of preview.changesMade) console.log(`  - ${c}`);
    logger.info(preview.usage, 'Token usage (resolve)');

    if (opts.dryRun) {
      console.log('\n--- RESULTING MARKDOWN (dry-run, nothing was written) ---\n');
      console.log(preview.markdown);
      return;
    }

    if (!opts.yes) {
      const { createInterface } = await import('node:readline/promises');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const confirm = await rl.question('\nType "apply" to save this change to Ghost (draft, with revision): ');
      rl.close();
      if (confirm.trim().toLowerCase() !== 'apply') {
        console.log('Cancelled. Nothing was written to Ghost.');
        return;
      }
    }

    const answered = qas.filter((qa) => qa.answer.trim()).length;
    const commit = await commitResolve(opts.post, preview.html, preview.snapshotUpdatedAt, {
      answered,
      unresolved: preview.unresolved.length,
    });
    if (commit.status !== 'applied') {
      logger.warn({ id: opts.post, status: commit.status }, commit.message);
      return;
    }
    logger.info({ id: opts.post }, 'Post updated with the pending items resolved (draft, revision saved).');
  });

program
  .command('serve')
  .description('Start the local web UI (server-rendered, localhost only). Publishes nothing; uses the same core as list/plan/diff/apply.')
  .option('--port <n>', 'Port', (v) => Number.parseInt(v, 10), 4300)
  .option('--host <host>', 'Host to listen on (recommended: 127.0.0.1)', '127.0.0.1')
  .option('--public-url <url>', 'Public address when behind a proxy/tunnel, e.g. https://ghost.example.com (env: PUBLIC_URL)', process.env.PUBLIC_URL)
  .option('--no-open', 'Do not open the browser (it only opens on a local, interactive start)')
  .action(async (opts: { port: number; host: string; publicUrl?: string; open: boolean }) => {
    const { startServer } = await import('./web/server.js');
    const local = (opts.host === '127.0.0.1' || opts.host === 'localhost') && !opts.publicUrl && process.stdout.isTTY;
    await startServer({ port: opts.port, host: opts.host, publicUrl: opts.publicUrl, sessionToken: process.env.WEB_SESSION_TOKEN || undefined, open: opts.open && local });
  });

program
  .command('backup')
  .description('Full backup of the data (plans, images, index with users and 2FA) as a .tar.gz, on this machine only. With --with-env it also holds the keys')
  .option('--output <file>', 'Where to write it (default: next to the data folder)')
  .option('--with-env', 'Also include the configuration with the API keys (plain text)')
  .action(async (opts: { output?: string; withEnv?: boolean }) => {
    const { createWriteStream } = await import('node:fs');
    const { dirname, join, resolve } = await import('node:path');
    const { pipeline } = await import('node:stream/promises');
    const { backupFileName, createBackup } = await import('./settings/backup.js');
    const { envFilePath, getConfig } = await import('./config.js');
    const out = resolve(opts.output ?? join(dirname(resolve(getConfig().DATA_DIR)), backupFileName()));
    // 0600: it holds password hashes and 2FA secrets (and keys with --with-env).
    await pipeline(createBackup({ includeEnv: !!opts.withEnv, envPath: envFilePath() }), createWriteStream(out, { mode: 0o600, flags: 'wx' }));
    console.log(`Backup written: ${out}${opts.withEnv ? '\nIt includes the API keys: keep it somewhere safe.' : ''}\nTo restore: stop the panel and extract it into the data folder (${getConfig().DATA_DIR}).`);
  });

const authCmd = program.command('auth').description('Panel users: add, remove, roles, passwords and two-step verification (also for when you are locked out)');

/** The named user, or the only one when there is just one. */
async function pickUser(username: string | undefined) {
  const { findUser, listUsers } = await import('./auth/store.js');
  if (username) {
    const u = findUser(username);
    if (!u) throw new Error(`No user "${username}". See: ghost-connector auth users`);
    return u;
  }
  const all = listUsers();
  if (all.length === 1) return all[0]!;
  throw new Error(all.length ? 'Say which user (ghost-connector auth users lists them)' : 'There are no users yet: ghost-connector auth add-user <name>');
}

async function askNewPassword(): Promise<string> {
  const { MIN_PASSWORD } = await import('./auth/store.js');
  const password = await promptHidden(`New password (min ${MIN_PASSWORD} characters): `);
  if ((await promptHidden('Repeat it: ')) !== password) throw new Error('The passwords do not match');
  return password;
}

const parseRole = (v: string) => {
  if (v !== 'admin' && v !== 'editor') throw new Error('The role must be admin or editor');
  return v as 'admin' | 'editor';
};

authCmd
  .command('users')
  .description('List the panel users')
  .action(async () => {
    const { listUsers } = await import('./auth/store.js');
    const users = listUsers();
    if (!users.length) return console.log('No users yet. The first one is created when the panel starts, or: ghost-connector auth add-user <name>');
    for (const u of users) console.log(`${u.username.padEnd(24)} ${u.role.padEnd(7)} 2FA ${u.totp ? 'on ' : 'off'}  sessions ${u.sessions}`);
  });

authCmd
  .command('add-user <username>')
  .description('Create a user (the first one is always the owner)')
  .option('--role <role>', 'admin or editor', parseRole, 'editor')
  .action(async (username: string, opts: { role: 'admin' | 'editor' }) => {
    const { createUser } = await import('./auth/store.js');
    const user = await createUser(username, await askNewPassword(), opts.role);
    console.log(`User "${user.username}" created (${user.role}).`);
  });

authCmd
  .command('remove-user <username>')
  .description('Delete a user and close their sessions (never the last admin)')
  .action(async (username: string) => {
    const { deleteUser } = await import('./auth/store.js');
    const u = await pickUser(username);
    deleteUser(u.id);
    console.log(`User "${u.username}" deleted.`);
  });

authCmd
  .command('set-role <username> <role>')
  .description('Change a user\'s role: admin or editor (never leaves the panel without an admin)')
  .action(async (username: string, role: string) => {
    const { setRole } = await import('./auth/store.js');
    const u = await pickUser(username);
    setRole(u.id, parseRole(role));
    console.log(`"${u.username}" is now ${role}.`);
  });

authCmd
  .command('transfer-owner <username>')
  .description('Make a user the owner (keys, export/import, admins); the current owner becomes admin')
  .action(async (username: string) => {
    const { transferOwnership } = await import('./auth/store.js');
    const u = await pickUser(username);
    transferOwnership(u.id);
    console.log(`"${u.username}" is now the owner.`);
  });

authCmd
  .command('password [username]')
  .description('Set a new password for a user (closes their sessions)')
  .action(async (username?: string) => {
    const { setPassword } = await import('./auth/store.js');
    const u = await pickUser(username);
    await setPassword(u.id, await askNewPassword());
    console.log(`Password of "${u.username}" saved. Their sessions were closed.`);
  });

authCmd
  .command('reset-2fa [username]')
  .description('Disable a user\'s two-step verification (lost phone and no recovery codes)')
  .action(async (username?: string) => {
    const { disableTotp, revokeAllSessions } = await import('./auth/store.js');
    const u = await pickUser(username);
    disableTotp(u.id);
    revokeAllSessions(u.id);
    console.log(`Two-step verification of "${u.username}" disabled and their sessions closed. They log in with the password and can enable it again.`);
  });

authCmd
  .command('logout-all [username]')
  .description('Close every open session (of everyone, or of one user)')
  .action(async (username?: string) => {
    const { revokeAllSessions } = await import('./auth/store.js');
    if (username) {
      const u = await pickUser(username);
      revokeAllSessions(u.id);
      return console.log(`Every session of "${u.username}" was closed.`);
    }
    revokeAllSessions();
    console.log('Every session was closed.');
  });

/** Reads a line without echoing it (falls back to a visible prompt without a TTY). */
async function promptHidden(question: string): Promise<string> {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream };
  let muted = false;
  out._writeToOutput = (s: string) => {
    if (!muted || s.includes(question)) out.output.write(s);
  };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

program.parseAsync(process.argv).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  // No config (first start): a clear message instead of the error log.
  if (message.startsWith('Invalid configuration')) {
    console.error(`${message}\n\nTo configure it step by step: ghost-connector setup`);
    process.exitCode = 1;
    return;
  }
  logger.error({ err: message }, 'Command failed');
  process.exit(1);
});
