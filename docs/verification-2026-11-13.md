# Verification record — bricks.kitandsimon.com on Cloudflare Workers

**Verdict: pass.** Every route, asset, header, SEO tag and layout in the
migration inventory was checked against production and against the legacy Deno
Deploy deployment; the two differ only where the migration deliberately changed
them. A five-minute log soak produced no Worker exceptions. Two non-blocking
observations are recorded in §9; neither is an application defect.

Run 2026-11-13 between 05:08Z and 05:19Z, against the deployment of `main`
`f29d918` (version `a9a0be6d-4b38-4337-8821-34395b2748a8`, created
2026-11-13T05:02:24Z). Companion records: [`ci-cd.md`](ci-cd.md) (operator
runbook), [`cutover-2026-11-13.md`](cutover-2026-11-13.md) (the cutover itself),
[`decommission.md`](decommission.md) (what is left of Deno Deploy).

Paths in this record use the current layout: the app was promoted from `web/` to
the repository root later on 2026-11-13 (t_773ee38d). The commands were run as
written from the then-current tree, and every path named here resolves today.

## 1. Method

| Layer | How it was checked |
| --- | --- |
| Platform, DNS, TLS | `node scripts/verify-production.mjs` — resolves over DoH at 1.1.1.1, inspects the certificate over a real TLS handshake |
| Route table, headers, assets | the same script (63 checks) plus `node scripts/smoke.mjs <url> --images` (22 cases) — the suite CI already runs |
| Legacy parity | the same script with `--legacy https://bricks.kitsonkelly.deno.net`: visible text and CSS class sets of `/` and `/nonexistent` |
| Layout | Chromium at 1440×900 and 390×844 against both hosts, screenshots diffed pixel by pixel |
| User flow | the page loaded as an iframe child (script, images, message channel) in Chromium at mobile and desktop widths |
| Runtime errors | `npx wrangler tail bayside-bricks --format json`, live for ~5 minutes while 216 requests were driven at the site |
| Pipeline | `gh run list`, `gh variable list`, `npx wrangler deployments status` |

The local resolver answered correctly for `bricks` during this run, so no
`--resolve` workaround was needed for the suite; the platform checks resolve
over DoH regardless. Scripts are committed, so the whole battery is repeatable:

```bash
cd ~/github/bayside-bricks
npm run verify:prod -- --legacy https://bricks.kitsonkelly.deno.net
npm run smoke -- https://bricks.kitandsimon.com --images
```

## 2. Platform

| Check | Result |
| --- | --- |
| Delegation | `kitandsimon.com` → `danica.ns.cloudflare.com`, `vicente.ns.cloudflare.com`, no others |
| `bricks` resolves | `104.21.79.69`, `172.67.169.61` — two Cloudflare anycast addresses |
| Mail records | 5 MX, all `*.google.com` — unchanged from before the cutover |
| TLS | `CN=kitandsimon.com` (SAN covers `bricks.kitandsimon.com`), TLSv1.3, 90 days to expiry |
| Which platform answers | `server: cloudflare`; **no** `x-fresh-uuid`, **no** `via: deployd` — the Worker, not Fresh |
| Compression | `content-encoding: br` on `/` |
| Static asset caching | `/styles.css` → `cf-cache-status: HIT`, `cache-control: public, max-age=0, must-revalidate`, ETag |

## 3. Routes

Every URL class in the inventory, on production, plus the legacy host for
comparison. `/robots.txt` is the only divergence and it is Cloudflare's
platform behaviour, not the app (§9).

