#!/usr/bin/env node
// Route-table smoke test for the Bayside Bricks Worker.
//
//   node scripts/smoke.mjs [base-url] [--images]
//
// Defaults to http://127.0.0.1:8787 (the `wrangler dev` port). The assertions
// encode the parity contract from MIGRATION_INVENTORY.md §3/§13 and the port
// card (t_7186c773): the legacy URLs must keep their exact paths and status
// codes, the custom 404 keeps its title, and no response may ever grow a
// frame-blocking header (the page is embedded in the BrickLink storefront).
//
// `--images` adds the /img/<id>.JPG self-hosting assertions. They are OFF by
// default because the seven BrickLink photos are still hotlinked until
// t_e45969d3 flips them (web/README.md, "Static assets"). Turn them on in CI
// once that card lands.
//
// Exit codes: 0 all checks pass; 1 at least one check failed.

const DEFAULT_BASE = "http://127.0.0.1:8787";
const NOT_FOUND_TITLE = "404 - Page not found";
const HOME_TITLE = "Bayside Brickstore PIPEFAIL-PROOF";
const IMAGE_IDS = ["1035859", "1035787", "1035788", "1035789", "1035790", "1035791", "1035792"];

const args = process.argv.slice(2);
const checkImages = args.includes("--images");
const base = (args.find((a) => !a.startsWith("--")) ?? DEFAULT_BASE).replace(/\/+$/, "");
// *.workers.dev is fronted by Cloudflare, which serves its own boilerplate
// /robots.txt (content-signal directives) regardless of the Worker's routes.
// The legacy site 404s that path, and the custom domain must too — so the
// assertion stays strict everywhere except the workers.dev preview/production
// host, where the platform response is reported as SKIP instead of PASS/FAIL.
const isWorkersDev = /\.workers\.dev$/i.test(new URL(base).hostname);

/** @type {{name: string, url: string, method?: string, status: number, type?: RegExp, body?: RegExp, headers?: Record<string, RegExp>}[]} */
const cases = [
  { name: "home", url: "/", status: 200, type: /^text\/html/, body: new RegExp(`<title>${HOME_TITLE}</title>`) },
  { name: "home/HEAD", url: "/", method: "HEAD", status: 200, type: /^text\/html/ },
  {
    name: "styles.css at legacy URL",
    url: "/styles.css",
    status: 200,
    type: /^text\/css/,
    body: /\.(container|mx-auto|flex)\b/,
  },
  { name: "logo.svg", url: "/logo.svg", status: 200, type: /^image\/svg\+xml/ },
  { name: "favicon.ico", url: "/favicon.ico", status: 200 },
  {
    name: "vendored iframeResizer 3.5.3",
    url: "/vendor/iframeResizer.contentWindow.3.5.3.min.js",
    status: 200,
    body: /3\.5\.3/,
  },
  { name: "health", url: "/health", status: 200, type: /^application\/json/, body: /"status"\s*:\s*"ok"/ },
  { name: "404 /index", url: "/index", status: 404, type: /^text\/html/, body: new RegExp(`<title>${NOT_FOUND_TITLE}</title>`) },
  { name: "404 /index.html", url: "/index.html", status: 404, body: new RegExp(`<title>${NOT_FOUND_TITLE}</title>`) },
  { name: "404 /robots.txt", url: "/robots.txt", status: 404, body: new RegExp(`<title>${NOT_FOUND_TITLE}</title>`) },
  { name: "404 /sitemap.xml", url: "/sitemap.xml", status: 404, body: new RegExp(`<title>${NOT_FOUND_TITLE}</title>`) },
  { name: "404 unmatched path", url: "/nonexistent", status: 404, body: new RegExp(`<title>${NOT_FOUND_TITLE}</title>`) },
  // The BrickLink storefront embeds this page in an iframe: X-Frame-Options or
  // a CSP frame-ancestors directive breaks the embed silently. Never allow it.
  { name: "no X-Frame-Options on /", url: "/", status: 200, headers: { "x-frame-options": /^$/ } },
  { name: "no X-Frame-Options on 404", url: "/nonexistent", status: 404, headers: { "x-frame-options": /^$/ } },
  { name: "no frame-ancestors in CSP", url: "/", status: 200, headers: { "content-security-policy": /^(?!.*frame-ancestors).*$/s } },
];

if (checkImages) {
  for (const id of IMAGE_IDS) {
    cases.push({ name: `/img/${id}.JPG`, url: `/img/${id}.JPG`, status: 200, type: /^image\/jpeg/ });
  }
}

const results = [];

for (const c of cases) {
  const url = base + c.url;
  const method = c.method ?? "GET";
  let ok = true;
  let skipped = false;
  let detail = "";
  try {
    const res = await fetch(url, { method, redirect: "manual" });
    const headers = res.headers;
    const type = headers.get("content-type") ?? "";
    // HEAD has no meaningful body; every other check may assert on one.
    const body = method === "HEAD" ? "" : await res.text();

    if (res.status !== c.status) {
      ok = false;
      detail += `status ${res.status} != ${c.status}; `;
    }
    if (ok && c.type && !c.type.test(type)) {
      ok = false;
      detail += `content-type ${JSON.stringify(type)} !~ ${c.type}; `;
    }
    if (ok && c.body && !c.body.test(body)) {
      ok = false;
      detail += `body !~ ${c.body}; `;
    }
    if (ok && c.headers) {
      for (const [name, re] of Object.entries(c.headers)) {
        const value = headers.get(name) ?? "";
        if (!re.test(value)) {
          ok = false;
          detail += `${name}: ${JSON.stringify(value)} !~ ${re}; `;
        }
      }
    }
    if (ok) detail = `${res.status} ${type || "(no content-type)"}`.trim();
    // Cloudflare's workers.dev boilerplate robots.txt is platform behaviour, not
    // app behaviour: report it as skipped rather than a failure.
    if (!ok && isWorkersDev && c.url === "/robots.txt" && /content-signal/i.test(body)) {
      ok = true;
      skipped = true;
      detail = `SKIP: merged/replaced by Cloudflare's workers.dev robots.txt (content-signal, ${body.length} bytes) — asserts 404 on the custom domain`;
    }
  } catch (err) {
    ok = false;
    detail = `request failed: ${err.message}`;
  }
  results.push({ ...c, ok, skipped, detail });
}

const failed = results.filter((r) => !r.ok);
const skippedCount = results.filter((r) => r.skipped).length;
const width = Math.max(...results.map((r) => r.name.length));
console.log(`smoke: ${base}${checkImages ? " (with /img assertions)" : ""}\n`);
for (const r of results) {
  console.log(`${r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}`);
}
console.log(`\n${results.length - failed.length - skippedCount}/${results.length - skippedCount} checks passed${skippedCount ? `, ${skippedCount} skipped` : ""}`);
if (failed.length) {
  console.error(`\n${failed.length} smoke check(s) failed`);
  process.exit(1);
}
