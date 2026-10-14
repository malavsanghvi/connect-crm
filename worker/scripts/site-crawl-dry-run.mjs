// Print "what we found" for a saved page or a folder of saved pages, with no network, so a person can eyeball it.
//
//   node worker/scripts/site-crawl-dry-run.mjs worker/test/fixtures/sites/temple/home.html
//   node worker/scripts/site-crawl-dry-run.mjs worker/test/fixtures/sites/temple --mode reference
//   node worker/scripts/site-crawl-dry-run.mjs page.html --url https://www.example.org/events --css site.css --json
//
// A file: the page's facts (kind, headings, menu, images, contact, events, layout). A folder: the whole site report as
// the crawl job would save it; if the folder sits beside an expected.json (the test fixtures do) the pages get their
// real addresses, else they are served from --url's site (default https://www.example.org/<file>).
// Options: --mode own|reference (default own) · --url <address of the page, or of the site for a folder> ·
//          --css <file> (repeatable: a stylesheet of the site) · --json (print the raw result instead of the summary).
// The extractors are TypeScript: they are bundled in memory with esbuild (a dev dependency of the worker).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { build } = await import(pathToFileURL(join(here, "..", "node_modules", "esbuild", "lib", "main.js")).href).catch(() => import("esbuild"));

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const flagAll = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const target = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--json"));
if (!target) {
  console.error("Usage: node worker/scripts/site-crawl-dry-run.mjs <saved page .html | folder of pages> [--mode own|reference] [--url <address>] [--css <file>] [--json]");
  process.exit(2);
}
const mode = flag("--mode") ?? "own";
if (mode !== "own" && mode !== "reference") {
  console.error('--mode must be "own" or "reference".');
  process.exit(2);
}

// Bundle the extractors (TypeScript) into one module held in memory.
const entry = `export { extractPage } from ${JSON.stringify(join(here, "..", "src", "web", "site", "extract.ts").replace(/\\/g, "/"))};
export { buildReport, describeNotes, findContentLeaks, sizeOf } from ${JSON.stringify(join(here, "..", "src", "web", "site", "report.ts").replace(/\\/g, "/"))};`;
const out = await build({ stdin: { contents: entry, resolveDir: here, loader: "ts" }, bundle: true, write: false, platform: "node", format: "esm", target: "node22", logLevel: "silent" });
const lib = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

const read = (p) => readFileSync(p, "utf8");
const css = flagAll("--css").map((p) => read(resolve(p)));
const line = (s = "") => console.log(s);
const list = (xs, f) => xs.map(f).join("\n");

function summarizePage(f) {
  line(`\n${f.path}   [${f.classification.kind} ${Math.round(f.classification.confidence * 100)}%${f.classification.runner_up ? `, next: ${f.classification.runner_up}` : ""}]   ${f.built_by_scripts ? "(little text found, built by scripts)" : ""}`);
  line(`  title: ${f.short_title || f.title}   words: ${f.words}   sections: ${f.section_count}   images: ${f.image_count}   forms: ${f.forms}`);
  if (f.description) line(`  description: ${f.description.slice(0, 100)}`);
  const hs = [];
  const walk = (hh, d) => hh.forEach((h) => { hs.push(`${"  ".repeat(d)}h${h.level} ${h.text}`); walk(h.children, d + 1); });
  walk(f.headings, 0);
  if (hs.length) line("  headings:\n" + hs.slice(0, 14).map((s) => "    " + s).join("\n"));
  if (f.layout.length) line(`  layout: ${f.layout.join(" > ")}${f.hero ? `   (hero: ${f.hero.style}${f.hero.has_cta ? ", with button" : ""}${f.hero.tall ? ", tall" : ""})` : ""}`);
  if (f.nav) line(`  menu: ${f.nav.top_level_count} items, depth ${f.nav.depth}${f.nav.cta ? `, button "${f.nav.cta}"` : ""}${f.nav.mobile_toggle ? ", mobile toggle" : ""}: ${f.nav.items.map((i) => i.label + (i.children.length ? ` (+${i.children.length})` : "")).join(" | ")}`);
  if (f.footer) line(`  footer: ${f.footer.columns} columns, ${f.footer.link_count} links${f.footer.has_social ? ", social" : ""}${f.footer.has_newsletter ? ", newsletter" : ""}${f.footer.has_address ? ", address" : ""}`);
  const roles = {};
  f.images.forEach((i) => (roles[i.role] = (roles[i.role] ?? 0) + 1));
  if (f.image_count) line(`  images: ${JSON.stringify(roles)}   e.g. ${f.images.slice(0, 2).map((i) => `${i.role}:${i.src.split("/").pop()}`).join(", ")}`);
  if (f.social.length) line(`  social: ${f.social.map((s) => s.network).join(", ")}`);
  const c = f.contact;
  if (c.emails.length + c.phones.length + c.addresses.length) line(`  contact: ${[...c.emails, ...c.phones, ...c.addresses].join(" ; ")}`);
  if (f.events.length) line(`  events (${f.event_count}):\n` + list(f.events.slice(0, 5), (e) => `    ${e.date_text}${e.time_text ? " " + e.time_text : ""}  ${e.title}`));
  if (f.donate_links.length) line(`  donate: ${f.donate_links.map((d) => `${d.label || "(link)"} -> ${d.external ? "external" : "this site"}`).join("; ")}`);
  if (f.sections[0]) line(`  first section: "${f.sections[0].excerpt.slice(0, 110)}"`);
}

