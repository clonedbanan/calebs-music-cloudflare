# Caleb's Music of the Week — Cloudflare sync repair

This build fixes two related problems:

1. The repository's `wrangler.toml` declared itself as the source of truth but did not contain the D1 binding, so `/api/site-data` could not reach the database.
2. The public page previously started from each browser's `localStorage`, allowing Safari and Chrome to show different queues.

This package intentionally contains **no `wrangler.toml`**. Configure the D1 binding in the Cloudflare dashboard instead.

## Required Cloudflare settings

In **Workers & Pages → calebsmusic → Settings → Bindings**, add:

- Type: D1 database
- Variable name: `DB`
- Database: `calebs-music-db`

The secrets must also exist under **Settings → Variables and Secrets**:

- `ADMIN_PASSWORD`
- `ADMIN_TOKEN_SECRET`

After setting the binding and secrets, make one more GitHub commit to trigger a fresh production deployment.

## Verify the backend

Open:

`https://calebsmusic.pages.dev/api/health`

A working setup returns JSON containing:

- `"ok": true`
- `"databaseBinding": true`
- `"databaseReady": true`
- `"adminPasswordConfigured": true`
- `"tokenSecretConfigured": true`

Then open:

`https://calebsmusic.pages.dev/api/site-data`

It should return the shared queue as JSON.

## Preserving old browser-only edits

Before replacing the current project, export the latest JSON from whichever browser has the newest queue. After deployment, sign into Admin and import that JSON once. It will then save to D1 and appear on all devices.
