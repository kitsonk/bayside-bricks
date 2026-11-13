#!/usr/bin/env node
// Production verification for bricks.kitandsimon.com.
//
//   node scripts/verify-production.mjs [base-url] [--legacy <url>]
//
// `smoke.mjs` proves the route table and the frame-embedding contract on one
// host. This is the sign-off battery: it also proves the *platform* (DNS, TLS,
// which server answers, no Fresh headers), the SEO/head contract, asset
// integrity against the files in this repo, redirect/method behaviour, and —
// with `--legacy` — text and class parity against the Deno Deploy app the site
// was migrated from.
//
// Exit codes: 0 every check passed (WARN is not a failure); 1 at least one FAIL.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect } from "node:tls";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DEFAULT_BASE = "https://bricks.kitandsimon.com";
const HOME_TITLE = "Bayside Brickstore";
const NOT_FOUND_TITLE = "404 - Page not found";
const IMAGE_IDS = ["1035859", "1035787", "1035788", "1035789", "1035790", "1035791", "1035792"];
const VENDOR = "/vendor/iframeResizer.contentWindow.3.5.3.min.js";
const EXPECTED_NS = ["danica.ns.cloudflare.com", "vicente.ns.cloudflare.com"];

const here = dirname(fileURLToPath(import.meta.url));
const repoWeb = join(here, "..");

const args = process.argv.slice(2);
const legacyIdx = args.indexOf("--legacy");
const legacy = legacyIdx === -1 ? null : args[legacyIdx + 1];
const positional = args.filter((a, i) => !a.startsWith("--") && !(legacyIdx !== -1 && i === legacyIdx + 1));
const base = (positional[0] ?? DEFAULT_BASE).replace(/\/+$/, "");
const host = new URL(base).hostname;

const results = [];
const record = (name, ok, detail, level = "check") => {
  results.push({ name, ok, detail, level });
};
const pass = (name, detail) => record(name, true, detail);
const fail = (name, detail) => record(name, false, detail);
const warn = (name, detail) => record(name, true, detail, "warn");
const info = (name, detail) => record(name, true, detail, "info");

/** sha256 of a local file, or null when it is not in this checkout. */
async function localSha(rel) {
  try {
    return createHash("sha256").update(await readFile(join(repoWeb, rel))).digest("hex");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- DNS (DoH)
// Resolve through 1.1.1.1 rather than the OS resolver: the corporate resolver
// on the machine this was written on answers NXDOMAIN for `bricks` long after
// the name resolves everywhere else (docs/ci-cd.md §7.1).
async function doh(name, type) {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
  const res = await fetch(url, { headers: { accept: "application/dns-json" } });
  if (!res.ok) throw new Error(`DoH ${type} ${name}: HTTP ${res.status}`);
  const body = await res.json();
  return (body.Answer ?? []).map((a) => a.data);
}

// ---------------------------------------------------------------------- TLS
function tlsInfo(hostname) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: hostname, servername: hostname, port: 443, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate();
      const info = {
        protocol: socket.getProtocol(),
        subject: cert.subject?.CN,
        san: cert.subjectaltname ?? "",
        validFrom: cert.valid_from,
        validTo: cert.valid_to,
      };
      socket.end();
      resolve(info);
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("TLS connect timed out"));
    });
    socket.on("error", reject);
  });
}

