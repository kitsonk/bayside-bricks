import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// SSR target: Cloudflare Workers via the official adapter. `session: false`
// and `imageService: "passthrough"` keep the generated Worker free of unused
// SESSION (KV) and IMAGES bindings.
export default defineConfig({
  output: "server",
  session: false,
  adapter: cloudflare({ imageService: "passthrough" }),
});
