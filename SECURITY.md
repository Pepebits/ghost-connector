# Security

## Reporting a vulnerability

Don't open a public issue. Use **"Report a vulnerability"** in the
repository's *Security* tab on GitHub (private report). Include the version
you use, steps to reproduce and the impact you see. We'll respond as soon as
we can and, if confirmed, publish a fix and credit you if you wish.

## Security model

Ghost Connector is a **self-hosted** tool for one person or a small team, but with the Ghost Admin
API Key it can write to a real site. The design starts from there:

**It never publishes.** Write-back sets `status: draft`; there's no option to
publish or send a newsletter. Every listing is limited to drafts even if the
configured filter says otherwise, and every `apply` uses
`save_revision=true`, so the previous content stays in Ghost's revision
history.

**The web UI:**

- Listens on `127.0.0.1` by default; a different `--host` prints a warning.
  On a server, put it behind a proxy/tunnel with its own access layer.
- Each user logs in with a username and password (scrypt) and optional,
  recommended TOTP 2FA with single-use recovery codes. Three roles, checked
  on the server (not just hidden in the UI):
  - *owner* (exactly one, the first user; transferable with their
    password): API keys **and the endpoints they are sent to** (Ghost URL, AI
    provider and base URL), export/import, and managing admins;
  - *admin*: the rest of Settings (prompts, behaviour) and managing editors;
    connection tests use the saved configuration, never typed values;
  - *editor*: the editorial work (plan, review, edit, apply, ideas, jobs).

  The owner can't be demoted or deleted, only replaced by a transfer. Jobs
  and applies record who did them, and an activity log (admins only, kept a
  year) records logins, failed attempts and changes to users, settings and
  prompts: only the names of changed keys, never their values or any
  password.
- New users join through single-use invite links (valid 7 days, only their
  hash is stored, revocable); an admin can also issue a single-use link to
  set a new password. Sessions are server-side (only a SHA-256 of the
  `httpOnly`, `SameSite=Lax` cookie is stored), last 30 days and are closed
  when that user's password changes. Failed logins lock that account for 1,
  2, 4… minutes after five tries. Without a session everything redirects to
  `/login` or returns 401 (except `/healthz`, invite links and static files).
- Like Ghost, until the first user exists whoever opens the panel creates
  the admin: create it right after the first start (on a server, before
  exposing the URL, or with `auth add-user`). `WEB_SESSION_TOKEN`, if set on
  purpose, logs in as the first admin. Local starts open the browser with a single-use link
  valid for two minutes, also as the first admin.
- The panel never hands out users, password hashes, 2FA secrets or keys: its
  export carries only workspace data, and an import only adds files matching
  strict paths inside the data folder (plans must match their own post and
  run). The full backup is a server-only command (`ghost-connector backup`,
  file mode 600).
- Every non-GET request requires `Host` and `Origin` to match the local
  server (blocking CSRF and DNS rebinding); otherwise 403.
- HTML is generated with escaping by default. Third-party text (image titles
  and authors) is also escaped in the caption sent to Ghost, and only
  `http(s)` URLs are linked.

**Keys and configuration:**

- Keys are never sent to the browser: the Settings page only lets you
  replace them, and connection-test error messages redact them.
- When testing a connection against a URL other than the saved one, the
  saved key isn't reused: you must enter the key for that server.
- The configuration file is written atomically with `0600` permissions, fully
  validated before saving, and line breaks are rejected (they would allow
  injecting other variables).
- Logs redact keys (`src/logger.ts`).
- `.env` is in `.gitignore`; never commit it.

**Local database:** every SQL query uses parameters; the only interpolated
parts (column names in migrations) are validated against a closed list.

## Web content (prompt injection)

When you provide links as sources, the connector downloads those pages and
their text reaches the AI. A page may try to give it orders. Defenses, from
weakest to strongest:

- **Sanitizing**: HTML comments, hidden elements and invisible characters are
  stripped; lines that look like instructions for an AI are removed and the
  source is flagged under *Sources read*.
- **Delimiting**: each source is wrapped in `<fuente_no_confiable>` and the
  prompt says it's data only. It helps, but a model can ignore it.
- **Checked links**: `apply` is blocked if the text contains links or images
  that don't come from the draft, your instructions or answers, or the sources
  read (and the links they contain). They're reviewed and allowed by hand
  (`--allow-links` in the CLI). This doesn't depend on the model.
- **No tools**: agents only return text; they don't browse, don't write to
  Ghost and don't see your keys. Everything goes through your review and
  stays a draft.

Only http(s) URLs on public hosts are fetched (no `localhost` or private
networks), with a timeout and a size limit.

## If a key leaks

- **Ghost Admin API Key**: equivalent to full write access to the site.
  Revoke it in Ghost Admin → *Settings → Integrations* (delete the
  integration or regenerate the key) and configure the new one with `setup`.
- **AI, Unsplash, Pixabay, Pexels or Openverse key**: revoke it in the provider's
  dashboard and replace it from Settings or with `setup`.