| Path | Production | Legacy (Deno) | Verdict |
| --- | --- | --- | --- |
| `/` | `200 text/html`, `<title>Bayside Brickstore</title>` | `200 text/html`, same title | parity |
| `/health` | `200 application/json` `{"status":"ok",…}` | `404` | new ops endpoint, deliberate |
| `/styles.css` | `200 text/css` at the legacy URL | `200 text/css` | parity (see §4) |
| `/logo.svg` | `200 image/svg+xml` | `200 image/svg+xml` | parity |
| `/favicon.ico` | `200 image/vnd.microsoft.icon` | `200 image/vnd.microsoft.icon` | parity |
| `/vendor/iframeResizer.contentWindow.3.5.3.min.js` | `200 text/javascript` | `404` (script was on BrickLink's CDN) | deliberate vendoring |
| `/img/<id>.JPG` ×7 | `200 image/jpeg` | `404` (hotlinked from `bricklink.com/myImg`) | deliberate self-hosting |
| `/index`, `/index.html` | `404` custom page, no redirect | `404` | parity |
| `/sitemap.xml`, `/feed.xml`, `/rss.xml`, `/robots.txt` | `404` custom page | `404` | parity — no feed or sitemap exists, by design |
| any unmatched path | `404`, `<title>404 - Page not found</title>` | same | parity |
| `/health/`, `/HEALTH`, `/styles.css/`, `/?utm_source=verify` | `200`, `404`, `404`, `200` | — | sane edge behaviour, no redirect chains |

`smoke.mjs --images` → **21/21 passed, 1 skipped** (the skip is Cloudflare's
managed `robots.txt`). Same on `https://bayside-bricks.me-6d3.workers.dev`.
`verify-production.mjs` → **63/63 passed, 2 warnings, 1 informational**.

## 4. Assets

| Asset | Check | Result |
| --- | --- | --- |
| `/vendor/iframeResizer…3.5.3.min.js` | served bytes vs `public/` | sha256 identical (`b40175f3…`), 13,466 B |
| same | vs the BrickLink CDN original | sha256 identical — the vendored copy is the byte-exact original, not a rebuild |
| `/img/*.JPG` ×7 | served bytes vs `public/img/` | all 7 sha256 identical (1,013–32,015 B) |
| `/styles.css` | compiled CSS | serves at the legacy URL; differs from the legacy compile only by the dead-island utilities (Counter/Button), which no longer exist in the page |
| `/favicon.ico`, `/logo.svg` | served | byte-identical to the legacy statics (checked during the port) |

## 5. SEO and head contract

The legacy `<head>` was preserved verbatim apart from two documented changes, so
"missing" modern tags below are deliberate parity, not omissions.

| Item | Result |
| --- | --- |
| `<title>` on `/` and on the 404 | `Bayside Brickstore` / `404 - Page not found` |
| `<html lang>` | `en` (added — the legacy element had no `lang`) |
| charset / viewport | `utf-8`; `width=device-width, initial-scale=1.0` |
| heading structure | exactly one `<h1>` |
| meta description, canonical, Open Graph, Twitter cards | absent, as on the legacy site |
| stylesheet | `<link rel="stylesheet" href="/styles.css">` — the legacy URL, not a hashed one |
| external scripts in the document | zero (the vendored script is same-origin; the legacy hotlinked BrickLink) |
| RSS / sitemap | none published, as before; both 404 with the custom page |

One script is added at the edge rather than in the document: Cloudflare's Web
Analytics beacon (§9).

## 6. Layout and user flow

| Viewport | Result |
| --- | --- |
| 1440×900 | screenshot vs legacy: **0 differing pixels** (`ImageChops` bbox `None`) |
| 390×844 | screenshot vs legacy: **0 differing pixels**; `scrollWidth == clientWidth` — no horizontal overflow |
| Document height | 1121 px (desktop) / 1129 px (mobile) on both hosts, identical |
| Images | all 7 load (`naturalWidth > 0`), hero at 640 px intrinsic width |
| iframe embedding | the child page runs the vendored `contentWindow` script and exposes the same globals as on the legacy host (`parentIFrame`/`iFrameResizer` are equally undefined at the top level — identical behaviour, the script only arms itself under a parent) |
| Frame headers | no `X-Frame-Options`, no CSP `frame-ancestors` on `/`, `/nonexistent` or `/styles.css` — BrickLink's storefront iframe keeps working |
| Forms | the page has none; there is nothing to submit (see §9 on POST) |
| Links / navigation | none — the page is a single presentational screen by design |

## 7. Soak

`npx wrangler tail bayside-bricks --format json` ran for ~5 minutes while 216
requests were driven across `/`, `/health`, `/styles.css`, `/nonexistent`,
`/index`, `/index.html`, `/sitemap.xml` and the images:

| Metric | Result |
| --- | --- |
| Worker invocations observed | 184 (static assets are served by the assets layer without invoking the Worker, so they do not appear) |
| `outcome` | `ok` ×184 — no `exception`, no `exceededCpu`, no `canceled` |
| Exceptions / diagnostics | 0 |
| Status distribution | 200 ×112, 404 ×72 — no 5xx |
| CPU time | 1 ms typical (0–8 ms range), stateless executions |

Requests made over the soak window returned the expected status every time; no
retry, timeout or 5xx was observed from either `curl` or Chromium.

## 8. Pipeline

| Item | State |
| --- | --- |
| Production deployment | `f29d918` = current `main` HEAD, version `a9a0be6d…`, 100% of traffic, created 05:02:24Z |
| Latest `CI/CD` run | [43369306149](https://github.com/kitsonk/bayside-bricks/actions/runs/43369306149) — success |
| Latest `CI` run | [43369306037](https://github.com/kitsonk/bayside-bricks/actions/runs/43369306037) — success (22/22, including self-hosted images) |
| `PRODUCTION_URL` | `https://bricks.kitandsimon.com` — the post-deploy job smokes the real hostname, not just workers.dev |

## 9. Observations (non-blocking, deliberately not changed)

1. **`POST /` answers `200`, the legacy app answered `405`.** Astro's SSR page
   route accepts any method and renders the page; Fresh rejected it. The page
   has no forms, no state and no mutations, so nothing can be done with it — but
   if a 405 is wanted for exactness, a one-line middleware that rejects methods
   other than GET/HEAD/OPTIONS restores it. Not changed here: it alters routing
   behaviour after the freeze, for no functional gain.
2. **Cleartext HTTP is still served.** `http://bricks.kitandsimon.com/` answers
   `200` with no `Location` and no HSTS, while the legacy Deno host 301'd to
   HTTPS. Zone `Always Use HTTPS` is off. No credentials are collected on this
   page, and the setting is zone-wide (shared with `kitandsimon.com` and mail),
   so it is Kit's call rather than a change to smuggle into a verification card.
3. **Cloudflare injects its Web Analytics beacon** (`static.cloudflareinsights.com/beacon.min.js`)
   into HTML responses at the edge. It is not in the app's HTML (the document
   itself has zero external scripts) and it did not exist on Deno Deploy. If
   it is not wanted, disable Web Analytics → *Automatic setup* for the zone.
4. **`/robots.txt` is Cloudflare's managed file**, 1,248 bytes of content-signal
   directives, whenever the edge injects it; the Worker's own answer for that
   path is the 404 page. During the soak two requests did reach the Worker,
   which is the same edge-dependent behaviour `ci-cd.md` §7.2 describes.

## 10. Re-run confirmation (independent, later the same day)

The battery was repeated end to end at 05:21Z–05:24Z against the same production
deployment, by the retry of this card, to confirm the record above is still
current rather than a snapshot of one window:

| Check | Result |
| --- | --- |
| `npm run verify:prod -- --legacy https://bricks.kitsonkelly.deno.net` | **63/63 passed**, the same 2 warnings (POST `/`, cleartext HTTP) and 1 informational (`/robots.txt`) |
| `npm run smoke -- https://bricks.kitandsimon.com --images` | **21/21 passed, 1 skipped** (Cloudflare's managed `robots.txt`) |
| Legacy parity within the same run | text and class sets byte-equal on `/` and `/nonexistent` |
| Fresh soak (`npx wrangler tail bayside-bricks --format json`) | 96 requests driven over ~50 s → **60 Worker invocations** (statics bypass the Worker), `outcome: ok` ×60, **0 exceptions**, 0 non-`ok` outcomes, 0 diagnostics, 24 × `200` / 36 × `404`, all on version `a9a0be6d…` |
| `https://bricks.kitsonkelly.deno.net/` | still `200` — the fallback is still intact, as `decommission.md` §2 states |

## 11. Sign-off

Application side: **verified, no critical errors, production is the Worker at
`f29d918`.** Two items remain outside this card's gift:

- Kit's own read of this record (the cutover record's sign-off line).
- Deleting the Deno Deploy application, which needs a human console session —
  state and steps in [`decommission.md`](decommission.md).
