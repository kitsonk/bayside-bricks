# Deploying Bayside Bricks (Cloudflare Workers)

Operational reference for CI/CD, the domain cutover off Deno Deploy, and
rollback. CI is [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml);
deployment is [`.github/workflows/ci-cd.yml`](../../.github/workflows/ci-cd.yml).
The pair replaced the Deno Deploy `deployctl` workflow in the same change
(MIGRATION_INVENTORY.md §11.1). Everything below runs from `web/`.

## 0. Current status

| Piece | State |
| --- | --- |
| CI (`verify` in `ci.yml`) | green on `main` — install → typecheck → build → deploy dry run → asset check → route-table smoke |
| Preview deployment | works: `wrangler versions upload` produces an immutable preview URL that passes the smoke suite, and the job asserts the live production deployment is byte-identical before and after. Requires **Preview URLs** enabled on the Worker — declared as `preview_urls: true` in `wrangler.jsonc` (§3) and re-asserted idempotently by the job if the flag is ever off |
| Production deployment | works: `wrangler deploy` deploys the Worker, re-applies the custom domain, and the job smokes `https://bayside-bricks.me-6d3.workers.dev` (§3) |
| Custom domain `bricks.kitandsimon.com` | **declared** in `wrangler.jsonc` (`routes` + `custom_domain`) and **attached** to Worker `bayside-bricks` (custom-domain id `775a47a8…`, cert `531f7afa…`); every production deploy re-applies it and verifies the binding — serves as soon as the zone is active |
| Deno Deploy | untouched, last good deployment retained as rollback — but not currently reachable, because the domain itself does not resolve (below) |
| **INCIDENT (2026-11-13)** | `kitandsimon.com` returns `SERVFAIL`: the registrar still delegates to the old Cloudflare pair while the zone lives on a new pair. Mail and web are down until the nameserver flip in §4. See §3. |

The GitHub deploy jobs run only when `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` exist as repository secrets (§2). Until they do, CI
stays green and the deploy jobs skip with a warning.

## 1. Pipeline shape

| Stage | Trigger | What happens |
| --- | --- | --- |
| **Verify** (`ci.yml`) | every push, every PR | resolves Node from `web/.nvmrc` → `npm ci` → `npm run check` (`astro check`) → `npm run build` → `wrangler deploy --dry-run` (bundle validity) → `npm run images:check` (no hotlinked assets) → `npm test` (boots `wrangler dev` and runs the route-table smoke suite, `--images` included). On failure it uploads logs plus `dist/`. No secrets. |
| **Preview** | pull requests (same repo) | rebuilds the PR commit, `wrangler versions upload` tagged `pr-<n>`, asserts the live production deployment id/version are unchanged, runs the smoke suite against the preview URL, then creates or updates the sticky PR comment. Production traffic is untouched. |
| **Production** | push to `main` (or manual dispatch) | rebuilds the commit, `wrangler deploy` (which also re-applies the `bricks.kitandsimon.com` custom domain from `wrangler.jsonc`), verifies the binding via the Cloudflare API, then runs the smoke suite against the workers.dev host it deployed to and against `PRODUCTION_URL` when that variable is set. |

CI and the deploy jobs are separate workflows, so GitHub does not share
artefacts between them and each deploy job rebuilds from the same commit and
lockfile. Require the `CI` workflow in branch protection to gate merges; the
post-deploy smoke is the runtime gate.

### Preview deployments (pull requests)

Every same-repo PR gets a preview on each push (`opened`, `synchronize`,
`reopened`). The `preview` job in `ci-cd.yml`:

1. rebuilds the PR head (`npm ci` → `npm run build`);
2. enables **preview URLs** on the Worker if they are off (see below), because
   without them wrangler uploads the version but prints no preview URL;
3. records the live production deployment id and version
   (`wrangler deployments status --json`);
4. uploads an immutable version — `npx wrangler versions upload` tagged
   `pr-<number>` — and takes the preview URL from the `Version Preview URL:`
   line, falling back to the deterministic
   `https://<first 8 of version id><preview_url_suffix>` when wrangler prints no
   URL for a version that uploaded fine;
5. **asserts production was not touched**: the active deployment id and version
   must be unchanged, the preview version must not be the version production
   serves, and the preview host must not be any production hostname (workers.dev,
   the custom domain, `PRODUCTION_URL`). Any of those failing fails the job;
