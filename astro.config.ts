import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// SSR target: Cloudflare Workers via the official adapter. `session: false`
// and `imageService: "passthrough"` keep the generated Worker free of unused
// SESSION (KV) and IMAGES bindings.
export default defineConfig({
  output: "server",
  session: false,
  adapter: cloudflare({ imageService: "passthrough" }),
  vite: {
    build: {
      rollupOptions: {
        output: {
          // Parity with the legacy Fresh app (MIGRATION_INVENTORY.md §3, §10):
          // the compiled Tailwind stylesheet must be served at the exact URL
          // /styles.css. All other assets keep Astro's hashed _astro/ layout.
          assetFileNames: (assetInfo) => {
            const names = assetInfo.names ?? (assetInfo.name ? [assetInfo.name] : []);
            return names.some((n) => n.endsWith(".css"))
              ? "styles.css"
              : "_astro/[name]-[hash][extname]";
          },
        },
      },
    },
  },
});