function summarizeSite(r) {
  if (r.mode === "reference") {
    line(JSON.stringify(r, null, 2));
    return;
  }
  line(`\nSITE ${r.site}   (${r.mode})   pages: ${r.pages.length}   result size: ${lib.sizeOf(r)} bytes   trimmed: ${r.trimmed}`);
  const o = r.organization;
  line(`  organization: ${o.name} | contact: ${[...o.contact.emails, ...o.contact.phones, ...o.contact.addresses].join(" ; ")} | social: ${o.social.map((s) => s.network).join(", ")}`);
  line(`  palette: ${r.look.palette.colors.map((c) => `${c.hex} ${c.role} ${Math.round(c.share * 100)}%`).join(", ")}`);
  r.look.palette.contrast.forEach((c) => line(`    contrast: ${c.note}`));
  line(`  fonts: heading ${r.look.fonts.heading ?? "?"} | body ${r.look.fonts.body ?? "?"} | all: ${r.look.fonts.fonts.map((f) => `${f.name} (${f.source})`).join(", ")}`);
  line(`  logo candidates: ${r.look.logo_candidates.map((l) => `${l.source}:${l.url.split("/").pop()}`).join(", ")}`);
  line(`  home pattern: ${r.structure.home_pattern.join(" > ")}`);
  line(`  page kinds: ${JSON.stringify(r.structure.page_kinds)}`);
  r.pages.forEach((p) => line(`  ${p.path.padEnd(34)} ${p.kind.padEnd(10)} ${String(Math.round(p.confidence * 100)).padStart(3)}%  ${p.title}`));
  if (r.notes.length) lib.describeNotes(r.notes).forEach((n) => line("  note: " + n));
}

const t = resolve(target);
if (statSync(t).isFile()) {
  const url = flag("--url") ?? `https://www.example.org/${basename(t).replace(/\.html?$/, "")}`;
  const facts = lib.extractPage(read(t), url, { isStart: basename(t).startsWith("home") });
  if (args.includes("--json")) console.log(JSON.stringify(facts, null, 2));
  else summarizePage(facts);
} else {
  const files = readdirSync(t).filter((f) => f.endsWith(".html")).sort((a, b) => (a === "home.html" ? -1 : b === "home.html" ? 1 : a.localeCompare(b)));
  const expectedPath = join(dirname(t), "expected.json");
  const exp = existsSync(expectedPath) ? JSON.parse(read(expectedPath))[basename(t)] : null;
  const site = flag("--url") ?? exp?.base ?? "https://www.example.org";
  const pages = files.map((f) => lib.extractPage(read(join(t, f)), site.replace(/\/$/, "") + (exp?.pages[f]?.path ?? (f === "home.html" ? "/" : "/" + f.replace(/\.html$/, ""))), { isStart: f === "home.html" }));
  const stats = { pages_fetched: pages.length, pages_in_sitemap: 0, sitemap_used: false, stopped_by: "done", bytes: 0, elapsed_ms: 0, skipped: { robots: 0, off_site: 0, off_site_redirect: 0, files: 0, errors: 0 }, css_files_read: css.length };
  const notes = pages.some((p) => p.built_by_scripts) ? [{ code: "scripts_built", count: pages.filter((p) => p.built_by_scripts).length }] : [];
  const report = lib.buildReport({ mode, startUrl: site, pages, css, stats, notes });
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    if (mode === "own") pages.forEach(summarizePage);
    summarizeSite(report);
    if (mode === "reference") line(`\ncopyright check: ${lib.findContentLeaks(report).length === 0 ? "clean (no text, no addresses)" : "LEAKS: " + lib.findContentLeaks(report).join("; ")}`);
  }
}
