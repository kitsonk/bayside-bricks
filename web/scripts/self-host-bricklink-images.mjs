#!/usr/bin/env node
// Self-host the 7 BrickLink `myImg` photos referenced by src/pages/index.astro.
//
// Why: the legacy site hotlinked these images from www.bricklink.com. During the
// BrickLink outage of 2026-11-06→09 that made the live page render broken images,
// so the port self-hosts them under /img/<id>.JPG (MIGRATION_INVENTORY.md §13.2).
//
//   node scripts/self-host-bricklink-images.mjs --check
//       Report which files are present/valid and whether index.astro still hotlinks.
//   node scripts/self-host-bricklink-images.mjs
//       Fetch all 7 from BrickLink, validate, write to public/img/.
//   node scripts/self-host-bricklink-images.mjs --originals <dir>
//       Same, but copy from a local directory (e.g. Simon's originals).
//   node scripts/self-host-bricklink-images.mjs --rewrite
//       Point index.astro's seven src= at /img/<id>.JPG (requires all 7 valid).
//
// Nothing is written unless the bytes pass JPEG validation, so a BrickLink
// maintenance/redirect response can never end up saved as a .JPG.
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMG_DIR = path.join(ROOT, "public", "img");
const INDEX = path.join(ROOT, "src", "pages", "index.astro");
const ORIGIN = "https://www.bricklink.com/myImg";
const IDS = ["1035859", "1035787", "1035788", "1035789", "1035790", "1035791", "1035792"];

const HOTLINK_COMMENT =
  "// The 7 Bricklink myImg JPGs remain hotlinked at their original URLs for\n" +
  "// parity; self-hosting into public/img/ is owned by the assets card (§13.2).";
const SELFHOSTED_COMMENT =
  "// The 7 Bricklink myImg JPGs are self-hosted from public/img/ (§13.2); the\n" +
  "// originals were fetched from https://www.bricklink.com/myImg/<id>.JPG.";

/** JPEG sanity: SOI magic, an EOI marker, and a plausible size. */
function jpegInfo(buf) {
  const problems = [];
  if (buf.length < 1024) problems.push(`only ${buf.length} bytes`);
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) problems.push("missing JPEG SOI magic (ffd8ff)");
  if (buf.indexOf(Buffer.from([0xff, 0xd9])) < 0) problems.push("no JPEG EOI marker (ffd9)");
  // Walk the marker chain for the first SOFn to report dimensions.
  let w = null, h = null;
  for (let i = 2; i + 9 < buf.length; ) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      h = buf.readUInt16BE(i + 5);
      w = buf.readUInt16BE(i + 7);
      break;
    }
    i += 2 + len;
  }
  if (w === null) problems.push("no SOF frame header");
  return { ok: problems.length === 0, problems, width: w, height: h };
}

async function checkOne(id) {
  const file = path.join(IMG_DIR, `${id}.JPG`);
  try {
    const buf = await readFile(file);
    const info = jpegInfo(buf);
    return { id, file, present: true, bytes: buf.length, ...info };
  } catch {
    return { id, file, present: false, ok: false, bytes: 0, problems: ["not present"] };
  }
}

async function hotlinked() {
  const src = await readFile(INDEX, "utf8");
  return IDS.filter((id) => src.includes(`${ORIGIN}/${id}.JPG`));
}

function report(rows) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("id", 10) + pad("status", 10) + pad("bytes", 10) + "dimensions");
  for (const r of rows) {
    const dims = r.width ? `${r.width}x${r.height}` : "-";
    const status = r.ok ? "valid" : r.present ? "INVALID" : "missing";
    console.log(pad(r.id, 10) + pad(status, 10) + pad(r.bytes || "-", 10) + dims);
    if (r.problems?.length) console.log(`          ! ${r.problems.join("; ")}`);
  }
}

