# Bayside Bricks — Astro / Cloudflare Workers scaffold

Target application scaffold for the Bayside Bricks migration off Deno
Deploy/Fresh onto **Node.js 20+ + Astro 7 (TypeScript) + Cloudflare Workers**
via `@astrojs/cloudflare`. The legacy Deno Fresh app still lives at the
repository root and is preserved temporarily as the porting reference; this
directory is self-contained and carries **no Deno runtime assumptions** (no
`deno.json`, no `Deno.*` APIs, no `jsr:`/`std:` imports). Once the port is
complete this directory is intended to be promoted to the repository root.

## Requirements

- Node.js 20 or newer (`.nvmrc` pins the local development version; tested on 22)
- npm (the `packageManager` field pins the npm version so Corepack-based CI
  images — e.g. Cloudflare Workers Builds, which defaults to pnpm — use the
  right package manager)
- A Cloudflare account with Workers enabled (for preview/deploy only)

## Local commands

Run all commands from this `web/` directory.

| Command               | What it does                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `npm install`         | Install dependencies                                                                              |
| `npm run dev`         | Dev server with hot reload on <http://localhost:4321>                                              |
| `npm run build`       | Production build into `dist/` — worker in `dist/server/`, statics in `dist/client/`                |
| `npm run preview`     | Serve the production build with `wrangler dev` (requires `npm run build` first) on <http://localhost:8787> |
| `npm run deploy`      | Build, then `wrangler deploy` the Worker (requires `wrangler login`)                               |
| `npx wrangler deploy --dry-run -c dist/server/wrangler.json` | Validate the deploy bundle without uploading (requires a prior `npm run build`) |

## Environment variables

Runtime values are resolved by `src/lib/env.ts` (`env("NAME")`), which works in
every runtime this app runs under:

- **`wrangler dev` and the deployed Worker** — bindings (vars and secrets) are
  exposed via `process.env` (`nodejs_compat` is enabled in `wrangler.jsonc`).
- **`astro dev`** — Vite replaces `process.env` with an empty object, so values
  come from `.env` files via `import.meta.env`.

Rules of the road:

- **Non-secret config** goes in the `vars` block of `wrangler.jsonc` (readable
  at runtime) and/or `.env` files for `astro dev`. Do not commit `.env`.
- **Secrets** go in `.dev.vars` locally (copy `.dev.vars.example`; the file is
  gitignored) and in **Workers secrets** in production — never in `vars`,
  `.env`, or `import.meta.env` (which is baked into the bundle at build time).
- Set production secrets after a build with:
  `npx wrangler secret put <NAME> -c dist/server/wrangler.json`

The scaffold demonstrates the pattern: `APP_ENV` is read by the health
endpoint and reported as `appEnv` (defaults to `"unset"` when not configured).

### Environment matrix (verified 2026-11-07)

Verified against the full legacy application tree (MIGRATION_INVENTORY.md
§7): the legacy Fresh app read **no** environment variables and held **no**
secrets, so nothing had to be migrated or recreated.

| Name | Kind | Required by | Local dev | Production | Secret? |
| --- | --- | --- | --- | --- | --- |
| `APP_ENV` | plain var | scaffold `/health` endpoint (`appEnv` field) | `.dev.vars` (`APP_ENV=development`) | `vars` block in `wrangler.jsonc` | No |
| *(no secrets)* | — | — | — | — | — |

- **Secrets: none.** No `wrangler secret put` invocation is required for this
  application. The command is kept documented above for any future need
  (`npx wrangler secret put <NAME> -c dist/server/wrangler.json`).
- Never commit `.dev.vars`; only `.dev.vars.example` is tracked.
- Deploy-time credentials (e.g. `CLOUDFLARE_API_TOKEN` as a GitHub Actions
  secret) are CI/CD concerns, not application env — see the CI/CD cutover
  documentation when it lands.

### Data stores and bindings

