# Deploying Bayside Bricks (Cloudflare Workers)

Operational reference for CI/CD, the domain cutover off Deno Deploy, and
rollback. The workflow is [`.github/workflows/ci-cd.yml`](../../.github/workflows/ci-cd.yml);
it replaced the Deno Deploy `deployctl` workflow in the same change
(MIGRATION_INVENTORY.md §11.1). Everything below runs from `web/`.

## 0. Current status

| Piece | State |
| --- | --- |
| CI (`verify`) | green on `main` — install → typecheck → build → deploy dry run → route-table smoke |
| Preview deployment | works: `wrangler versions upload` produces an immutable preview URL that passes the smoke suite |
| Production deployment | works: `wrangler deploy` serves `https://bayside-bricks.me-6d3.workers.dev` (smoke green) |
| Custom domain `bricks.kitandsimon.com` | **not attached yet** — blocked on zone ownership, see §3 |
| Deno Deploy | untouched and still serving `bricks.kitandsimon.com`; it is the rollback |

The GitHub deploy jobs run only when `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` exist as repository secrets (§2). Until they do, CI
stays green and the deploy jobs skip with a warning.

## 1. Pipeline shape

| Stage | Trigger | What happens |
| --- | --- | --- |
| **Verify** | every push, every PR | `npm ci` → `npm run check` (`astro check`) → `npm run build` → `wrangler deploy --dry-run` (bundle validity) → `npm test` (boots `wrangler dev` and runs the route-table smoke suite) → uploads `web/dist` |
| **Preview** | pull requests (same repo) | `wrangler versions upload` of the *same* build, tagged `pr-<n>`, then the smoke suite against the preview URL, then a PR comment with the URL. Production traffic is untouched. |
| **Production** | push to `main` (or manual dispatch) | `wrangler deploy` of the same `web/dist` that passed Verify, then the smoke suite against `PRODUCTION_URL` (default `https://bricks.kitandsimon.com`). |

The app has no unit tests (MIGRATION_INVENTORY.md §7), so the route-table smoke
suite is the test gate: `web/scripts/smoke.mjs` (assertions) driven by
`web/scripts/smoke-local.mjs` (spawns `wrangler dev`, waits for `/health`,
tears down). Run it locally with:

```bash
npm run build && npm test              # local wrangler dev on :8787 (SMOKE_PORT to override)
node scripts/smoke.mjs https://bricks.kitandsimon.com   # anywhere, no server needed
```

`/img/*.JPG` assertions are off by default; `node scripts/smoke.mjs <url> --images`
enables them once the seven BrickLink photos are self-hosted (t_e45969d3).

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
| `CLOUDFLARE_API_TOKEN` | scoped API token (below) | never the Global API Key, never the wrangler OAuth token |
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
| Account | **Workers Scripts: Edit** | `wrangler versions upload` / `wrangler deploy` |
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
- Custom domain: `bricks.kitandsimon.com`, deliberately **not** declared in
  `wrangler.jsonc`. Declaring it there would make every deploy fail until the
  zone exists in the account, which would hold CI red for the whole pre-cutover
  period. It is attached during the cutover (§4), once the zone exists.

### The zone problem, verified 2026-11-09

`bricks.kitandsimon.com` is a `CNAME` → `alias.deno.net` (TTL 3600) in the
`kitandsimon.com` zone, which lives at **GoDaddy** (`ns03/ns04.domaincontrol.com`)
alongside Google Workspace mail (5 MX, SPF), Google site verifications and the
`calendar`/`drive`/`groups`/`mail` Google delegations — 25 records in total.
Workers custom domains require the hostname to be in a zone on the Cloudflare
account; that account currently holds only `kitsonkelly.com`.

Delegating **just** the `bricks` subdomain to its own Cloudflare zone would be
the minimal-blast-radius move: it needs NS records for `bricks` in the GoDaddy
zone. **GoDaddy does not support that.** Verified against the live API:

- `PUT /v1/domains/kitandsimon.com/records/NS/<name>` returns HTTP 200 but
  stores nothing (`GET` reads back `[]`);
- deleting that record type fails with
  `INVALID_VALUE_ENUM: type not any of: A, AAAA, CAA, CNAME, HTTPS, MX, SRV, SVCB, TXT`.

So only two paths can serve the hostname from Workers:

| Option | Blast radius | Rollback | Availability |
| --- | --- | --- | --- |
| **A. Move `kitandsimon.com` to Cloudflare** — create the zone, confirm every record was imported, then point the registrar nameservers at Cloudflare. | Every record in the zone, including Google Workspace mail. Needs MX/SPF/verification records present in Cloudflare *before* the nameserver change, and Simon's sign-off (shared domain). | Set the GoDaddy nameservers back to `ns03/ns04.domaincontrol.com`; mail and web resume as the old zone reappears. | Always available |
| **B. Cloudflare for SaaS custom hostname** — keep the zone at GoDaddy, add `bricks.kitandsimon.com` as a custom hostname on an existing Cloudflare zone, CNAME `bricks` at the SaaS fallback origin. | One CNAME plus one validation TXT. | Restore the `bricks` CNAME to `alias.deno.net`. | Needs the Custom Hostnames feature on the zone. The zone's DNS already carries what look like SaaS artefacts (`TXT ca3-…` at the apex, `TXT _cf-custom-hostname.www`, a `dcv.cloudflare.com` `_acme-challenge` CNAME), so it may already be provisioned — check `GET /zones/<id>/custom_hostnames` |

