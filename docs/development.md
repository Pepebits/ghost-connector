# Development

## How it works

Each post goes through:

1. **WriterAgent**: completes the draft (*draft* mode) or improves an
   already written version (*improve* mode; `auto` decides based on the
   `#ai-processed` tag or length). It doesn't make up facts: it marks gaps
   with `[[PENDING: …]]`. The editor's instructions override the rules.
2. **SeoAgent** and **ImageAgent**, in parallel: meta title/description,
   slug, tags and excerpt; and an image plan (stock search or generation).
3. **Merge**: builds Ghost's `PUT` and merges tags (Ghost replaces the whole
   list on every update).
4. **Write-back** (`apply`): re-reads the post, aborts if it changed since the
   plan and writes with `save_revision=true`, always as a draft.

`plan` never writes to Ghost: it saves a *run* (JSON artifact) in
`DATA_DIR`. Review, editing and `apply` all work on that run.

Agents call the model through an `LlmProvider` (`src/agents/providers/`):
`openai-compatible` (Chat Completions, with `strict` tool calling; DeepSeek
tweaks kick in when the URL is api.deepseek.com) and `anthropic` (Messages
API, forced tool and cacheable system prompt). The runner is the same for
all: it validates with Zod and, on failure, retries once feeding the error
back to the model. Each call reports the model used and its cost
(`src/agents/pricing.ts` + `AI_PRICES`). Blog-specific context
(`SITE_CONTEXT`) is appended at the end of the system prompt so the cacheable
prefix doesn't change.

The UI is a thin layer over the same core as the CLI: server-rendered
(Fastify + `html` templates with escaping by default), no SPA and no frontend
build beyond CSS. Long-running work (`plan`, `apply`, `sync`) runs as
background jobs with SSE events; each post saves its result as soon as it
finishes, and on restart a half-done job is marked `interrupted` (never
blindly resumed). An advisory lock in `DATA_DIR` keeps the CLI and the UI from
writing the same post at once.

## Layout

```
src/
  index.ts        CLI (setup, list, status, plan, diff, apply, resolve, reindex, serve)
  config.ts       Zod-validated config; where config and data live (APP_HOME)
  setup/          interactive `setup` wizard
  settings/       .env editing from the UI and connection tests
  agents/         runner (strict tool calling), the 4 agents, factory prompts
                  and edited versions (prompts.ts)
  ghost/          Admin API client, JWT, posts, images, draft filter
  i18n/           UI translations (locales/<lang>/*.json)
  images/         providers (Unsplash, Pixabay, Pexels, Openverse, Wikimedia Commons + OAuth2, generation)
  orchestrator/   pipeline (plan), merge, write-back (apply), plan editing and review
  review/         saved runs, block diff, quality checklist, learning
  state/          real state of each post and review queue
  db/             derived SQLite index (rebuildable with `reindex`)
  jobs/           background job queue, SSE events, live draft
  web/            server, views, static files (public/), brand (brand/), styles.css
  util/           retries, limiters, markdown, lock, pending markers
scripts/          smoke-ghost, seed-test-post, test:writer/pipeline/image, copy-assets
tests/            vitest
```

## Development commands

```bash
npm run dev -- <command>   # CLI with tsx (builds the CSS first)
npm run css:watch          # rebuilds the CSS when views or styles.css change
npm test                   # vitest
npm run typecheck          # tsc --noEmit
npm run build              # dist/ ready to ship (see below)
npm run smoke:ghost        # checks the Ghost connection by listing drafts
```

## Styles

Tailwind CSS v4. The source is `src/web/styles.css` (color tokens for light
and dark, base and components) and it compiles to `src/web/public/app.css`,
which isn't versioned. `npm run dev` and `npm run build` compile it for you.

