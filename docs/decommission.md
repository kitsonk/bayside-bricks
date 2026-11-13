# Decommissioning the legacy Deno Deploy project

**Status: fully decommissioned (2026-11-13).** `bricks.kitandsimon.com` has been
served by the Cloudflare Worker `bayside-bricks` since 2026-11-13T04:22:26Z (§1),
the Deno Deploy application `kitsonkelly/bricks` has been deleted, and Deno's
GitHub integration is disconnected. `https://bricks.kitsonkelly.deno.net` answers
404 and nothing in DNS, CI or GitHub points at Deno any more. No console step and
no follow-up change remains.

Recorded 2026-11-13 during the verification card (t_bc7cf085) and closed on
t_dc0f01cb; evidence in [`verification-2026-11-13.md`](verification-2026-11-13.md)
and [`cutover-2026-11-13.md`](cutover-2026-11-13.md). The repository restructure
that archived the retired Fresh tree — the `web/` → root promotion and deletion of
the legacy app — is complete (**t_773ee38d**).

## 1. Done

| Item | Evidence |
| --- | --- |
| `bricks.kitandsimon.com` no longer resolves to the Deno edge | `dig +short A bricks.kitandsimon.com @1.1.1.1` → the two Cloudflare anycast addresses; the zone is delegated to `danica`/`vicente.ns.cloudflare.com` |
| No `alias.deno.net` CNAME remains in the live path | the `bricks` record is the one Cloudflare manages for the custom-domain binding; the Worker serves the host over TLS |
| The Worker, not Fresh, answers the public host | `server: cloudflare`, no `x-fresh-uuid`, no `via: deployd` on every route checked |
| Deploy pipeline retired | `.github/workflows/deploy.yml` (deployctl → `bayside-bricks`) deleted in the cutover change; only `ci.yml` and `ci-cd.yml` remain, both Wrangler |
| No runtime dependency on Deno | the app has zero `Deno.*`, `deno.land`, `jsr:` or `fresh` imports; it reads no env vars (inventory §7) |
| Deno-only external hotlinks gone | the BrickLink CDN script is vendored and byte-identical (`sha256 b40175f3…`); the 7 photos are self-hosted under `/img/` |

## 2. The last step — done 2026-11-13

| Item | Evidence (2026-11-13) |
| --- | --- |
| Deno Deploy application `kitsonkelly/bricks` deleted | `curl -sS -o /dev/null -w '%{http_code}\n' https://bricks.kitsonkelly.deno.net/` → `404` (it was `200` while the Fresh app was live) |
| Deno's GitHub integration disconnected from `kitsonk/bayside-bricks` | no `deploy/kitsonkelly/bricks` status is created on the commits of the change that landed this document. The red `deploy/…` status still visible on older commits (`f705ff7` and before) is a build from 05:46:04Z, taken before the disconnection; those statuses are historical and will not be re-created |
| The public host is still the Worker | `curl -sS -o /dev/null -w '%{http_code}\n' https://bricks.kitandsimon.com/` → `200` |
| Rollback R4 retired in the repository | `docs/ci-cd.md` §8 no longer contains an R4 (the former R5/R6 are renumbered R4/R5), and `docs/deploy.md` §0/§5 no longer describe a Deno fallback |

Both console actions — deleting the application and removing the GitHub App's
access to this repository — were performed by Kit, signed in, in the Deno and
GitHub consoles. Deletion is irreversible, and the CLI cannot be used
unattended, which is why it was never automated:

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

### Steps as executed (about two minutes)

1. Sign in at <https://console.deno.com> with the account that owns the app.
2. Open the `bayside-bricks` application, then its settings, and delete it.
   Deleting the app removes its `*.deno.net` hostname and any custom domain
   still attached to it in Deno's console.
3. GitHub → **Settings → Applications → deno deploy → Configure** → remove
   `kitsonk/bayside-bricks`. This stops Deno building the retired Fresh app on
   every push to `main`.
4. Verify the removal:

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://bricks.kitsonkelly.deno.net/   # 404/410, or DNS NXDOMAIN
   curl -sS -o /dev/null -w '%{http_code}\n' https://bricks.kitandsimon.com/          # still 200 — the Worker
   ```

5. The follow-up repository change (this document): R4 deleted from
   `docs/ci-cd.md` §8, the fallback text dropped from `docs/deploy.md`, and §2
   above marked done.

### What R4 actually was

`https://bricks.kitsonkelly.deno.net` served the **legacy Fresh app at the
repository root**, built by Deno's GitHub integration from the last commit that
contained it — not the Astro build that runs on the Worker. R4 ("repoint
`bricks` at Deno Deploy") was therefore a *restore the old app* fallback, not a
rollback of the current codebase: it brought back the pre-migration site, with
its own markup and content, not the deployed version of this repository. It was
retired with the project. A rollback of the current app is a Worker version
rollback (`docs/ci-cd.md` R1) or a redeploy (R5); no document should describe R4
as a rollback of the current codebase.

### Deadline that no longer applies

The Deno console banner — *"Deno Deploy is shutting down in April 2027. Your
existing applications keep running until then."* — no longer constrains
anything: the project is gone ahead of it.

## 3. What was deliberately *not* touched

- No DNS record was edited by the decommissioning cards: `bricks` is
  Cloudflare-managed for the Worker binding and already resolves only to
  Cloudflare.
- The legacy Fresh source at the repository root was left in place by the
  verification card as the porting reference (`routes/`, `islands/`,
  `components/`, `static/`, `deno.json`, `main.ts`, `dev.ts`, `fresh.*`). It has
  since been retired and deleted (t_773ee38d, migration inventory §11.2 *archive
  the Fresh branch*); the deletion commit is the archive, and git history
  preserves the tree. The Deno project served its last successful build until
  the GitHub integration was disconnected and the project deleted on
  2026-11-13.
