# Kingdom 3914 server

This folder is the website's server (Cloudflare Worker `kingdom3914-api`).
Cloudflare Workers Builds deploys it automatically when files here change on the `main` branch.

- `worker.js` — the server code
- `wrangler.toml` — settings: database (D1 `DB`), file storage (R2 `FILES`), logs

Secrets such as `DISCORD_APPS_WEBHOOK` live only in the Cloudflare dashboard (Settings → Variables and Secrets).
