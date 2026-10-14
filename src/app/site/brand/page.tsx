import type { Metadata } from "next";

import { OWNER_FACTS } from "@/components/site/facts";
import { Icon } from "@/components/brand/icons";
import { SectionHeading, Ticks, container } from "@/components/site/ui";
import { brandColor, type BrandColorName } from "@/lib/brand-colors";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `Brand and logos · ${SITE_NAME}` },
  description: `${SITE_NAME}'s logo, colours, type and words, for organizations, partners and press telling people about ${SITE_NAME}.`,
  alternates: { canonical: "/brand" },
  openGraph: { url: "/brand" },
};

/**
 * The public brand page (owner request 2026-10-13): the logo files to download, the colours, the two faces and the lines we
 * use. The files are served from public/brand/ (drawn by scripts/brand-logo-pngs.mjs); the full kit lives in brand/.
 */
export default function BrandPage() {
  return (
    <>
      <Hero />
      <Logos />
      <Colours />
      <TypeAndWords />
    </>
  );
}

function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <div aria-hidden className="absolute -left-32 -top-32 -z-10 h-[460px] w-[460px] rounded-full bg-saffron-50" />
      <div aria-hidden className="absolute -right-40 top-0 -z-10 h-[520px] w-[520px] rounded-full bg-navy-50" />
      <div className={`${container} flex flex-col items-center gap-5 pb-8 pt-14 text-center sm:pt-20`}>
        <span className="inline-flex rounded-full bg-saffron-50 px-3.5 py-1.5 text-[13px] font-bold uppercase tracking-[0.08em] text-brown">Brand</span>
        <h1 className="max-w-[760px] text-balance font-display text-[38px] font-bold leading-[1.04] tracking-[-0.03em] text-navy sm:text-[56px]">The Weaver brand</h1>
        <p className="max-w-[620px] text-[17px] leading-relaxed text-ink-2 sm:text-[19px]">
          Our logo, colours, type and words, for telling your members, partners and press about {SITE_NAME}. Please use them as they are.
        </p>
      </div>
    </section>
  );
}

// ── Logo files ───────────────────────────────────────────────────────────────

type Download = { label: string; file: string };
const LOGOS: { title: string; body: string; preview: string; ground: string; downloads: Download[] }[] = [
  {
    title: "The full logo",
    body: "For light backgrounds: documents, slides, newsletters.",
    preview: "/brand/weaver-logo.png",
    ground: "bg-white",
    downloads: [{ label: "PNG", file: "weaver-logo.png" }],
  },
  {
    title: "The full logo on indigo",
    body: "For dark backgrounds. The mark sits on its white tile.",
    preview: "/brand/weaver-logo-on-indigo.png",
    ground: "bg-navy",
    downloads: [{ label: "PNG", file: "weaver-logo-on-indigo.png" }],
  },
  {
    title: "The mark",
    body: "On its own, with a transparent background. SVG for anything that scales.",
    preview: "/brand/weaver-mark-512.png",
    ground: "bg-canvas",
    downloads: [
      { label: "SVG", file: "weaver-mark.svg" },
      { label: "PNG 256", file: "weaver-mark-256.png" },
      { label: "PNG 512", file: "weaver-mark-512.png" },
      { label: "PNG 1024", file: "weaver-mark-1024.png" },
    ],
  },
  {
    title: "The mark on white",
    body: "A square for profile pictures and app icons.",
    preview: "/brand/weaver-mark-on-white-1024.png",
    ground: "bg-ground",
    downloads: [{ label: "PNG 1024", file: "weaver-mark-on-white-1024.png" }],
  },
];

