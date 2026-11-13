import type { APIRoute } from "astro";
import { env } from "../lib/env";

/**
 * Simple health endpoint: always 200, never cached. Reports the service name
 * and which non-secret APP_ENV value is configured — never secret values.
 */
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      status: "ok",
      service: "bayside-bricks",
      appEnv: env("APP_ENV") ?? "unset",
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
