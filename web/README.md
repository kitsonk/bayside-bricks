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
| `npm run check`       | Type-check the project (`astro check`)                                                            |
| `npm test`            | Boot `wrangler dev` and run the route-table smoke suite (`scripts/smoke.mjs`) — needs a prior build |
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

CI/CD, the `bricks.kitandsimon.com` custom-domain cutover and rollback are
documented in [`docs/deploy.md`](docs/deploy.md). CI lives in
`.github/workflows/ci-cd.yml` (it replaced the Deno Deploy `deployctl`
workflow).

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
├── scripts/               # self-host-bricklink-images.mjs (fetch/validate/rewrite)
└── src/
    ├── env.d.ts           # App.Locals typing from @astrojs/cloudflare
    ├── lib/env.ts         # Cross-runtime env resolution helper
    ├── layouts/Base.astro # Base HTML layout (legacy _app.tsx head, verbatim)
    └── pages/
        ├── index.astro    # Bayside Brickstore home page (port of routes/index.tsx)
        ├── 404.astro      # Not-found page (port of routes/_404.tsx, status 404)
        └── health.ts      # GET /health → JSON health endpoint
```

## Static assets (migrated 2026-11-07; images 2026-11-13)

All non-code assets now live in `public/` (Cloudflare R2 was considered and
rejected: ~10 small files on a single page — Workers Static Assets is simpler
and has no extra billing surface). Served paths must match the references in
`src/` exactly (Workers asset serving is case-sensitive).

| Served path | Source | Provenance |
| --- | --- | --- |
| `/logo.svg` | legacy `static/logo.svg` | Byte-identical copy (sha256 `88326af4…`; referenced by the 404 page) |
| `/favicon.ico` | legacy `static/favicon.ico` | Byte-identical copy (sha256 `ceefc31b…`; 3-icon ICO; browser auto-request, not linked in `<head>`) |
| `/vendor/iframeResizer.contentWindow.3.5.3.min.js` | npm `iframe-resizer@3.5.3` → `js/iframeResizer.contentWindow.min.js` | Vendored; replaces the hotlink to `//cache.bricklink.info/vendor/…` (Bricklink CDN was serving maintenance pages on 2026-11-07). File banner confirms `v3.5.3 - 2016-02-23` — the same version Bricklink vendors, so the parent/child iframe protocol is unchanged |
| `/img/1035859.JPG` (hero) | `https://www.bricklink.com/myImg/1035859.JPG` | Landed 2026-11-13 — 32,015 B, **640×630**; the legacy source URL had a 4-slash quirk (`https:////www…`), normalised in the port |
| `/img/1035787.JPG` … `/img/1035792.JPG` (6) | `https://www.bricklink.com/myImg/1035787.JPG` … | Landed 2026-11-13 — all **40×37** thumbnails: `1035787` 1,239 B; `1035788` 1,177 B; `1035789` 1,035 B; `1035790` 1,190 B; `1035791` 1,263 B; `1035792` 1,013 B |

> **Note — images landed (2026-11-13):** BrickLink went fully offline on
> 2026-11-06 and came back on 2026-11-13, at which point all 7 `myImg` JPGs were
> fetched from the origin and validated (real JPEGs — SOI magic, trailing EOI,
> SOF frame header — 640×630 hero plus six 40×37 thumbnails). They now live in
> `public/img/` and `src/pages/index.astro` references `/img/<id>.JPG`
> exclusively; no image request leaves the Worker. Served bytes are
> sha256-identical to the files on disk.
>
> The fetch/rewrite tool is kept as the maintenance path if the assets are ever
> re-sourced. It validates every download and refuses to write anything that
> fails, so a maintenance/redirect response can never be saved as a `.JPG`:
>
> ```sh
> node scripts/self-host-bricklink-images.mjs --check   # present + still-hotlinked report
> node scripts/self-host-bricklink-images.mjs           # fetch + validate into public/img/
> node scripts/self-host-bricklink-images.mjs --rewrite # point index.astro at /img/<id>.JPG
> ```
>
> Simon's originals can be used instead of the origin with `--originals <dir>`
> (`<dir>/<id>.JPG`, any case). Note the validator's size floor is 256 B, not
> 1 KB: the thumbnails are legitimately ~1 KB (the smallest is 1,013 B), so a
> larger floor false-positives on a valid file — the magic/EOI/SOF checks are
> what actually reject a maintenance page.