6. runs the route-table smoke suite against the preview URL;
7. creates or updates one sticky PR comment (marker
   `<!-- preview-deployment -->`) with the URL, commit, version and the
   production deployment id — so a busy PR gets one comment, not one per push.

The preview job deliberately does not probe production `/health`: that would tie
every PR's verdict to production's own availability and DNS state, and says
nothing about isolation. Deployment identity is the stronger invariant.

**Preview URLs must be enabled on the Worker.** This is an account setting
separate from `workers_dev` and from any route; a version preview URL exists
only while it is on. It was off after the custom-domain deploy in #6 — wrangler
then uploads the version and prints no `Version Preview URL:` line, and old
preview URLs 404. The preview job turns it on idempotently, sending the current
`enabled` value back unchanged so the workers.dev/route switch stays exactly as
the production deploy set it. No production traffic or routing is touched.

Isolation is structural, not just behavioural:

| Mechanism | Effect |
| --- | --- |
| `wrangler versions upload`, never `wrangler deploy` | creates an immutable version; no deployment is created and no traffic moves |
| no `environment: Production` on the job | a preview cannot borrow the production environment's secrets or protection rules |
| step 4's assertion | the "preview cannot affect production" claim is *tested* on every PR, and the job goes red if it ever stops being true |
| `pull_request` event only, same-repo only | fork PRs get no secrets and are skipped, so no untrusted code deploys with the token |

The preview host is `https://<version-id>-bayside-bricks.me-6d3.workers.dev`
(one per version, not per PR) — the PR comment is the canonical place to find
the current one. Cloudflare also serves preview hosts with `x-robots-tag:
noindex`, so a preview cannot be indexed and compete with production.

**Known limitation — versions accumulate.** Each push to a PR uploads a new
version and nothing deletes them; `wrangler` has no `versions delete`
subcommand and the wrangler OAuth session is refused (`10405`) on the REST
delete endpoint, so removal is manual: Cloudflare dashboard → Workers &
Pages → `bayside-bricks` → *Versions*, or
`DELETE /accounts/<account>/workers/scripts/bayside-bricks/versions/<id>` with
an API token holding **Workers Scripts: Edit**. Old preview versions are inert
(no traffic, no routes) but they do clutter the version list.

The app has no unit tests (MIGRATION_INVENTORY.md §7), so the route-table smoke
suite is the test gate: `web/scripts/smoke.mjs` (assertions) driven by
`web/scripts/smoke-local.mjs` (spawns `wrangler dev`, waits for `/health`,
tears down). Run it locally with:

```bash
npm run build && npm test              # local wrangler dev on :8787 (SMOKE_PORT to override)
node scripts/smoke.mjs https://bricks.kitandsimon.com   # anywhere, no server needed
```

`/img/*.JPG` assertions are off by default locally; `node scripts/smoke.mjs <url> --images`
enables them, and CI always enables them (`SMOKE_ARGS=--images`).

Cloudflare serves its own boilerplate `/robots.txt` on `*.workers.dev`, so that
one assertion reports `SKIP` on workers.dev hosts and `PASS` (404) on the
custom domain. It stays strict where it matters.

`npm ci` needs the `allowScripts` entries in `package.json` (`workerd`,
`esbuild`): npm 12 blocks dependency install scripts unless they are
allow-listed, and those two fetch their platform binaries that way. Without the
allow-list, `wrangler dev` fails on a clean checkout (CI) while working on a
machine that installed before npm 12.

## 2. Required GitHub secrets

Set in **Settings → Secrets and variables → Actions** (or `gh secret set`):

| Name | Value | Notes |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | scoped API token (below) | required by both deploy jobs: the preview job uploads a version and toggles **Preview URLs**, the production job deploys and attaches the custom domain — never the Global API Key, never the wrangler OAuth token |
| `CLOUDFLARE_ACCOUNT_ID` | `6d3c3bec6c29c262b87b782e7a7b12de` | Kitson Kelly Personal Account |

Optional repository **variable** `PRODUCTION_URL` overrides the production smoke
target. Until the cutover in §4, set it to `https://bayside-bricks.me-6d3.workers.dev`
— otherwise the production job smokes the old Deno site and proves nothing.