// ------------------------------------------------------------------- parity
/** Normalise HTML to the things a reader sees and a stylesheet keys off. */
function shape(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  const classes = new Set();
  for (const m of html.matchAll(/class="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c) classes.add(c);
  return { text, classes: [...classes].sort() };
}

// ------------------------------------------------------------------- checks
async function checkDns() {
  try {
    const ns = (await doh("kitandsimon.com", "NS")).map((n) => n.replace(/\.$/, "")).sort();
    const expected = [...EXPECTED_NS].sort();
    if (JSON.stringify(ns) === JSON.stringify(expected)) pass("delegation", ns.join(", "));
    else fail("delegation", `got ${ns.join(", ") || "(none)"}, want ${expected.join(", ")}`);

    const a = await doh(`bricks.${host.split(".").slice(1).join(".")}`, "A");
    const cfIps = a.filter((ip) => /^(104\.|172\.6[4-9]\.|172\.7[0-1]\.)/.test(ip));
    if (a.length >= 2 && cfIps.length === a.length) pass("bricks resolves", a.join(", "));
    else warn("bricks resolves", `${a.join(", ") || "(none)"} — expected Cloudflare anycast addresses`);

    const mx = await doh("kitandsimon.com", "MX");
    const google = mx.filter((m) => /google\.com\.?$/i.test(m));
    if (mx.length && google.length === mx.length) pass("mail records", `${mx.length} MX, all Google Workspace`);
    else fail("mail records", mx.join(", ") || "(none)");
  } catch (err) {
    fail("dns", `DoH failed: ${err.message}`);
  }
}

async function checkTls() {
  try {
    const t = await tlsInfo(host);
    const covers = t.subject === host || t.san.includes(`DNS:${host}`) || t.san.includes(`DNS:*.${host.split(".").slice(1).join(".")}`);
    const notAfter = new Date(t.validTo);
    const daysLeft = Math.round((notAfter - Date.now()) / 86_400_000);
    if (covers && daysLeft > 0) pass("tls", `CN=${t.subject}, ${t.protocol}, ${daysLeft} days left`);
    else fail("tls", `CN=${t.subject}, covers=${covers}, expires ${t.validTo}`);
  } catch (err) {
    fail("tls", err.message);
  }
}

async function get(path, init = {}) {
  const res = await fetch(base + path, { redirect: "manual", ...init });
  return res;
}

async function checkPlatform() {
  const res = await get("/");
  const h = res.headers;
  const server = h.get("server") ?? "";
  if (/cloudflare/i.test(server)) pass("served by Cloudflare", `server: ${server}`);
  else fail("served by Cloudflare", `server: ${server || "(absent)"}`);
  const fresh = h.get("x-fresh-uuid");
  if (!fresh) pass("not the legacy Fresh app", "no x-fresh-uuid header");
  else fail("not the legacy Fresh app", `x-fresh-uuid: ${fresh}`);
  if (!/deployd/.test(h.get("via") ?? "")) pass("not Deno Deploy", "no via: deployd header");
  else fail("not Deno Deploy", `via: ${h.get("via")}`);
  const enc = h.get("content-encoding") ?? "";
  if (/gzip|br|zstd/.test(enc)) pass("compressed response", `content-encoding: ${enc}`);
  else warn("compressed response", `content-encoding: ${enc || "(none)"}`);
}

async function checkRoutes() {
  const cases = [
    ["/", 200, /^text\/html/],
    ["/health", 200, /^application\/json/],
    ["/styles.css", 200, /^text\/css/],
    ["/logo.svg", 200, /^image\/svg\+xml/],
    ["/favicon.ico", 200, /^image\//],
    [VENDOR, 200, /^text\/javascript/],
    ["/index", 404, /^text\/html/],
    ["/index.html", 404, /^text\/html/],
    ["/sitemap.xml", 404, null],
    ["/feed.xml", 404, null],
    ["/rss.xml", 404, null],
    ["/nonexistent", 404, /^text\/html/],
  ];
  for (const id of IMAGE_IDS) cases.push([`/img/${id}.JPG`, 200, /^image\/jpeg/]);

  for (const [path, status, type] of cases) {
    const res = await get(path);
    const ct = res.headers.get("content-type") ?? "";
    const ok = res.status === status && (!type || type.test(ct));
    if (ok) pass(`${path}`, `${res.status} ${ct}`);
    else fail(`${path}`, `${res.status} ${ct} — want ${status}${type ? ` ${type}` : ""}`);
  }

  // Cloudflare injects a managed robots.txt ahead of the Worker; any 2xx is the
  // platform, not the app (docs/ci-cd.md §7.2).
  const robots = await get("/robots.txt");
  if (robots.status === 404) pass("/robots.txt", "404 from the Worker");
  else if (robots.status >= 200 && robots.status < 300) {
    const body = await robots.text();
    info("/robots.txt", `${robots.status}, ${body.length} bytes — Cloudflare's managed file, the Worker never sees this path`);
  } else fail("/robots.txt", `status ${robots.status}`);
}

async function checkStatusPages() {
  const home = await (await get("/")).text();
  const notFound = await (await get("/nonexistent")).text();
  if (home.includes(`<title>${HOME_TITLE}</title>`)) pass("/ title", HOME_TITLE);
  else fail("/ title", "title mismatch");
  if (notFound.includes(`<title>${NOT_FOUND_TITLE}</title>`)) pass("404 title", NOT_FOUND_TITLE);
  else fail("404 title", "title mismatch");
  if (/<html[^>]*\blang="en"/.test(home)) pass("html lang", "en");
  else fail("html lang", "missing");
}

async function checkHeadContract() {
  const html = await (await get("/")).text();
  const checks = [
    ["charset", /<meta[^>]+charset=["']?utf-8/i.test(html)],
    ["viewport meta", /<meta[^>]+name="viewport"[^>]+width=device-width/i.test(html)],
    ["single h1", (html.match(/<h1\b/gi) ?? []).length === 1],
    // Deliberate parity with the legacy site: neither tag ever existed there.
    ["no meta description (parity)", !/<meta[^>]+name="description"/i.test(html)],
    ["no canonical (parity)", !/<link[^>]+rel="canonical"/i.test(html)],
    ["no og: tags (parity)", !/<meta[^>]+property="og:/i.test(html)],
    ["stylesheet at /styles.css", /<link[^>]+rel="stylesheet"[^>]+href="\/styles\.css"/i.test(html)],
    ["zero external scripts", (html.match(/<script[^>]+src="https?:/gi) ?? []).length === 0],
  ];
  for (const [name, ok] of checks) ok ? pass(name, "ok") : fail(name, "contract broken");
}

async function checkFrameContract() {
  for (const path of ["/", "/nonexistent", "/styles.css"]) {
    const h = (await get(path)).headers;
    const xfo = h.get("x-frame-options");
    const csp = h.get("content-security-policy") ?? "";
    if (!xfo) pass(`no X-Frame-Options ${path}`, "absent");
    else fail(`no X-Frame-Options ${path}`, xfo);
    if (!/frame-ancestors/i.test(csp)) pass(`no frame-ancestors ${path}`, csp ? "CSP present, no frame-ancestors" : "no CSP");
    else fail(`no frame-ancestors ${path}`, csp);
  }
}

async function checkAssetIntegrity() {
  const targets = [[VENDOR, "public/vendor/iframeResizer.contentWindow.3.5.3.min.js"], ...IMAGE_IDS.map((id) => [`/img/${id}.JPG`, `public/img/${id}.JPG`])];
  for (const [path, rel] of targets) {
    const local = await localSha(rel);
    if (!local) {
      warn(`sha256 ${path}`, `${rel} not in this checkout`);
      continue;
    }
    const bytes = Buffer.from(await (await get(path)).arrayBuffer());
    const remote = createHash("sha256").update(bytes).digest("hex");
    if (remote === local) pass(`sha256 ${path}`, `${bytes.length} bytes, matches ${rel}`);
    else fail(`sha256 ${path}`, `${remote} != ${local} (${rel})`);
  }
}

async function checkRedirectsAndMethods() {
  const probes = [
    ["/health/", [200, 301, 307, 308]],
    ["/HEALTH", [404]],
    ["/?utm_source=verify", [200]],
    ["/styles.css/", [404]],
  ];
  for (const [path, allowed] of probes) {
    const res = await get(path);
    if (allowed.includes(res.status)) pass(`probe ${path}`, `${res.status}${res.headers.get("location") ? ` -> ${res.headers.get("location")}` : ""}`);
    else fail(`probe ${path}`, `${res.status} — want one of ${allowed.join("/")}`);
  }

  const post = await get("/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "a=b" });
  if (post.status === 404 || post.status === 405) pass("POST / rejected", `status ${post.status}`);
  else warn("POST / rejected", `status ${post.status} — a static page normally answers 404/405`);

  // Cleartext HTTP. The zone's `Always Use HTTPS` setting is off, so this is a
  // platform observation rather than an app defect — report it, do not fail.
  try {
    const plain = await fetch(`http://${host}/`, { redirect: "manual" });
    if (plain.status >= 300 && plain.status < 400) pass("http -> https redirect", `${plain.status} -> ${plain.headers.get("location")}`);
    else warn("http -> https redirect", `http:// answers ${plain.status} with no redirect (zone: Always Use HTTPS off)`);
  } catch (err) {
    warn("http -> https redirect", err.message);
  }
}

async function checkParity(url) {
  const oldBase = url.replace(/\/+$/, "");
  for (const path of ["/", "/nonexistent"]) {
    const [a, b] = await Promise.all([fetch(oldBase + path).then((r) => r.text()), fetch(base + path).then((r) => r.text())]);
    const [as, bs] = [shape(a), shape(b)];
    if (as.text === bs.text) pass(`text parity ${path}`, `${as.text.length} chars byte-equal to the legacy app`);
    else {
      const at = as.text.split(" "), bt = bs.text.split(" ");
      const diff = at.findIndex((w, i) => w !== bt[i]);
      fail(`text parity ${path}`, `first difference at word ${diff}: ${JSON.stringify(at[diff])} vs ${JSON.stringify(bt[diff])}`);
    }
    const missing = as.classes.filter((c) => !bs.classes.includes(c));
    const extra = bs.classes.filter((c) => !as.classes.includes(c));
    if (!missing.length && !extra.length) pass(`class parity ${path}`, `${as.classes.length} classes identical`);
    else warn(`class parity ${path}`, `missing: ${missing.join(" ") || "-"}; extra: ${extra.join(" ") || "-"}`);
  }
}

// ---------------------------------------------------------------------- run
console.log(`verify-production: ${base}${legacy ? ` (parity vs ${legacy})` : ""}\n`);
await checkDns();
await checkTls();
await checkPlatform();
await checkRoutes();
await checkStatusPages();
await checkHeadContract();
await checkFrameContract();
await checkAssetIntegrity();
await checkRedirectsAndMethods();
if (legacy) await checkParity(legacy);

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  const tag = r.level === "warn" ? (r.ok ? "WARN" : "FAIL") : r.level === "info" ? "INFO" : r.ok ? "PASS" : "FAIL";
  console.log(`${tag}  ${r.name.padEnd(width)}  ${r.detail}`);
}
const failed = results.filter((r) => !r.ok);
const warned = results.filter((r) => r.level === "warn");
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed` +
    (warned.length ? `, ${warned.length} warning(s)` : "") +
    `, ${results.filter((r) => r.level === "info").length} informational`,
);
if (failed.length) {
  console.error(`\n${failed.length} check(s) FAILED`);
  process.exit(1);
}
