<p align="center"><img src="https://raw.githubusercontent.com/Pepebits/ghost-connector/main/docs/banner.png" alt="Ghost Connector" width="720"></p>

**AI subagents that finish, optimize (SEO) and illustrate your [Ghost](https://ghost.org) drafts — and hand them back for you to review.** A web panel for you or your team, plus a CLI.

> **It never publishes.** Everything stays at `status: draft`. Publishing is always your call, in Ghost.

📖 Full documentation: **[github.com/Pepebits/ghost-connector](https://github.com/Pepebits/ghost-connector)**

## ✨ What it does

- ✍️ Completes or improves drafts, in the draft's own language, live as it writes
- 🔎 SEO: meta, slug, tags, social cards, a quality score and *Fix with AI*
- 🖼️ Featured images from Unsplash, Pixabay, Pexels, Openverse and Wikimedia Commons, with attribution
- ✅ Block-by-block review, history and undo
- 💡 Ideas from Google Search Console and Bing Webmaster Tools
- 🤖 DeepSeek, Claude or any OpenAI-compatible API, with a daily spending cap
- 👥 Users with roles (owner, admin, editor), 2FA, invites, notes and an activity log

## 🚀 Quick start

```bash
mkdir -p ghost-data && cd ghost-data/..
# Configure step by step (Ghost Admin API key, AI provider key…):
docker run --rm -it -v "$PWD/ghost-data:/data" pepebits/ghost-connector setup
# Start the panel on http://127.0.0.1:4300
docker run -d --name ghost-connector --restart unless-stopped \
  -v "$PWD/ghost-data:/data" -p 127.0.0.1:4300:4300 pepebits/ghost-connector
```

Open `http://127.0.0.1:4300` and **create the first user right away**: until it exists, whoever opens the panel becomes its owner.

> ⚠️ Keep `-p 127.0.0.1:4300:4300`. To reach it from elsewhere, put a reverse proxy or a tunnel with its own access control in front (for example Cloudflare Tunnel + Access) and set `-e PUBLIC_URL=https://your.domain`.

A ready-made [`docker-compose.yml`](https://github.com/Pepebits/ghost-connector/blob/main/docker-compose.yml) (with an optional Cloudflare Tunnel) is in the repository.

## 📦 Image

| | |
|---|---|
| **Tags** | `latest`, `X.Y` and `X.Y.Z` |
| **Platforms** | `linux/amd64`, `linux/arm64` |
| **Volume** | `/data`: `config.env` (your configuration, with keys) and `data/` (plans, images, users) |
| **Port** | `4300` |
| **Base** | `node:24-alpine`, OS updates applied, no npm in the final image, scanned with Trivy on every release |
| **User** | `node` (uid 1000) — the volume must be writable by it |
| **Also on** | `ghcr.io/pepebits/ghost-connector` |

Any CLI command runs the same way: `docker run --rm -v "$PWD/ghost-data:/data" pepebits/ghost-connector list`. Full backup from a running container: `docker exec ghost-connector ghost-connector backup`.

## 🔒 Security

Users with scrypt passwords and optional TOTP 2FA, owner-only API keys, draft-only writes with Ghost revisions. Report vulnerabilities as described in [SECURITY.md](https://github.com/Pepebits/ghost-connector/blob/main/SECURITY.md).

---

[MIT](https://github.com/Pepebits/ghost-connector/blob/main/LICENSE) © [PEPEBITS](https://pepebits.com)