function Logos() {
  return (
    <section id="logos" aria-labelledby="logos-title" className="scroll-mt-24 py-10 sm:py-14">
      <div className={`${container} flex flex-col gap-8`}>
        <SectionHeading eyebrow="Logo" title="Download the logo" titleId="logos-title" />
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          {LOGOS.map((l) => (
            <li key={l.title} className="flex flex-col overflow-hidden rounded-card border border-line bg-white">
              <div className={`flex h-[200px] items-center justify-center p-6 ${l.ground}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a plain file from public/brand, shown as it is downloaded */}
                <img src={l.preview} alt={`${l.title}, preview`} className="max-h-full max-w-full object-contain" />
              </div>
              <div className="flex flex-1 flex-col gap-3 p-5 sm:p-6">
                <div>
                  <h3 className="font-display text-[20px] font-semibold leading-snug text-navy">{l.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-muted">{l.body}</p>
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  {l.downloads.map((d) => (
                    <a
                      key={d.file}
                      href={`/brand/${d.file}`}
                      download
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-full border-2 border-navy/20 bg-white px-4 text-[14px] font-bold text-navy transition-colors hover:border-navy"
                    >
                      <Icon name="arrow" className="h-4 w-4 rotate-90" strokeWidth={2.5} />
                      {d.label}
                    </a>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="mx-auto w-full max-w-[760px] rounded-card border border-line bg-white p-5 sm:p-6">
          <Ticks
            compact
            items={[
              "Use the files as they are: never recolour, outline, stretch or redraw the mark.",
              "On a dark background, use the logo on indigo, where the mark sits on its white tile.",
              "Leave the logo room to breathe, and keep the name and the mark together in the full logo.",
            ]}
          />
        </div>
      </div>
    </section>
  );
}

// ── Colours ──────────────────────────────────────────────────────────────────

/** The values are read from brand/tokens.json (src/lib/brand-colors.ts); the swatch classes are the kit's tokens (src/styles/brand-tokens.css). */
const COLOURS: { name: string; token: BrandColorName; swatch: string; use: string; dark: boolean }[] = [
  { name: "Indigo", token: "navy", swatch: "bg-navy", use: "Headings, buttons, bands", dark: true },
  { name: "Sunrise", token: "saffron", swatch: "bg-saffron", use: "The header and hero band, never text", dark: false },
  { name: "Sun gold", token: "gold", swatch: "bg-gold", use: "One highlight per view", dark: false },
  { name: "Ember", token: "brown", swatch: "bg-brown", use: "Accent text", dark: true },
  { name: "Ink", token: "ink", swatch: "bg-ink", use: "Body text", dark: true },
  { name: "Canvas", token: "canvas", swatch: "bg-canvas", use: "Page background", dark: false },
];

/** The colours for working screens: text you can read, controls you can see, and warnings. Read from brand/tokens.json too. */
const WORKING: { name: string; token: BrandColorName; swatch: string; use: string }[] = [
  { name: "Strong sunrise", token: "saffron-strong", swatch: "bg-saffron-strong", use: "Orange that carries white text, and orange text on white. Sunrise itself is for decoration" },
  { name: "Faint", token: "faint", swatch: "bg-faint", use: "Hints and timestamps, still 5:1 on white" },
  { name: "Control border", token: "line-control", swatch: "bg-line-control", use: "The outline of a field, checkbox or switch, 3.5:1 on white" },
  { name: "Warning", token: "warning", swatch: "bg-warning", use: "A warning's icon and title, with warning ink on a warm tint" },
  { name: "Success", token: "success", swatch: "bg-success", use: "A tick beside its words" },
  { name: "Danger", token: "danger", swatch: "bg-danger", use: "Errors, with what went wrong and how to fix it" },
];

function Colours() {
  return (
    <section id="colours" aria-labelledby="colours-title" className="scroll-mt-24 border-y border-line bg-ground py-10 sm:py-14">
      <div className={`${container} flex flex-col gap-8`}>
        <SectionHeading eyebrow="Colour" title="Indigo and sunrise" lead="Taken from the mark: indigo carries the brand, sunrise orange and sun gold bring the warmth." titleId="colours-title" />
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
          {COLOURS.map((c) => (
            <li key={c.name} className="flex flex-col overflow-hidden rounded-window border border-line bg-white">
              <div className={`flex h-[96px] items-end p-3 ${c.swatch} ${c.name === "Canvas" ? "border-b border-line" : ""}`}>
                <span className={`font-mono text-[13px] font-semibold ${c.dark ? "text-white" : "text-ink"}`}>{brandColor(c.token).toUpperCase()}</span>
              </div>
              <div className="p-3">
                <p className="font-display text-[17px] font-semibold text-navy">{c.name}</p>
                <p className="text-[13.5px] leading-snug text-muted">{c.use}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-4">
          <h3 className="font-display text-[22px] font-semibold text-navy">For working screens</h3>
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
            {WORKING.map((c) => (
              <li key={c.name} className="flex flex-col overflow-hidden rounded-window border border-line bg-white">
                <div className={`h-[56px] ${c.swatch}`} />
                <div className="p-3">
                  <p className="font-display text-[17px] font-semibold text-navy">{c.name}</p>
                  <p className="font-mono text-[13px] font-semibold text-muted">{brandColor(c.token).toUpperCase()}</p>
                  <p className="mt-1 text-[13.5px] leading-snug text-muted">{c.use}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ── Type and words ───────────────────────────────────────────────────────────

const LINES: { use: string; line: string }[] = [
  { use: "The promise", line: "Do more good. Weaver handles the operations. For free. Forever." },
  { use: "Why it is free", line: "This is our way of paying it forward." },
  { use: "What we believe", line: "Every hour a volunteer spends on admin is an hour taken from the mission." },
  { use: "How we use AI", line: "AI does the busywork. People make the final decisions." },
];

function TypeAndWords() {
  const faces = [
    { name: "Bricolage Grotesque", role: "Headings and the name", sample: "Do more good.", className: "font-display text-[36px] font-bold leading-none tracking-[-0.03em]", href: "https://fonts.google.com/specimen/Bricolage+Grotesque" },
    { name: "Hanken Grotesk", role: "Everything else", sample: "Members, giving, events and classes.", className: "text-[20px] leading-snug", href: "https://fonts.google.com/specimen/Hanken+Grotesk" },
    { name: "JetBrains Mono", role: "Identifiers only: numbers and codes", sample: "JSH-H-2041 · 0417", className: "font-mono text-[20px] font-medium leading-snug", href: "https://fonts.google.com/specimen/JetBrains+Mono" },
  ];
  return (
    <section id="words" aria-labelledby="words-title" className="scroll-mt-24 py-10 sm:py-14 lg:py-16">
      <div className={`${container} grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-12`}>
        <div className="flex flex-col gap-5">
          <SectionHeading align="left" eyebrow="Type" title="Two faces, and one for numbers" titleId="type-title" />
          <ul className="flex flex-col gap-3">
            {faces.map((f) => (
              <li key={f.name} className="rounded-card border border-line bg-white p-5 sm:p-6">
                <p className={`text-navy ${f.className}`}>{f.sample}</p>
                <p className="mt-3 text-[15px] text-muted">
                  <span className="font-bold text-ink">{f.name}</span> · {f.role} ·{" "}
                  <a href={f.href} className="font-bold text-navy underline underline-offset-4">
                    Google Fonts
                  </a>
                </p>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-5">
          <SectionHeading align="left" eyebrow="Words" title="The lines we use" titleId="words-title" />
          <ul className="flex flex-col gap-3">
            {LINES.map((l) => (
              <li key={l.use} className="rounded-card border border-line bg-white p-5">
                <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-brown">{l.use}</p>
                <p className="mt-1 font-display text-[19px] font-semibold leading-snug text-navy">{l.line}</p>
              </li>
            ))}
          </ul>
          <p className="text-[15px] leading-relaxed text-muted">
            Please quote these word for word. Say &ldquo;pledge&rdquo;, never &ldquo;bid&rdquo;, and &ldquo;mission-driven organizations&rdquo; when you mean everyone Weaver serves.
            {OWNER_FACTS.contactEmail ? ` Questions about the brand? Write to ${OWNER_FACTS.contactEmail}.` : ""}
          </p>
        </div>
      </div>
    </section>
  );
}
