import { createInterface, type Interface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { AI_DEFAULTS, AI_PROVIDERS, envFilePath, type AiProvider } from '../config.js';
import { testConnection, type TestableService } from '../settings/connectionTest.js';
import { EnvValidationError, saveEnv, type EnvSubmission } from '../settings/envFile.js';

/**
 * `ghost-connector setup`: interactive wizard so you don't have to edit the
 * .env by hand. Asks for what is needed (Enter = keep the current value),
 * hides keys while typing, tests each connection before moving on and
 * saves with the same saveEnv as the Settings page (full validation,
 * atomic write, 0600 permissions). Ctrl+C exits without writing anything.
 */

const c = {
  bold: (s: string) => (stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  ok: (s: string) => (stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  err: (s: string) => (stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s),
};

class SetupAborted extends Error {}

/** Reads a line without echoing it (one dot per character). Backspace deletes; Ctrl+C aborts. */
function readSecret(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    let value = '';
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\u0003') {
          cleanup();
          stdout.write('\n');
          return reject(new SetupAborted());
        }
        if (ch === '\r' || ch === '\n') {
          cleanup();
          stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }
        if (ch >= ' ') {
          value += ch;
          stdout.write('•');
        }
      }
    };
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
    };
    stdin.on('data', onData);
  });
}

interface Asker {
  text(label: string, current?: string, opts?: { optional?: boolean }): Promise<string>;
  secret(label: string, isSet: boolean, opts?: { optional?: boolean }): Promise<string>;
  choice(label: string, options: string[], current: string): Promise<string>;
  yesNo(label: string, current: boolean): Promise<boolean>;
  close(): void;
}

function makeAsker(): Asker {
  let rl: Interface | null = null;
  const line = () => (rl ??= createInterface({ input: stdin, output: stdout }));
  // readline and raw mode don't mix: the interface is closed before asking for a secret.
  const pauseLine = () => {
    rl?.close();
    rl = null;
  };
  const ask = async (q: string) => {
    try {
      return (await line().question(q)).trim();
    } catch {
      throw new SetupAborted();
    }
  };
  return {
    async text(label, current, opts) {
      const hint = current ? c.dim(` [${current}]`) : opts?.optional ? c.dim(' (Enter to skip)') : '';
      for (;;) {
        const v = await ask(`  ${label}${hint}: `);
        if (v) return v;
        if (current) return current;
        if (opts?.optional) return '';
        console.log(c.err('    Required.'));
      }
    },
    async secret(label, isSet, opts) {
      const hint = isSet ? c.dim(' [set · Enter to keep it]') : opts?.optional ? c.dim(' (Enter to skip)') : '';
      pauseLine();
      for (;;) {
        const v = (await readSecret(`  ${label}${hint}: `)).trim();
        if (v || isSet || opts?.optional) return v;
        console.log(c.err('    Required.'));
      }
    },
    async choice(label, options, current) {
      for (;;) {
        const v = (await ask(`  ${label} (${options.join(' / ')})${c.dim(` [${current}]`)}: `)) || current;
        if (options.includes(v)) return v;
        console.log(c.err(`    Choose one of: ${options.join(', ')}.`));
      }
    },
    async yesNo(label, current) {
      const v = (await ask(`  ${label} ${c.dim(current ? '[Y/n]' : '[y/N]')}: `)).toLowerCase();
      if (!v) return current;
      return v.startsWith('s') || v.startsWith('y');
    },
    close() {
      pauseLine();
    },
  };
}

/** Tests a service with what has been collected so far; on failure, offers to repeat the section. */
async function check(service: TestableService, answers: EnvSubmission, ask: Asker): Promise<boolean> {
  stdout.write(c.dim('  Testing connection… '));
  const r = await testConnection(service, answers);
  console.log(r.ok ? c.ok(`✓ ${r.message}`) : c.err(`✗ ${r.message}`));
  if (r.ok) return true;
  return !(await ask.yesNo('Enter these details again?', true));
}

