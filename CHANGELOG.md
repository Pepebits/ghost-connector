# Changelog

All notable changes to Ghost Connector. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Each release's notes on GitHub and
in the announcement come from its section here.

## [Unreleased]

### Fixed

- Behind Cloudflare, Rocket Loader rewrote the panel's scripts and the Content-Security-Policy blocked them (theme switch, search, live updates). The panel now sends `Cache-Control: no-transform` and marks its scripts so Cloudflare leaves them alone.
- A running job's page updates live again: its inline script was blocked by the Content-Security-Policy since 0.1.1.
- The featured image's alt text is written in the post's language (it could come out in Spanish for posts in English).
- The activity log describes a failed login with a username that doesn't exist, instead of showing an empty name.

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

[Unreleased]: https://github.com/Pepebits/ghost-connector/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/Pepebits/ghost-connector/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Pepebits/ghost-connector/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Pepebits/ghost-connector/releases/tag/v0.1.0
