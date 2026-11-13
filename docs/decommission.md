# Decommissioning the legacy Deno Deploy project

**Status: decommissioned in part; the project deletion is scheduled and
human-gated.** `bricks.kitandsimon.com` has been served by the Cloudflare Worker
`bayside-bricks` since 2026-11-13T04:22:26Z, and nothing in DNS or CI points at
Deno Deploy any more. The Deno Deploy application itself still exists at
`https://bricks.kitsonkelly.deno.net` and can only be deleted from the Deno
console by a signed-in human — the CLI cannot be used unattended (see *Why this
last step needs a person*).

Recorded 2026-11-13 during the verification card (t_bc7cf085); evidence in
[`verification-2026-11-13.md`](verification-2026-11-13.md) and
[`cutover-2026-11-13.md`](cutover-2026-11-13.md). The remaining console step is
tracked on the board as **t_dc0f01cb**; the repo restructure that follows it
(the `web/` → root promotion and retirement of the legacy Fresh tree) is
**t_773ee38d**.

## 1. Done

| Item | Evidence |
| --- | --- |
| `bricks.kitandsimon.com` no longer resolves to the Deno edge | `dig +short A bricks.kitandsimon.com @1.1.1.1` → the two Cloudflare anycast addresses; the zone is delegated to `danica`/`vicente.ns.cloudflare.com` |
| No `alias.deno.net` CNAME remains in the live path | the `bricks` record is the one Cloudflare manages for the custom-domain binding; the Worker serves the host over TLS |
| The Worker, not Fresh, answers the public host | `server: cloudflare`, no `x-fresh-uuid`, no `via: deployd` on every route checked |
| Deploy pipeline retired | `.github/workflows/deploy.yml` (deployctl → `bayside-bricks`) deleted in the cutover change; only `ci.yml` and `ci-cd.yml` remain, both Wrangler |
| No runtime dependency on Deno | `web/` has zero `Deno.*`, `deno.land`, `jsr:` or `fresh` imports; the app reads no env vars (inventory §7) |
| Deno-only external hotlinks gone | the BrickLink CDN script is vendored and byte-identical (`sha256 b40175f3…`); the 7 photos are self-hosted under `/img/` |

## 2. Remaining — scheduled

| Item | Owner | How |
| --- | --- | --- |
| Delete the Deno Deploy application `bayside-bricks` | Kit | Deno console → app → delete (steps below) |
| Disconnect Deno's GitHub integration from `kitsonk/bayside-bricks` | Kit | GitHub → Settings → Applications → deno deploy → Configure → remove this repository. **Confirmed still connected** on 2026-11-13: PR #14 carried a `deploy/kitsonkelly/bricks` check, which reported *Build succeeded*, so Deno is still building this repository on every push. |
| After deletion: retire rollback R4 and the fallback paragraphs | next repo change | `docs/ci-cd.md` §8 R4 and `web/docs/deploy.md` §0/§5 currently treat Deno Deploy as a rollback target. Tracked as t_dc0f01cb. |

Until the deletion happens, **R4 (repoint `bricks` at Deno Deploy) is still
valid** — the project, its last deployment and its GitHub integration are
untouched. It stops being valid the moment the project is deleted. Note that
`https://bricks.kitsonkelly.deno.net` serves the *legacy Fresh app at the repo
root*, not the Astro build: it is a "restore service on the old app" fallback,
not a rollback of the current codebase.

### Why this last step needs a person

`deno deploy` has no `apps delete` subcommand (verified: `deno deploy apps` →
`list`, `get` only), so removal is a console action. Every automated path needs
a **Deno Deploy access token** (`DENO_DEPLOY_TOKEN`), and minting one requires a
signed-in console session at `console.deno.com/account/access-tokens`. On this
machine:

- no `DENO_DEPLOY_TOKEN` in the environment, in `~/.config/deno`, or in the
  login keychain;
- no token in the 1Password item *Deno* (it holds the console login only);
- `deno deploy whoami` → `NON_INTERACTIVE_REQUIRED`, and the console sign-in
  page is behind GitHub/Google OAuth plus a Cloudflare Turnstile human check —
  not something an unattended run should satisfy on Kit's behalf.

Deleting a live project is also irreversible, which is why it sits behind the
human gate rather than being worked around.

### Steps (about two minutes)

1. Sign in at <https://console.deno.com> with the account that owns the app.
2. Open the `bayside-bricks` application, then its settings, and delete it.
   Deleting the app removes its `*.deno.net` hostname and any custom domain
   still attached to it in Deno's console.
3. GitHub → **Settings → Applications → deno deploy → Configure** → remove
   `kitsonk/bayside-bricks`. This stops Deno building the Fresh app at the repo
   root on every push to `main`.
4. Verify the removal:

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://bricks.kitsonkelly.deno.net/   # 404/410, or DNS NXDOMAIN
   curl -sS -o /dev/null -w '%{http_code}\n' https://bricks.kitandsimon.com/          # still 200 — the Worker
   ```

5. Land the follow-up repo change: delete R4 from `docs/ci-cd.md` §8, drop the
   fallback text from `web/docs/deploy.md`, and mark this file's §2 done.

### Deadline that does not depend on us

The Deno console carries a banner: *"Deno Deploy is shutting down in April 2027.
Your existing applications keep running until then."* Deleting the project now
avoids inheriting that deadline, but there is no scenario in which the app needs
to outlive it.

## 3. What was deliberately *not* touched

- No DNS record was edited for this card: `bricks` is Cloudflare-managed for the
  Worker binding and already resolves only to Cloudflare.
- The legacy Fresh source at the repository root is still present as the
  porting reference (`routes/`, `islands/`, `components/`, `static/`,
  `deno.json`, `main.ts`, `dev.ts`, `fresh.*`). Retiring it is a separate
  repository change, tracked in the migration inventory §11.2 as *archive the
  Fresh branch*; the Deno project will keep building it until the GitHub
  integration is disconnected.
