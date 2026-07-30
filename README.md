# Caleb's Music of the Week — Cloudflare Pages + D1

This is the D1-only Cloudflare conversion of the working Netlify version. The exported queue is included and is inserted into D1 automatically the first time `/api/site-data` is opened.

## Cloudflare Pages settings

- Framework preset: None
- Build command: leave blank
- Build output directory: `.`
- Production branch: `main`

## Required binding

In **Workers & Pages → your project → Settings → Bindings**, add:

- Type: D1 database
- Variable name: `DB`
- Database: your `calebs-music-db` database

Add the binding to Production and Preview.

## Required secrets

In **Settings → Variables and Secrets**, add encrypted secrets:

- `ADMIN_PASSWORD`
- `ADMIN_TOKEN_SECRET` (a long random value)

Redeploy after adding or changing bindings/secrets.

## Media uploads

This version intentionally does not require R2. Direct image/audio uploads are disabled. Spotify artwork URLs, Spotify playback, streaming links, the weekly schedule, JSON import/export, and shared admin edits continue to work.