**`/styles.css` is preserved at its exact legacy URL** (MIGRATION_INVENTORY.md
§3 URL-class parity — the port's mandate is to preserve existing URLs). The
legacy URL was Fresh's compiled Tailwind output; the port compiles the same
`@tailwind` directives through Vite/PostCSS (Tailwind v3.4.x, matching the
legacy 3.4.1 pin) and pins the emitted asset name to `styles.css` via
`assetFileNames` in `astro.config.ts`, so the built site serves the compiled
stylesheet at `/styles.css` just like the legacy site.

## External integrations

The legacy app had exactly four integrations (MIGRATION_INVENTORY.md §9).
Their state after this migration:

1. **7 × Bricklink `myImg` hotlinked images** — **closed 2026-11-13**: all 7
   are self-hosted under `/img/`, so image availability no longer depends on
   Bricklink infrastructure (provenance and dimensions in the Static assets
   table). `index.astro` has no remaining `bricklink.com` references;
   `scripts/self-host-bricklink-images.mjs` stays as the fetch/validate/rewrite
   maintenance path.
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
| T1 | All migrated assets reachable from `wrangler dev` (`/logo.svg`, `/favicon.ico`, `/img/*.JPG`, `/vendor/…js`) | `npm run build && npm run preview`, then `curl -sI` each path — expect 200 + correct content-type | **Executed 2026-11-13 (7/7 images landed):** each `/img/<id>.JPG` → `200 image/jpeg`, GET body byte-identical to `public/img/` (sha256 match, sizes 32,015 B hero / 1,013–1,263 B thumbs); `/logo.svg`, `/favicon.ico`, `/vendor/…js`, `/`, `/styles.css` and the 404 table re-verified in the same run |
| T2 | `logo.svg`/`favicon.ico` byte-identical to legacy `static/` | `shasum -a 256` source vs `public/` | Executed (sha256 match) |
| T3 | Image integrity (valid JPEGs, sane dimensions) | `file` + dimension probe per image | **Executed 2026-11-13:** 7/7 valid — hero `1035859` **640×630**, thumbnails `1035787`–`1035792` all **40×37**; `npm run images:check` exits 0 (7/7 valid, 0 hotlinked). Negative test: a maintenance-style HTML page named `<id>.jpg` is refused on all four grounds (size, SOI, EOI, SOF) and nothing is written |
| T4 | Vendored script is genuine iframe-resizer 3.5.3 contentWindow | File banner `v3.5.3 - 2016-02-23` + size/hash recorded | Executed (sha256 `b40175f3…`) |
| T5 | Frame-embeddability: no `X-Frame-Options`/`frame-ancestors` on responses | `curl -sI` on `/` under `wrangler dev` | Executed (absent on `/`, `/styles.css`, 404) |
| T6 | Rendered HTML references match `public/` paths exactly | Grep `src/` for `img/`, `vendor/`, `logo`, `favicon` refs; each maps to a real file | **Executed 2026-11-13:** the 7 `img` refs are `src="/img/<id>.JPG"` and each resolves 200 from `dist/client/img/`; `/` contains **zero** `bricklink.com/myImg` references; `/logo.svg` + `/vendor/…js` resolve, `/styles.css` 200 |
| T7 | Bricklink storefront embed renders and auto-resizes | Manual: load the store page containing the iframe after cutover; verify render + resize | **Run at cutover/soak** (needs Bricklink store access — Simon) |
| T8 | Visual parity of `/` and 404 vs the live Deno Deploy site | Manual side-by-side (layout, images, title strings) | **Run at verification stage** (QA card) |

<!-- preview pipeline proof run -->