Option B is preferable where it is available: it changes one record instead of
the whole zone. Option A is the fallback and the only path that keeps the domain
on a single provider.

The wrangler OAuth session on the build machine can deploy Workers and list
zones, but it cannot create zones (`com.cloudflare.api.account.zone.create`
denied) and cannot read zone DNS or custom hostnames (`Authentication error`).
The cutover needs the scoped token from §2 in the environment.

## 4. Cutover (Deno Deploy → Cloudflare Workers)

Preconditions: CI green on `main`, the production job verified against
`https://bayside-bricks.me-6d3.workers.dev`, and the scoped token (§2) exported
as `CLOUDFLARE_API_TOKEN` with `CLOUDFLARE_ACCOUNT_ID`. Deno Deploy stays
deployed and untouched throughout — it is the rollback.

```bash
# 0. Record the current state (rollback reference)
dig +short bricks.kitandsimon.com          # -> alias.deno.net -> 69.67.170.170
curl -sSI https://bricks.kitandsimon.com/  # -> server: deployd, x-fresh-uuid: ...
```

### Option B — custom hostname (preferred if available)

```bash
# 1. Create the custom hostname on the Cloudflare zone that owns the SaaS setup
#    POST /zones/<zone_id>/custom_hostnames
#      {"hostname":"bricks.kitandsimon.com","ssl":{"method":"http","type":"dv"}}
#    -> returns an ownership_verification TXT record
# 2. Add that TXT at GoDaddy; wait for ssl.status == "active"
# 3. Route the hostname to the Worker (Worker route on the SaaS zone, or the
#    fallback origin the existing hostnames use)
# 4. Flip one record at GoDaddy, TTL 600 for the first day:
#    PUT /v1/domains/kitandsimon.com/records/CNAME/bricks
#        [{"data":"<fallback origin>","ttl":600}]
```

### Option A — move the zone

```bash
# 1. Create the zone and capture the assigned nameservers
#    POST /zones {"name":"kitandsimon.com","account":{"id":"<account>"},"type":"full"}
# 2. Confirm Cloudflare imported EVERY record before touching the registrar:
#    GET /zones/<zone_id>/dns_records
#    expect the 25 listed in §3: 5x MX (Google), SPF TXT, 2x
#    google-site-verification TXT, the empty TXT, A @, CNAME www/ftp/bricks/
#    calendar/drive/groups/mail, and the ACME records. Recreate anything missing:
#    mail breaks in the switch window if MX or SPF is absent.
# 3. Change the registrar nameservers:
#    PATCH /v1/domains/kitandsimon.com {"nameServers":["<ns1>","<ns2>"]}
# 4. Wait for the zone to become Active: GET /zones/<zone_id> -> status "active"
#    (usually minutes, up to 24h)
```

### Then, either option — attach the custom domain and verify

```bash
# 5. Attach the Worker custom domain (zone must exist and be active)
#    PUT /accounts/<account>/workers/domains
#      {"zone_id":"<zone_id>","hostname":"bricks.kitandsimon.com",
#       "service":"bayside-bricks","environment":"production"}
#    Universal SSL issues the certificate once the hostname resolves to Cloudflare.

# 6. Verify
dig +short bricks.kitandsimon.com           # -> Cloudflare anycast addresses
curl -sSI https://bricks.kitandsimon.com/   # -> server: cloudflare, no x-fresh-uuid
node web/scripts/smoke.mjs https://bricks.kitandsimon.com   # 15/15, no SKIPs
```

Cutover window: while the old CNAME's TTL (3600 s) drains, some resolvers keep
serving the Deno Deploy site. That is expected and harmless — both sites serve
the same content. Requests that resolve through the new path only start failing
if the Worker/custom-domain step was skipped, so always attach the domain before
flipping DNS.

Post-cutover: leave Deno Deploy running for the soak period tracked by
`t_bc7cf085`, then delete the project and the `bricks` CNAME together.

## 5. Rollback

Ordered by severity; all are single commands and none require a rebuild.

| Situation | Action |
| --- | --- |
| Bad Worker release, DNS already on Cloudflare | `npx wrangler rollback -c dist/server/wrangler.json` (previous version), or re-run the production job on the last good commit. Verify: `node scripts/smoke.mjs https://bricks.kitandsimon.com`. |
| Bad Worker release, before DNS | `npx wrangler rollback -c dist/server/wrangler.json`, verify against the workers.dev host. |
| Custom domain/TLS problem, option A | Put the registrar nameservers back: `PATCH /v1/domains/kitandsimon.com {"nameServers":["ns03.domaincontrol.com","ns04.domaincontrol.com"]}`. The GoDaddy zone was never deleted, so `bricks` resolves to Deno Deploy again as the old NS TTL expires. |
| Custom domain/TLS problem, option B | Restore the single record: `PUT /v1/domains/kitandsimon.com/records/CNAME/bricks [{"data":"alias.deno.net","ttl":600}]`. Deno Deploy was never decommissioned, so the legacy site serves again as soon as resolvers converge. |
| Zone-level change caused the incident | Roll back the nameservers (option A) or the CNAME (option B) as above; the Cloudflare zone can stay orphaned and be deleted later. |
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
npx wrangler versions upload -c dist/server/wrangler.json --tag local   # preview URL
npx wrangler deploy -c dist/server/wrangler.json                      # production
```

Never add `X-Frame-Options` or a CSP `frame-ancestors` directive: the page is
embedded in the BrickLink storefront iframe (MIGRATION_INVENTORY.md §9.3). The
smoke suite fails the build if either appears.
