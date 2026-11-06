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
├── public/                # Static assets, served as-is (favicon.svg)
└── src/
    ├── env.d.ts           # App.Locals typing from @astrojs/cloudflare
    ├── lib/env.ts         # Cross-runtime env resolution helper
    ├── layouts/Base.astro # Base HTML layout
    └── pages/
        ├── index.astro    # Placeholder home page
        ├── 404.astro      # Not-found page (status 404)
        └── health.ts      # GET /health → JSON health endpoint
```
