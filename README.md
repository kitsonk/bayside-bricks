# Bayside Brickstore

> **Migrated.** The site is served by a Cloudflare Worker (`bayside-bricks`) built
> from [`web/`](web/) — Astro 7 on Node.js 20+, deployed with Wrangler — and has
> been live on <https://bricks.kitandsimon.com> since 2026-11-13. Production was
> verified against the previous Deno Deploy site, rendering included:
> [`docs/verification-2026-11-13.md`](docs/verification-2026-11-13.md). The Deno
> Deploy project is scheduled for deletion
> ([`docs/decommission.md`](docs/decommission.md)); the Deno Fresh app at this
> root is kept only as the porting reference until that is done.
>
> Operate it with [`docs/ci-cd.md`](docs/ci-cd.md) (runbook),
> [`web/docs/deploy.md`](web/docs/deploy.md) (pipeline) and
> [`docs/cutover-2026-11-13.md`](docs/cutover-2026-11-13.md) (cutover record).

The Fresh project below is the original application, no longer deployed to the
public hostname.

Your new Fresh project is ready to go. You can follow the Fresh "Getting
Started" guide here: https://fresh.deno.dev/docs/getting-started

### Usage

Make sure to install Deno: https://deno.land/manual/getting_started/installation

Then start the project:

```
deno task start
```

This will watch the project directory and restart as necessary.