**None.** MIGRATION_INVENTORY.md §8 confirms the legacy app has no Deno
KV/D1/R2/Postgres/SQLite, no queues, no cron, no sessions or auth — verified
against the complete 23-file tree. Nothing to migrate, recreate, or seed;
`wrangler.jsonc` declares no bindings (the adapter is configured with
`session: false` and `imageService: "passthrough"`), and none should be added
without a concrete requirement.

## Deployment assumptions

- `npm run build` is always run before any `wrangler dev`/`wrangler deploy`
  invocation against `dist/server/wrangler.json` — the adapter emits that
  resolved config (worker entry `entry.mjs` plus statics in `dist/client/`)
  from the base `wrangler.jsonc` in this directory.
- The Worker is named `bayside-bricks`; the deploy target is the Cloudflare
  Workers account configured by `wrangler login` (or `CLOUDFLARE_API_TOKEN`).
- `compatibility_date` in `wrangler.jsonc` is pinned; bump it deliberately.
- `nodejs_compat` must stay enabled — `src/lib/env.ts` depends on it for
  `process.env` binding access in the Worker.
- No session (KV) or image-service bindings are required; the adapter is
  configured with `session: false` and `imageService: "passthrough"` so the
  generated Worker declares no unused bindings.
- Domain `bricks.kitandsimon.com` is expected to be routed to this Worker at
  cutover; that routing is a deployment-time step outside this scaffold.

## Scaffold layout

```
web/
├── astro.config.ts        # Astro 7 SSR + @astrojs/cloudflare adapter
├── wrangler.jsonc         # Base Workers config (adapter resolves it at build)
├── package.json           # Node 20+, npm scripts: dev/build/preview/deploy
├── tsconfig.json          # astro/tsconfigs/strict
├── .dev.vars.example      # Template for local secrets (copy to .dev.vars)
├── public/                # Static assets, served as-is (favicon.ico, logo.svg,
│                          #   img/ — 7 self-hosted Bricklink photos,
│                          #   vendor/ — vendored iframeResizer 3.5.3)
└── src/
    ├── env.d.ts           # App.Locals typing from @astrojs/cloudflare
    ├── lib/env.ts         # Cross-runtime env resolution helper
    ├── layouts/Base.astro # Base HTML layout
    └── pages/
        ├── index.astro    # Placeholder home page
        ├── 404.astro      # Not-found page (status 404)
        └── health.ts      # GET /health → JSON health endpoint
```

## Static assets (migrated 2026-11-07)

All non-code assets now live in `public/` (Cloudflare R2 was considered and
rejected: ~10 small files on a single page — Workers Static Assets is simpler
and has no extra billing surface). Served paths must match the references in
`src/` exactly (Workers asset serving is case-sensitive).

| Served path | Source | Provenance |
| --- | --- | --- |
| `/logo.svg` | legacy `static/logo.svg` | Byte-identical copy (sha256 `88326af4…`; referenced by the 404 page) |
| `/favicon.ico` | legacy `static/favicon.ico` | Byte-identical copy (sha256 `ceefc31b…`; 3-icon ICO; browser auto-request, not linked in `<head>`) |
| `/vendor/iframeResizer.contentWindow.3.5.3.min.js` | npm `iframe-resizer@3.5.3` → `js/iframeResizer.contentWindow.min.js` | Vendored; replaces the hotlink to `//cache.bricklink.info/vendor/…` (Bricklink CDN was serving maintenance pages on 2026-11-07). File banner confirms `v3.5.3 - 2016-02-23` — the same version Bricklink vendors, so the parent/child iframe protocol is unchanged |
| `/img/1035859.JPG` (hero) | `https://www.bricklink.com/myImg/1035859.JPG` | **Pending fetch** (see note); the legacy source URL had a 4-slash quirk (`https:////www…`), already normalised in the port |
| `/img/1035787.JPG` … `/img/1035792.JPG` (6) | `https://www.bricklink.com/myImg/1035787.JPG` … | **Pending fetch** (see note); verbatim leaf names |

