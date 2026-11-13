#!/usr/bin/env node
// Build-then-smoke harness for the Worker: boots `wrangler dev` against the
// adapter-generated config, waits for /health, runs scripts/smoke.mjs, and
// always tears the server down. This is the "test" step in CI — the app has no
// unit tests (MIGRATION_INVENTORY.md §7), so the route table IS the test suite.
//
//   npm run build && npm test
//
// Env:
//   SMOKE_PORT   port for wrangler dev (default 8787)
//   SMOKE_ARGS   extra args passed to smoke.mjs (e.g. "--images")
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(ROOT, "dist", "server", "wrangler.json");
const WRANGLER = path.join(ROOT, "node_modules", ".bin", "wrangler");
const PORT = Number(process.env.SMOKE_PORT ?? 8787);
const BASE = `http://127.0.0.1:${PORT}`;
const WAIT_MS = Number(process.env.SMOKE_WAIT_MS ?? 90_000);

if (!existsSync(CONFIG)) {
  console.error(`missing ${path.relative(ROOT, CONFIG)} — run \`npm run build\` first`);
  process.exit(1);
}
if (!existsSync(WRANGLER)) {
  console.error("missing node_modules/.bin/wrangler — run `npm install` first");
  process.exit(1);
}

const env = {
  ...process.env,
  CI: "1",
  WRANGLER_SEND_METRICS: "false",
  // Never let a stray local .dev.vars / .env difference mask a missing binding:
  // the app requires no secrets (README.md env matrix).
  APP_ENV: process.env.APP_ENV ?? "development",
};

const server = spawn(
  WRANGLER,
  ["dev", "-c", CONFIG, "--port", String(PORT), "--ip", "127.0.0.1", "--show-interactive-dev-session=false"],
  { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] },
);

let serverLog = "";
let shuttingDown = false;
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

let exited = false;
server.on("exit", (code, signal) => {
  exited = true;
  if (!shuttingDown) {
    console.error(`wrangler dev exited early (code=${code} signal=${signal})\n${serverLog}`);
    process.exit(1);
  }
});

function shutdown(code) {
  shuttingDown = true;
  // Set the code up front: if the event loop drains before the timers below
  // run, Node exits "naturally" with whatever `process.exitCode` holds.
  process.exitCode = code;
  if (exited) process.exit(code);
  if (!exited) server.kill("SIGTERM");
  // Deliberately NOT unref'd. An unref'd timer does not keep the event loop
  // alive, so Node could drain and exit 0 before `process.exit(code)` ran —
  // that turned a failing smoke suite into a green `npm test`. The timer is a
  // 2s backstop only; the common path is the `exit` listener below.
  const force = setTimeout(() => {
    if (!exited) server.kill("SIGKILL");
    process.exit(code);
  }, 2000);
  server.once("exit", () => {
    clearTimeout(force);
    process.exit(code);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForReady() {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if (exited) return false;
    try {
      const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      /* not listening yet */
    }
    await sleep(500);
  }
  return false;
}

const ready = await waitForReady();
if (!ready) {
  console.error(`wrangler dev did not become ready at ${BASE}/health within ${WAIT_MS}ms\n${serverLog}`);
  shutdown(1);
} else {
  console.log(`wrangler dev ready at ${BASE}\n`);
  const smokeArgs = [path.join(ROOT, "scripts", "smoke.mjs"), BASE];
  if (process.env.SMOKE_ARGS) smokeArgs.push(...process.env.SMOKE_ARGS.split(/\s+/).filter(Boolean));
  const smoke = spawn(process.execPath, smokeArgs, { cwd: ROOT, stdio: "inherit" });
  smoke.on("exit", (code) => shutdown(code ?? 1));
}