Without both secrets the pipeline still runs and passes: the `prerequisites`
job detects the missing credentials, emits a warning, and the preview and
production jobs are skipped. Add the secrets and the next push deploys.

### Token permissions (create at dash.cloudflare.com/profile/api-tokens → *Create Custom Token*)

| Scope | Permission | Why |
| --- | --- | --- |
| Account | **Workers Scripts: Edit** | `wrangler versions upload` / `wrangler deploy`, and enabling **Preview URLs** on the Worker (`POST …/workers/scripts/bayside-bricks/subdomain`) |
| Account | **Account Settings: Read** | account lookup during deploy |
| Zone | **Workers Routes: Edit** | attaching the custom domain to the Worker |
| Zone | **Zone: Read** | resolving the zone id at deploy time |
| Zone | **DNS: Edit** | cutover only (§4) — inspect and adjust records |
| Account | **Zone: Edit** | cutover only — creating the zone (option A) |
| Zone | **Custom Hostnames: Edit** | cutover only — option B (§3) |

Zone resources: *All zones from an account → Kitson Kelly Personal Account*.
Nothing else is needed — no KV, R2, D1 or Pages permissions.

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo kitsonk/bayside-bricks   # paste the token
gh secret set CLOUDFLARE_ACCOUNT_ID --repo kitsonk/bayside-bricks --body 6d3c3bec6c29c262b87b782e7a7b12de
```

## 3. Production URL and the custom domain

- Worker name: `bayside-bricks` → `https://bayside-bricks.me-6d3.workers.dev`
  (workers.dev is kept enabled: it is the pre-DNS production target and the
  rollback surface for DNS work).
- Custom domain: `bricks.kitandsimon.com`, declared in `wrangler.jsonc`:

  ```jsonc
  "routes": [
    { "pattern": "bricks.kitandsimon.com", "custom_domain": true }
  ]
  ```

  The `@astrojs/cloudflare` adapter copies `routes` verbatim into
  `dist/server/wrangler.json`, so the config CI deploys is the config that
  attaches the hostname. `wrangler deploy` creates the proxied DNS record and
  the certificate request, then re-applies (and is idempotent about) the
  binding on every deploy — no dashboard or one-off API step, and a rebuilt
  Worker or a recreated account cannot silently lose the domain.

  Two properties make this safe to keep in the repo:

  - **A pending zone does not fail the deploy.** Verified 2026-11-13 by
    deploying the same config to a throwaway Worker and hostname on the
    pending `kitandsimon.com` zone: the deploy succeeded and the trigger was
    attached. The hostname simply does not resolve until the registrar flips
    nameservers (§4), so a config error can't hold production red during the
    pre-cutover period.
  - **Previews cannot touch it.** `wrangler versions upload` ignores triggers
    and prints that routes/custom domains "must be applied with the command
    `wrangler triggers deploy`". A PR gets an immutable preview URL and
    nothing else.

  The production job verifies the binding after each deploy with
  `GET /accounts/{id}/workers/domains` (it fails the job if the hostname is
  not bound to `bayside-bricks`, and reports the zone's activation status as
  a warning). That check is what proves the declaration actually landed,
  because `wrangler deploy` succeeds on the script upload regardless. If the
  token cannot read the listing, the job falls back to wrangler's own
  `bricks.kitandsimon.com (custom domain)` trigger line and warns instead of
  failing a deploy that is fine.

### `workers_dev` and `preview_urls` are declared, not inherited

`wrangler.jsonc` sets both to `true` explicitly:

```jsonc
"workers_dev": true,
"preview_urls": true,
```

This is load-bearing, not tidiness. As soon as a config carries `routes`,
wrangler **disables workers.dev for that deployment by default** and says so
only in a warning line. Declaring the route therefore silently removed
`https://bayside-bricks.me-6d3.workers.dev` — the pre-cutover production host
and the rollback surface — on the deploy of `2aa4a1e` (run 43356057677): the
host returned 404 and the production job failed because it had no workers.dev
URL to smoke. With `preview_urls` unset and workers.dev disabled, per-version
preview URLs are disabled too, which is what `wrangler versions upload` needs to
print a preview URL for a PR.

Once the cutover in §4 is done and `PRODUCTION_URL` points at the custom domain,
disabling workers.dev is a deliberate follow-up (drop both keys, smoke
`PRODUCTION_URL` only) — not something to leave to a default.