A Tailwind class must appear in full in the code to be generated: don't glue
it to a template expression (`p-5${x}` doesn't work; `p-5 ${x}` does).

## Interface languages

The UI is in English (default) and Spanish. Strings live in
`src/i18n/locales/<lang>/<area>.json` and are used with `t('area.key')` in
views and `window.gcT('area.key')` in `public/*.js`. Variables use
`{name}`; plurals use an object `{ "one": …, "other": … }` with `{ count }`.
Anything missing in a language falls back to English. URL parameters are
always in English.

To add a language, copy `locales/en/` to `locales/<code>/` and translate the
values: it appears automatically in Settings → Language and in the palette.
The active language is `UI_LANGUAGE` (`.env`). It doesn't change the language
of posts or prompts.

## Build

`npm run build` wipes `dist/`, compiles `src/` with `tsconfig.build.json` and
copies what the code reads from disk at runtime: the factory prompts,
`web/public/` (with the compiled CSS), `web/brand/` and the locales.
`npm pack` runs the build and produces the package; the binary is
`ghost-connector`.

## Tests

Tests use a fake config and a temporary `DATA_DIR` per run
(`tests/setup.ts`): they never touch your `.env`, your data, or real Ghost or
AI. They cover, among others, post state derivation, block diffing, HTML
escaping, `.env` editing, two-layer prompts, the draft filter, image
attribution and server protections (authentication, CSRF/Host, no secret
reaching the HTML), using `app.inject()` without opening ports.

## Releases

1. Add the version's section to `CHANGELOG.md` (`## [1.2.0] — YYYY-MM-DD`,
   with `### Added`, `### Changed`, `### Fixed`, `### Security`…) and its
   compare link at the bottom.
2. Bump `version` in `package.json` (`npm version 1.2.0 --no-git-tag-version`):
   it's what the panel shows in its footer.
3. Commit (`chore(release): 1.2.0`), then tag that commit and push the tag:

```bash
git tag -a v1.2.0 -m "v1.2.0"
git push origin v1.2.0
```

The release refuses to start if the tag doesn't match `package.json` or the
changelog has no section for it. The GitHub release notes and the Telegram
announcement are that changelog section.

`.github/workflows/release.yml` then runs the checks (typecheck, tests,
build), publishes the Docker image to Docker Hub (`pepebits/ghost-connector`)
and GHCR (`ghcr.io/pepebits/ghost-connector`) as `1.2.0`, `1.2` and `latest`
(amd64 and arm64), creates the GitHub release
from the changelog section and announces it with
[Pepebits/release-announce](https://github.com/Pepebits/release-announce).
In the notes, titled lists ("Added", "Fixed", "Security"…) become collapsible
sections with their emoji.

The release also writes the Docker Hub overview from `docs/dockerhub.md`
(one text per Docker Hub repository, so it always matches the published
image). To fix it without a release, run *Actions → Docker Hub overview*
by hand.

Secrets, usually at the organization: `DOCKERHUB_USERNAME` and
`DOCKERHUB_TOKEN` (a Docker Hub access token with read/write) to publish, and
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (`TELEGRAM_TEST_CHAT_ID` for
tests) to announce; without the Telegram ones nothing is sent and the release
is unaffected. GHCR uses the workflow's own token. To try it or
re-announce a release, run the workflow by hand (*Actions → Release → Run
workflow*) with `dry_run` on, which only prints the message, or with
`chat: test`.

## Keeping it secure and up to date

Images go stale even when the code doesn't change: new vulnerabilities are
found in the base image (Alpine, Node) and in dependencies every week.
Three automations keep up with that:

| What | Where | When |
|---|---|---|
| **Dependabot** proposes updates: npm dependencies (minor and patch grouped), the Node base image (pinned by digest in the `Dockerfile`, Node 24 only) and the GitHub Actions (pinned by SHA) | `.github/dependabot.yml` | Mondays |
| **CI** type-checks, tests, builds, checks that the image starts and scans it with Trivy; a Dependabot PR can only be merged when it's green | `.github/workflows/ci.yml` | Every PR and push to `main` |
| **Image scan** of the published `pepebits/ghost-connector:latest`; if a HIGH/CRITICAL vulnerability with a fix shows up, it opens (or updates) an issue labelled `security` | `.github/workflows/image-scan.yml` | Mondays, or by hand |

When that issue appears: merge the pending Dependabot PRs and cut a patch
release (see [Releases](#releases)); the next weekly scan closes the issue. The release rebuilds the image from scratch
with the OS updates, scans it again (it isn't published if anything fixable
is left) and publishes it with an SBOM and a build provenance attestation.
