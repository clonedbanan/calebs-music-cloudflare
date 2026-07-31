# Apple Music + YouTube Music autofill update

Upload these two files to the matching locations in the existing Cloudflare Pages repository:

- `index.html` -> repository root
- `functions/api/resolve-links.js` -> `functions/api/resolve-links.js`

Do not remove or replace the existing D1 functions, `wrangler.toml`, bindings, or Cloudflare secrets.

After Cloudflare deploys, open Admin and either:

1. Import a new Spotify track normally. Apple Music and YouTube Music are now resolved automatically.
2. Click **Fill Apple + YouTube links** in the Data section to backfill missing links for the existing queue and archive.

The resolver uses exact Songlink/Odesli mappings first. Apple Music then uses a high-confidence Apple catalog match. YouTube Music then attempts a high-confidence direct video match. It leaves a service blank rather than intentionally inserting a generic search-results URL when no confident direct match is available.