async function fetchOne(id) {
  const url = `${ORIGIN}/${id}.JPG`;
  const res = await fetch(url, { redirect: "manual", headers: { "user-agent": "bayside-bricks-migration/1.0" } });
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`${id}: HTTP ${res.status} redirect → ${res.headers.get("location") ?? "?"} (BrickLink unavailable)`);
  }
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new Error(`${id}: content-type ${type || "(none)"} is not an image`);
  const buf = Buffer.from(await res.arrayBuffer());
  const info = jpegInfo(buf);
  if (!info.ok) throw new Error(`${id}: downloaded bytes are not a valid JPEG (${info.problems.join("; ")})`);
  return buf;
}

async function copyOne(id, dir) {
  const names = await readdir(dir);
  const match = names.find((n) => n.replace(/\.jpe?g$/i, "") === id && /\.jpe?g$/i.test(n));
  if (!match) throw new Error(`${id}: no ${id}.JPG/.jpg in ${dir}`);
  const buf = await readFile(path.join(dir, match));
  const info = jpegInfo(buf);
  if (!info.ok) throw new Error(`${id}: ${match} is not a valid JPEG (${info.problems.join("; ")})`);
  return buf;
}

async function rewrite() {
  const rows = await Promise.all(IDS.map(checkOne));
  const bad = rows.filter((r) => !r.ok);
  if (bad.length) throw new Error(`refusing to rewrite: ${bad.length}/7 images not valid (run --check)`);
  let src = await readFile(INDEX, "utf8");
  let changed = 0;
  for (const id of IDS) {
    const hot = `${ORIGIN}/${id}.JPG`;
    if (!src.includes(hot)) continue;
    src = src.split(`src="${hot}"`).join(`src="/img/${id}.JPG"`);
    if (src.includes(hot)) throw new Error(`${id}: hotlink survived rewrite (unexpected attribute shape)`);
    changed++;
  }
  if (src.includes(HOTLINK_COMMENT)) src = src.split(HOTLINK_COMMENT).join(SELFHOSTED_COMMENT);
  await writeFile(INDEX, src);
  console.log(`rewrote ${changed} src attribute(s) in ${path.relative(ROOT, INDEX)}`);
  if (changed === 0) console.log("  (nothing to do — already self-hosted)");
}

async function main() {
  const args = process.argv.slice(2);
  const origIdx = args.indexOf("--originals");

  if (args.includes("--check")) {
    const rows = await Promise.all(IDS.map(checkOne));
    report(rows);
    const still = await hotlinked();
    console.log(`\nhotlinked in index.astro: ${still.length}/7${still.length ? ` (${still.join(", ")})` : ""}`);
    console.log(`valid on disk: ${rows.filter((r) => r.ok).length}/7`);
    process.exitCode = rows.every((r) => r.ok) && still.length === 0 ? 0 : 1;
    return;
  }

  if (args.includes("--rewrite")) {
    await rewrite();
    return;
  }

  const fromDir = origIdx >= 0 ? args[origIdx + 1] : null;
  if (origIdx >= 0 && !fromDir) throw new Error("--originals needs a directory");
  await mkdir(IMG_DIR, { recursive: true });

  const failures = [];
  for (const id of IDS) {
    try {
      const buf = fromDir ? await copyOne(id, fromDir) : await fetchOne(id);
      await writeFile(path.join(IMG_DIR, `${id}.JPG`), buf);
      const { width, height } = jpegInfo(buf);
      console.log(`ok    ${id}.JPG  ${buf.length} bytes  ${width}x${height}${fromDir ? "  (local original)" : ""}`);
    } catch (e) {
      failures.push(String(e.message ?? e));
      console.log(`FAIL  ${e.message ?? e}`);
    }
  }
  if (failures.length) {
    console.error(`\n${failures.length}/7 images not obtained — nothing was rewritten.`);
    console.error("BrickLink status: https://maintenance.bricklink.com/recovery.html");
    process.exitCode = 1;
    return;
  }
  console.log("\nAll 7 valid. Next: node scripts/self-host-bricklink-images.mjs --rewrite");
}

main().catch((e) => {
  console.error(`error: ${e.message ?? e}`);
  process.exitCode = 1;
});
