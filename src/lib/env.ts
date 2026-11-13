/**
 * Resolve an environment value in every runtime this app runs under:
 *
 * - `wrangler dev` / deployed Worker: bindings (vars and secrets) are exposed
 *   via `process.env` thanks to `nodejs_compat`; the live value wins.
 * - `astro dev`: Vite replaces `process.env` with an empty object, so values
 *   come from `.env` files through `import.meta.env` instead.
 *
 * Secrets never belong in `import.meta.env` (it is baked at build time) — put
 * them in `.dev.vars` locally and in Workers secrets in production.
 */
export function env(name: string): string | undefined {
  try {
    const fromProcess = process.env[name];
    if (fromProcess) return fromProcess;
  } catch {
    // `process` is not defined in every runtime.
  }
  return import.meta.env[name] as string | undefined;
}