export async function runSetup(): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('setup needs an interactive terminal. Without one, copy .env.example and fill it in by hand.');
  }
  const env = process.env;
  const answers: EnvSubmission = {};
  const ask = makeAsker();

  console.log(`\n${c.bold('Ghost Connector · setup')}`);
  console.log(c.dim(`Will be saved to ${envFilePath()}. Enter keeps the current value; Ctrl+C exits without saving.\n`));

  try {
    console.log(c.bold('1/4 Ghost'));
    for (;;) {
      answers.GHOST_API_URL = (await ask.text('Site URL', env.GHOST_API_URL)).replace(/\/+$/, '');
      answers.GHOST_ADMIN_API_KEY = await ask.secret('Admin API Key (Ghost → Integrations, format id:secret)', !!env.GHOST_ADMIN_API_KEY);
      if (await check('ghost', answers, ask)) break;
    }

    console.log(`\n${c.bold('2/4 AI')}`);
    for (;;) {
      answers.AI_PROVIDER = await ask.choice('Provider', [...AI_PROVIDERS], env.AI_PROVIDER ?? 'deepseek');
      const defaults = AI_DEFAULTS[answers.AI_PROVIDER as AiProvider];
      // If you switch provider, its defaults are proposed, not the previous one's.
      const sameProvider = answers.AI_PROVIDER === (env.AI_PROVIDER ?? 'deepseek');
      answers.AI_BASE_URL = await ask.text('Base URL', (sameProvider && env.AI_BASE_URL) || defaults.baseUrl || undefined);
      answers.AI_API_KEY = await ask.secret('API key', sameProvider && !!env.AI_API_KEY);
      answers.AI_MODEL = await ask.text('Model', (sameProvider && env.AI_MODEL) || defaults.model || undefined);
      if (await check('ai', answers, ask)) break;
    }

    console.log(`\n${c.bold('3/4 Images')} ${c.dim('(optional: without keys Openverse is used)')}`);
    answers.UNSPLASH_ACCESS_KEY = await ask.secret('Unsplash access key', !!env.UNSPLASH_ACCESS_KEY, { optional: true });
    if (answers.UNSPLASH_ACCESS_KEY) await check('unsplash', answers, ask);
    answers.PIXABAY_API_KEY = await ask.secret('Pixabay API key', !!env.PIXABAY_API_KEY, { optional: true });
    if (answers.PIXABAY_API_KEY) await check('pixabay', answers, ask);
    answers.PEXELS_API_KEY = await ask.secret('Pexels API key', !!env.PEXELS_API_KEY, { optional: true });
    if (answers.PEXELS_API_KEY) await check('pexels', answers, ask);
    const openverse = await ask.yesNo('Use Openverse (Creative Commons photos, no key) as a fallback?', env.OPENVERSE_ENABLED !== 'false');
    answers.OPENVERSE_ENABLED = openverse ? 'true' : 'false';

    console.log(`\n${c.bold('4/4 Your blog')}`);
    answers.SITE_CONTEXT = await ask.text('What it is about (topic, audience, language, tone)', env.SITE_CONTEXT, { optional: true });

    // Full form (__full): booleans that are not asked keep their value.
    answers.ALLOW_SLUG_CHANGE = env.ALLOW_SLUG_CHANGE === 'true' ? 'true' : 'false';
    answers.__full = '1';

    console.log('');
    if (!(await ask.yesNo(`Save to ${envFilePath()}?`, true))) {
      console.log('Nothing was saved.');
      return;
    }
    const changed = saveEnv(answers);
    console.log(c.ok(`\n✓ Configuration saved${changed.length ? ` (${changed.length} change(s))` : ' (no changes)'}.`));
    console.log(`  Next step: ${c.bold('ghost-connector serve')} to open the UI, or ${c.bold('ghost-connector list')} to see your drafts.\n`);
  } catch (err) {
    if (err instanceof SetupAborted) {
      console.log('\nCancelled: nothing was saved.');
      return;
    }
    if (err instanceof EnvValidationError) {
      console.error(c.err(`\nNothing was saved. Fix: ${err.issues.map((i) => `${i.key} (${i.message})`).join(', ')}`));
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    ask.close();
  }
}
