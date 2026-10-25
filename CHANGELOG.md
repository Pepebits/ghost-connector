# Changelog

All notable changes to Ghost Connector. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Each release's notes on GitHub and
in the announcement come from its section here.

## [Unreleased]

### Added

- Ghost authors: each panel user has default Ghost authors (one or more, with a primary), set in My account or by an admin in Settings → Users. New posts are credited to them, and the *New post* form lets you change them. A draft's authors show on its page and can be changed there; applying a plan never touches them. The staff list is read from Ghost.
- Results export: *Export CSV* downloads the list as shown (same filter and order), and each post's page downloads its weekly trend and top queries. Built from the saved data, so it doesn't query Google or Bing; text that a spreadsheet would run as a formula is neutralised.

## [0.1.4] — 2026-10-25

### Added

- Costs per user (owner only, from Settings → Usage and cost): AI spend and tokens of each user over 7, 30 or 90 days, against the previous period, broken down by agent and by model, with daily spend, the monthly pace and the most expensive posts. Spend is recorded per user from this version on; automatic work shows as "Automatic".
- Optional daily AI cap per user (`AI_USER_DAILY_BUDGET_USD`, owner-only), on top of the panel's overall cap.
- Results: how published posts do in Google and Bing, the last 28 days against the 28 before, with a 16-week trend that marks when the panel changed each post. Filter by the posts the panel worked on or the whole blog; each post has its own page with its top Google queries. Refreshed by hand, read-only.

### Changed

- Settings → Users: each user's actions are in a gear menu instead of a row of buttons; on phones the 2FA status moves under the name so the table fits.
- Settings → Users: making someone admin or editor asks for confirmation first, like the other user actions.
- Drafts: when a plan isn't applied yet, the words column shows both counts, Ghost's and the plan's (e.g. 0 → 1263), instead of only Ghost's.

### Fixed

- The transfer-ownership dialog shows the password field between the explanation and the buttons, and its text is left-aligned.
- Round avatars stay round in every browser (some Safari versions drew Tailwind's infinite radius as a square).

## [0.1.3] — 2026-10-25

### Added

- My account shows each open session with its device and last activity, and closes them one by one; your account's recent activity (logins, failed attempts with your username, security changes); and when the account was created and your previous login.

### Changed

- The footer spans the full width, like the header: version on the left, Pepebits on the right.

### Fixed

- Behind Cloudflare, Rocket Loader rewrote the panel's scripts and the Content-Security-Policy blocked them (theme switch, search, live updates). The panel now sends `Cache-Control: no-transform` and marks its scripts so Cloudflare leaves them alone.
- A running job's page updates live again: its inline script was blocked by the Content-Security-Policy since 0.1.1.
- The featured image's alt text is written in the post's language (it could come out in Spanish for posts in English).
- The activity log describes a failed login with a username that doesn't exist, instead of showing an empty name.
- Recovery codes select cleanly when dragging across several of them, and can be copied or downloaded all at once.

## [0.1.2] — 2026-10-25

### Changed

- Runtime dependencies updated: pino 10, pino-pretty 13, dotenv 18 and marked 18 (the HTML sent to Ghost is unchanged).
- The panel footer shows the right version again (0.1.1 still said 0.1.0).

### Security

- The weekly scan of the published image closes its issue once the image is clean again.
- Releases check that the tag matches the version in `package.json` and has a section in this changelog.

## [0.1.1] — 2026-10-24

### Security

- Fixed: a percent-encoded URL (such as `/%73ettings`) bypassed role checks, letting an editor reach Settings and an admin reach owner-only routes.
- Password reset links no longer skip two-step verification, and expire when their creator loses the right to use them.
- Logins are locked per account and client, with per-client limits and a cap on concurrent password hashing.
- Sources and image downloads can no longer reach private networks or cloud metadata (SSRF), including through redirects and DNS tricks.
- The unknown-links check reads the final HTML, catching autolinks and encoded links.
- Content-Security-Policy and security headers; no tokens in logs; private data folder permissions.

### Changed

- Docker image on Alpine, pinned by digest, without npm: from 244 known vulnerabilities to none.
- Each release is scanned before it's published and ships with an SBOM and provenance.
- The AI spending cap and prices are owner-only.

## [0.1.0] — 2026-10-24

First public release.

### Added

- Web panel: plan, review block by block, edit, choose the image and apply to Ghost, with history and undo.
- SEO: meta, slug, tags, social cards, quality score and Fix with AI.
- Images from Unsplash, Pixabay, Pexels, Openverse and Wikimedia Commons, with attribution.
- Ideas from Google Search Console and Bing Webmaster Tools, plus AI topic ideas.
- Multi-model: DeepSeek, Claude or any OpenAI-compatible API, per agent, with a daily cap.
- Teams: owner, admin and editor roles, invites, 2FA, assignments, notes and an activity log.
- Export / import of the workspace; full backup from the server CLI.
- Docker image for amd64 and arm64.

[Unreleased]: https://github.com/Pepebits/ghost-connector/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/Pepebits/ghost-connector/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Pepebits/ghost-connector/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Pepebits/ghost-connector/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Pepebits/ghost-connector/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Pepebits/ghost-connector/releases/tag/v0.1.0