### The zone, as built (2026-11-13)

`kitandsimon.com` is now a zone on the Cloudflare account:

| | |
| --- | --- |
| Zone id | `21ae6e9bd7b4c714c1861b7b65df76ce` |
| Assigned nameservers | `danica.ns.cloudflare.com`, `vicente.ns.cloudflare.com` |
| Status | `pending` — `activation_failure_reason: ns_mismatch` |
| Registrar | GoDaddy, still delegating to `alice.ns.cloudflare.com` / `bob.ns.cloudflare.com` |

**This is the outage.** The registry delegation still points at the *old*
Cloudflare nameserver pair (`alice`/`bob`), which no longer hosts the zone — it
answers `REFUSED`, and recursive resolvers therefore return `SERVFAIL` for every
name under `kitandsimon.com`, mail included. The previous GoDaddy-hosted zone
(`ns03`/`ns04.domaincontrol.com`) was real until the domain was moved; the zone
that was recreated in the account on 2026-11-13T01:17Z was assigned
`danica`/`vicente`, and the registrar was never updated to match.

Zone contents — 12 records, rebuilt from the 2026-11-07 inventory plus passive
DNS, because Cloudflare's import found nothing at the dead delegation:

| Name | Type | Value | Confidence |
| --- | --- | --- | --- |
| `@` | MX ×5 | `aspmx.l.google.com` (1), `alt1`/`alt2` (5), `alt3`/`alt4` (10) | exact — Google Workspace standard set |
| `@` | TXT | `v=spf1 include:_spf.google.com ~all` | exact — recorded in the inventory |
| `@` | A | `160.153.0.160` | exact — inventory + passive DNS (legacy GoDaddy WordPress blog) |
| `www` | CNAME | `kitandsimon.com` | exact — inventory + passive DNS |
| `mail`, `calendar`, `drive`, `groups` | CNAME ×4 | `ghs.googlehosted.com` | **reconstructed** — Google Workspace custom URLs; target not verified |
| `bricks` | AAAA | `100::` (proxied, read-only) | created by the Workers custom-domain binding |

**Not recovered, re-add by hand if wanted:** the two `google-site-verification`
TXT values (re-verify in Search Console), the `ca3-…` Cloudflare SaaS
verification TXT, and any DKIM record (`google._domainkey`) that may have
existed. None of these affect mail delivery; DKIM affects deliverability, so
check Google Admin → Apps → Gmail → Authenticate email once DNS is back.

Delegating **just** the `bricks` subdomain was ruled out on 2026-11-09: GoDaddy
has no NS record type (`PUT .../records/NS/<name>` returns 200 and stores
nothing; delete returns `INVALID_VALUE_ENUM: type not any of: A, AAAA, CAA,
CNAME, HTTPS, MX, SRV, SVCB, TXT`). The whole zone moves, or nothing does.


## 4. Cutover — the registrar step (remaining)

Everything on the Cloudflare side is already done:

- zone `kitandsimon.com` (`21ae6e9b…`) created, 12 records in place (§3);
- Worker custom domain `bricks.kitandsimon.com` → service `bayside-bricks`
  attached (id `775a47a8…`), which created the proxied `AAAA 100::` record and
  a certificate request (`531f7afa…`). The binding was bootstrapped through the
  API and is now owned by `wrangler.jsonc` `routes`: every production deploy
  re-applies it and the post-deploy check fails the job if it is missing.

The **only** remaining action is the nameserver change at the registrar, and it
is also what ends the outage:

GoDaddy → *My Products → kitandsimon.com → DNS → Nameservers → Change*, and
replace the current pair with:

```
danica.ns.cloudflare.com
vicente.ns.cloudflare.com
```

Or, with a GoDaddy API key/secret (`sso-key`):

```bash
curl -X PATCH "https://api.godaddy.com/v1/domains/kitandsimon.com" \
  -H "Authorization: sso-key <KEY>:<SECRET>" -H "Content-Type: application/json" \
  -d '{"nameServers":["danica.ns.cloudflare.com","vicente.ns.cloudflare.com"]}'
```

Verify, in this order:

```bash
# 1. zone activates (minutes, occasionally up to 24h)
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/21ae6e9bd7b4c714c1861b7b65df76ce" \
  | jq -r '.result.status'                     # -> active

# 2. delegation and mail
dig +short NS kitandsimon.com @1.1.1.1         # -> danica/vicente
dig +short MX kitandsimon.com @1.1.1.1         # -> the 5 Google MX hosts

# 3. the Worker
dig +short bricks.kitandsimon.com              # -> Cloudflare anycast
curl -sSI https://bricks.kitandsimon.com/      # -> server: cloudflare, no x-fresh-uuid
node web/scripts/smoke.mjs https://bricks.kitandsimon.com   # 15/15, no SKIPs

# 4. mail (manual): send to and from a @kitandsimon.com address
```

TLS is issued automatically once the hostname resolves to Cloudflare; if
`curl` returns a certificate warning after activation, re-check in a few minutes
before assuming a problem.

Then point the production job at the real domain, so every future deploy smokes
it instead of the workers.dev host:

```bash
gh variable set PRODUCTION_URL --repo kitsonk/bayside-bricks \
  --body https://bricks.kitandsimon.com
```

Post-cutover: Deno Deploy keeps its last good deployment for the soak tracked by
`t_bc7cf085`; it is no longer addressable through `bricks.kitandsimon.com`
because the custom domain now routes to the Worker, so record the rollback as
"flip the nameservers back" (or detach the custom domain and recreate the CNAME
to `alias.deno.net`), not as "wait for DNS".

## 5. Rollback

Ordered by severity; all are single commands and none require a rebuild.

| Situation | Action |
| --- | --- |
| Bad Worker release, DNS already on Cloudflare | `npx wrangler rollback -c dist/server/wrangler.json` (previous version), or re-run the production job on the last good commit. Verify: `node scripts/smoke.mjs https://bricks.kitandsimon.com`. |
| Bad Worker release, before DNS | `npx wrangler rollback -c dist/server/wrangler.json`, verify against the workers.dev host. |
| Custom domain/TLS problem after activation | Detach the binding: `DELETE /accounts/6d3c3bec6c29c262b87b782e7a7b12de/workers/domains/775a47a88ca22a8dca76bbb4151c53d53ba62e8c`, then recreate `bricks` as a `CNAME` → `alias.deno.net` (Deno Deploy was never decommissioned). The legacy site serves again as resolvers converge. **The route is declared in `wrangler.jsonc`**, so the next production deploy re-attaches the Worker — pause/disable the `CI/CD` production job (or set `"workers_dev": true` and drop the `routes` block on a hotfix branch) before detaching if the fallback must hold. |
| Whole-zone problem (mail or apex broken after activation) | Point the registrar back at GoDaddy: `PATCH /v1/domains/kitandsimon.com {"nameServers":["ns03.domaincontrol.com","ns04.domaincontrol.com"]}`. Only trustworthy if GoDaddy retained the original zone — **not verified** on 2026-11-13 (the delegation was already dead when this was written), so check `dig MX kitandsimon.com` straight after the flip. |
| Zone-level change caused the incident | As above. Note the 2026-11-13 outage was exactly this: the zone moved before the registrar did, so nothing resolved. The Cloudflare zone can stay orphaned and be deleted later. |
| CI itself is broken | Deploy manually: `cd web && npm ci && npm run build && npx wrangler deploy -c dist/server/wrangler.json` (needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in the environment). |

Rollback verification is the same smoke suite against the target URL — if it
was good enough to gate the deploy, it is good enough to certify the rollback.

## 6. Local parity commands

```bash
npm ci
npm run check                       # astro check
npm run build                       # -> dist/server (worker) + dist/client (statics)
npx wrangler deploy --dry-run --outdir .wrangler/dry-run -c dist/server/wrangler.json
npm test                            # wrangler dev + route-table smoke
npx wrangler versions upload -c dist/server/wrangler.json --tag local   # preview URL (triggers untouched)
npx wrangler deploy -c dist/server/wrangler.json                      # production + applies the declared custom domain
npx wrangler rollback -c dist/server/wrangler.json                    # previous version, binding untouched
```

Never add `X-Frame-Options` or a CSP `frame-ancestors` directive: the page is
embedded in the BrickLink storefront iframe (MIGRATION_INVENTORY.md §9.3). The
smoke suite fails the build if either appears.