> **Note — image fetch pending (2026-11-07):** Bricklink is in a site-wide
> maintenance window (every URL on `www.bricklink.com` serves their maintenance
> page; that page indicates return "next day EST"), so the 7 `myImg` JPGs could
> not be downloaded during this migration. They are **not** in `public/img/`
> yet, and `src/pages/index.astro` still hotlinks the original URLs. When
> Bricklink is reachable again, land them with:
>
> ```sh
> for n in 1035859 1035787 1035788 1035789 1035790 1035791 1035792; do
>   curl -sL -o public/img/$n.JPG "https://www.bricklink.com/myImg/$n.JPG"
> done
> ```
>
> then switch the seven `src=` attributes in `src/pages/index.astro` to
> `/img/$n.JPG`, verify each file is a real JPEG (`file public/img/*.JPG`), and
> re-run T1/T3. Archival fallbacks were checked and are empty: Wayback CDX
> (no captures under any URL shape), Common Crawl, archive.today, and
> image-proxy caches all lack these files.

`/styles.css` intentionally disappears: the legacy URL was Fresh's compiled
Tailwind output, and the port uses Astro's CSS pipeline (hashed `/_astro/*.css`
URLs). MIGRATION_INVENTORY.md §10 verified nothing external consumes
`/styles.css`, so the URL change is safe.

## External integrations

The legacy app had exactly four integrations (MIGRATION_INVENTORY.md §9).
Their state after this migration:

1. **7 × Bricklink `myImg` hotlinked images** — being self-hosted under
   `/img/` so site image availability no longer depends on Bricklink
   infrastructure; the fetch is pending Bricklink's maintenance window (see
   the note under Static assets — `index.astro` still hotlinks the original
   URLs meanwhile).
2. **Bricklink `iframeResizer.contentWindow` script** — was hotlinked to
   `cache.bricklink.info`; now vendored under `/vendor/` at the same version
   (3.5.3). The script tag **must stay in the layout** — see 3.
3. **Iframe embed contract (Bricklink storefront)** — this page is embedded
   in the Bricklink store via a parent iframe that resizes it using
   iframe-resizer. Consequences: keep the contentWindow script; **never add
   `X-Frame-Options` or a `frame-ancestors` CSP** (Cloudflare Workers assets
   set neither by default — a future "security hardening" pass must not add
   them, or the storefront embed breaks silently).
4. **Deno Deploy hosting + GitHub Actions `deployctl`** — replaced at cutover
   (CI/CD and cutover card); nothing needed from this migration.

There are no webhooks, inbound APIs, OAuth, payments, mail, or queue/cron
integrations (inventory §8/§9.4).

## Integration test plan

| # | Check | Method | Status |
| --- | --- | --- | --- |
| T1 | All migrated assets reachable from `wrangler dev` (`/logo.svg`, `/favicon.ico`, `/img/*.JPG`, `/vendor/…js`) | `npm run build && npm run preview`, then `curl -sI` each path — expect 200 + correct content-type | Executed in this migration (see task handoff for results) |
| T2 | `logo.svg`/`favicon.ico` byte-identical to legacy `static/` | `shasum -a 256` source vs `public/` | Executed (sha256 match) |
| T3 | Image integrity (valid JPEGs, sane dimensions) | `file` + dimension probe per image | Executed for landed images |
| T4 | Vendored script is genuine iframe-resizer 3.5.3 contentWindow | File banner `v3.5.3 - 2016-02-23` + size/hash recorded | Executed |
| T5 | Frame-embeddability: no `X-Frame-Options`/`frame-ancestors` on responses | `curl -sI` on `/` under `wrangler dev` | Executed |
| T6 | Rendered HTML references match `public/` paths exactly | Grep `src/` for `img/`, `vendor/`, `logo`, `favicon` refs; each maps to a real file | Executed at end of migration (port cross-check) |
| T7 | Bricklink storefront embed renders and auto-resizes | Manual: load the store page containing the iframe after cutover; verify render + resize | **Run at cutover/soak** (needs Bricklink store access — Simon) |
| T8 | Visual parity of `/` and 404 vs the live Deno Deploy site | Manual side-by-side (layout, images, title strings) | **Run at verification stage** (QA card) |
