// The Poster template (Flyers v2, owner decision 2026-10-02, approach C):
// our layout and every word set by code, over an occasion art pack — a frame
// and a bottom scene, drawn in code or cached text-free AI art. Server side
// only (imported by flyer-render.tsx); no client component imports it.
//
// The reference is the owner's JAINA 2027 Houston Host City Kick-Off poster:
// logo row (the community's logo and a partner's), a huge serif headline, a
// gold subhead between rules, a slogan, a highlight box (icon, small label,
// big number, caption), a date ribbon (date, time, venue), agenda rows (icon,
// fixed time column, wrapping text), a paragraph, a footer band with a credit,
// and an RSVP QR code in the bottom-left corner. Every section is optional.
//
// Satori cannot measure text, so planPoster() ESTIMATES each section's height
// from its words (generously) and shrinks the whole stack (k, down to 0.6)
// until it fits between the top and the scene's busy part; the bottom spacer
// takes what is left. The content column never shrinks: if an estimate were
// ever too small, the footer would be pushed out of the image, and
// tests/events-flyer-poster.test.ts (the magenta stage) fails.

import type { ReactElement, ReactNode } from "react";

import { flyerTextLength, type FlyerDesign, type PosterContent } from "./flyer";
import { artPack, frameEdgeSvg, plainPaperSvg, ribbonSvg, svgDataUri, type ArtPack, type PosterPalette } from "./flyer-art-packs";
import type { FlyerBrand } from "./flyer-brand";
import { posterIconUri, type PosterIcon } from "./flyer-icons";

export type PosterImage = { dataUri: string; w: number; h: number };

/** Pictures the poster needs that are not drawn in code: AI layers and the partner's logo (null: use the drawn art / the badge). */
export type PosterAssets = { frame: PosterImage | null; scene: PosterImage | null; partnerLogo: PosterImage | null };

export type PosterInput = {
  design: FlyerDesign;
  poster: PosterContent;
  brand: Pick<FlyerBrand, "primary" | "accent" | "background">;
  centerName: string;
  logo: PosterImage | null;
  assets: PosterAssets;
};

type Fonts = { display: string; body: string };

// ── Measures (units: the poster is 1080 wide) ───────────────────────────────
const W = 1080;
const FOOTER = 66;
const SIDE = 70; // the frame's ornaments: words stay inside this margin
const COL = W - 2 * SIDE;
/** The smallest scale the words are asked to take before something is left out. */
const K_MIN = 0.58;
/** The smallest scale there ever is: only when everything that can be left out has been. */
const K_FLOOR = 0.4;
/** Short content may grow a little (never past the frame: the agenda is 870 × 1.08 = 940 wide, the column's width). */
const K_MAX = 1.08;

/** Roughly how wide a line is, in units: generous on purpose (an overestimate only leaves more air). */
export function textWidth(s: string, size: number, o: { caps?: boolean; spacing?: number; serif?: boolean } = {}): number {
  const t = o.caps ? s.toUpperCase() : s;
  let em = 0;
  let count = 0;
  for (const ch of t) {
    count++;
    if (ch === " ") em += 0.27;
    else if (/[MW@%&]/.test(ch)) em += 0.86;
    else if (/[A-Z]/.test(ch)) em += 0.7;
    else if (/[0-9]/.test(ch)) em += 0.6;
    else if (/[ilj.,:;'’!|()\-–]/.test(ch)) em += 0.32;
    else if (/[mw]/.test(ch)) em += 0.82;
    else em += 0.56;
  }
  return em * size * (o.serif ? 1.06 : 1) + (o.spacing ?? 0) * count;
}

/** How many lines a text wraps to in `width` units (wrapping wastes some of each line it breaks). */
export function lineCount(s: string, size: number, width: number, o: { caps?: boolean; spacing?: number; serif?: boolean } = {}): number {
  if (!s.trim()) return 0;
  const tw = textWidth(s, size, o);
  if (tw <= width * 0.97) return 1;
  return Math.max(2, Math.ceil(tw / (width * 0.86)));
}

/** The headline's size and lines: as big as 142 on one line, giving way to two, three or four lines for long ones. */
export function headlineFit(text: string, maxWidth = COL - 20): { size: number; lines: number } {
  const w142 = textWidth(text, 142, { serif: true });
  const floors = [100, 74, 58, 44];
  for (let lines = 1; lines <= 4; lines++) {
    // One line wastes nothing to wrapping; several lines rarely fill every line.
    const size = Math.min(142, (142 * lines * (lines === 1 ? 0.97 : 0.84) * maxWidth) / w142);
    if (size >= floors[lines - 1] || lines === 4) return { size: Math.floor(size), lines: lines === 1 ? 1 : Math.max(lines, lineCount(text, Math.floor(size), maxWidth, { serif: true })) };
  }
  return { size: 44, lines: 4 };
}

/** The ribbon: one row (date and time | venue) when it fits at scale `k`, else the venue on its own line(s) below. */
function ribbonLayout(date: string, time: string, venue: string, k = 1) {
  const left = 58 + 22 + Math.max(textWidth(date, 35), textWidth(time, 29));
  const right = venue ? 44 + 16 + textWidth(venue, 32) : 0;
  // The ribbon's box does not scale (it spans the poster), the words do.
  const oneRow = !venue || (left + 34 + right) * k <= COL - 70;
  const venueLines = venue ? lineCount(venue, 31, COL - 140) : 0;
  const whenLines = (date ? lineCount(date, 35, COL - 160) : 0) + (time ? 1 : 0);
  const band = oneRow ? Math.max(118, 26 + whenLines * 40) : 30 + whenLines * 40 + 12 + venueLines * 38;
  return { oneRow, band: Math.ceil(band), venueLines };
}

export type PosterSection = "header" | "headline" | "subhead" | "slogan" | "stat" | "ribbon" | "agenda" | "paragraph";

export type PosterPlan = {
  /** The scale every section is drawn at (1 = the reference poster's sizes). */
  k: number;
  /** The poster's height in units. */
  H: number;
  /** The scene's scale and drawn height (units). */
  sceneScale: number;
  sceneH: number;
  /** Units above the footer the scene's art (or the QR code) needs. */
  reserve: number;
  headline: { size: number; lines: number };
  ribbon: ReturnType<typeof ribbonLayout>;
  /** Natural height of each section at k = 1 (units, margins included). */
  heights: Partial<Record<PosterSection, number>>;
  /** Extra air between sections and at the top (units, after scaling). */
  gap: number;
  top: number;
  /** Sections left out because there was not room for them even at the smallest comfortable scale (in the order they went). */
  dropped: PosterSection[];
};

/** What the organizer calls each section. */
export const SECTION_LABEL: Record<PosterSection, string> = {
  header: "logos",
  headline: "headline",
  subhead: "subhead",
  slogan: "slogan line",
  stat: "highlight box",
  ribbon: "date ribbon",
  agenda: "agenda",
  paragraph: "paragraph",
};
/** The least important go first when a poster is too full for its size. */
const DROP_ORDER: PosterSection[] = ["paragraph", "slogan", "subhead", "stat"];

const QR_CARD = 186;
/** The subhead's text box between its two rules (units at k = 1; it scales with the words). */
const SUBHEAD_W = COL - 200;

/** What goes on the poster, how big, and how much room is left: pure, so the tests can check it. */
export function planPoster(input: Pick<PosterInput, "design" | "poster" | "logo" | "assets">, dims: { w: number; h: number }, pack: ArtPack): PosterPlan {
  const { design, poster } = input;
  const u = dims.w / W;
  const H = dims.h / u;
  const venue = design.venue_line;
  const heights: Partial<Record<PosterSection, number>> = {};
  const hasHeader = (poster.logo && Boolean(input.logo)) || poster.partner.on;
  if (hasHeader) heights.header = 132;
  const headline = headlineFit(design.headline);
  heights.headline = 10 + headline.lines * headline.size * 1.04;
  if (poster.subhead) heights.subhead = 12 + lineCount(poster.subhead, 35, SUBHEAD_W, { caps: true, spacing: 5 }) * 44;
  if (poster.slogan) heights.slogan = 12 + lineCount(poster.slogan, 46, COL - 20, { spacing: 1.5 }) * 56;
  if (poster.stat.on && poster.stat.value) {
    const caption = poster.stat.caption ? lineCount(poster.stat.caption, 27, 740, { caps: true, spacing: 1.2 }) * 34 : 0;
    heights.stat = 22 + 14 + (poster.stat.label ? 32 : 0) + 120 + caption + 22;
  }
  let ribbon = ribbonLayout(poster.ribbon.date, poster.ribbon.time, venue);
  const ribbonOn = poster.ribbon.on && Boolean(poster.ribbon.date || poster.ribbon.time || venue);
  if (ribbonOn) heights.ribbon = 22 + ribbon.band + 24;
  if (poster.agenda.length) {
    let rows = 14;
    for (const r of poster.agenda) {
      const t = Math.max(lineCount(r.time, 29, 262), 1) * 36;
      const x = Math.max(lineCount(r.text, 28, 490), 1) * 35;
      rows += Math.max(74, t, x) + 20;
    }
    heights.agenda = rows;
  }
  if (poster.paragraph) heights.paragraph = 18 + lineCount(poster.paragraph, 23, 830) * 34;

  // The scene: a little smaller on the shorter sizes, a little bigger on Story.
  let sceneScale = Math.min(1.12, Math.max(0.78, H / 1620));
  const showQr = design.show_qr;
  const sceneOn = poster.scene.source !== "none";
  const reserveFor = (s: number) => Math.max(sceneOn ? pack.scene.busy * s - FOOTER : 0, showQr ? QR_CARD * Math.max(s, 0.8) + 22 : 24);

  // The frame's own ornament may hang down the middle (a toran): the words start below it.
  const topPad = Math.max(54, pack.topInset);
  const slack = 28;
  const room = (s: number) => H - FOOTER - reserveFor(s) - slack;
  const dropped: PosterSection[] = [];
  const fit = () => {
    const natural = Object.values(heights).reduce((a, b) => a + (b ?? 0), 0);
    let k = Math.min(K_MAX, room(sceneScale) / (natural + topPad));
    if (k < 0.8 && sceneOn) {
      // Long content on a short poster: the scene gives way first (down to 60%), then the words.
      sceneScale = Math.max(0.6, Math.min(sceneScale, sceneScale * (0.75 + k / 4)));
      k = Math.min(K_MAX, room(sceneScale) / (natural + topPad));
    }
    // Still too much at the smallest comfortable scale: leave the least important section out (the render says so),
    // and look again. Only when nothing more can go does the scale fall below it, so the footer is never pushed off.
    const next = DROP_ORDER.find((section) => heights[section] !== undefined);
    if (k < K_MIN && next) {
      delete heights[next];
      dropped.push(next);
      return fit();
    }
    return { natural, k: Math.max(K_FLOOR, k) };
  };
  let { natural, k } = fit();
  // The ribbon's words scale with k but its box does not: decide one row or two at the scale it is drawn at.
  // Only ever from one row to the stacked layout, which fits at any scale (so this cannot go back and forth).
  if (ribbonOn && ribbon.oneRow) {
    const atK = ribbonLayout(poster.ribbon.date, poster.ribbon.time, venue, k);
    if (!atK.oneRow) {
      ribbon = atK;
      heights.ribbon = 22 + ribbon.band + 24;
      ({ natural, k } = fit());
    }
  }
  const reserve = reserveFor(sceneScale);
  const left = Math.max(0, room(sceneScale) - (natural + topPad) * k);
  const sections = Object.keys(heights).length;
  // Spare room: some between the sections (never so much that they drift apart), then the stack is centred in what is left.
  const gap = Math.min(H > 1700 ? 92 : H > 1500 ? 74 : 44, left / (sections + 1));
  const extraTop = Math.max(0, left - gap * sections) * 0.42;
  return {
    k: Math.round(k * 1000) / 1000,
    H,
    sceneScale,
    sceneH: pack.scene.height * sceneScale,
    reserve,
    headline,
    ribbon,
    heights,
    gap,
    top: topPad * k + extraTop,
    dropped,
  };
}

const FLYER_SIZE_HELP = "choose the Tall or Story size, which have more room";

/**
 * What the organizer should be told about the poster at this size, in plain sentences: a section left out for lack of
 * room, or the words set small. Pure: the same plan the picture is drawn from.
 */
export function posterNotes(input: Pick<PosterInput, "design" | "poster" | "logo" | "assets" | "brand">, dims: { w: number; h: number }): string[] {
  const plan = planPoster(input, dims, artPack(input.poster.occasion, input.brand));
  const notes: string[] = [];
  const size = FLYER_SIZE_HELP;
  if (plan.dropped.length) {
    const names = plan.dropped.map((section) => SECTION_LABEL[section]);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    notes.push(`There was not room for the ${list} on this poster, so ${plan.dropped.length > 1 ? "they were" : "it was"} left out. Shorten the text, switch a section off, or ${size}.`);
  }
  if (plan.k < 0.7) {
    notes.push(`This poster is crowded, so its words are set small (${Math.round(plan.k * 100)}% of the usual size). Shorten the agenda or the paragraph, or ${size}.`);
  }
  return notes;
}

// ── Drawing ──────────────────────────────────────────────────────────────────

/** Every word on the poster (for choosing fonts). */
export function posterText(p: PosterContent): string {
  return [p.subhead, p.slogan, p.partner.label, p.partner.sub, p.stat.label, p.stat.value, p.stat.caption, p.ribbon.date, p.ribbon.time, p.paragraph, p.footer, ...p.agenda.flatMap((r) => [r.time, r.text]), "RSVP Scan to reply"].join(" ");
}

function fitImage(img: PosterImage, maxW: number, maxH: number): { width: number; height: number } {
  const ratio = img.w > 0 && img.h > 0 ? img.w / img.h : 1;
  let height = maxH;
  let width = height * ratio;
  if (width > maxW) {
    width = maxW;
    height = width / ratio;
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/**
 * A soft shadow, or a feathered edge, WITHOUT a blur filter: a few stacked rounded rectangles whose opacity fades
 * outward, drawn as absolutely positioned children of the box they surround. (`box-shadow` with a blur becomes an SVG
 * Gaussian blur, which the renderer runs over a big area at Print size: one shadow cost seconds there.)
 */
function haloLayers(o: { rgb: string; alpha: number; radius: number; spread: number; dy?: number; steps?: number }): ReactNode[] {
  const steps = o.steps ?? 4;
  const dy = o.dy ?? 0;
  return Array.from({ length: steps }, (_, i) => {
    const e = (o.spread * (steps - i)) / steps;
    return (
      <div
        key={`halo-${i}`}
        style={{ display: "flex", position: "absolute", left: -e, right: -e, top: -e + dy, bottom: -e - dy, borderRadius: o.radius + e, backgroundColor: `rgba(${o.rgb},${Math.round(((o.alpha / steps) * 1.15) * 1000) / 1000})` }}
      />
    );
  });
}

export function posterElement(input: PosterInput, dims: { w: number; h: number }, fonts: Fonts, qrDataUri: string | null): ReactElement {
  const { design, poster } = input;
  const pack = artPack(poster.occasion, input.brand);
  const pal: PosterPalette = pack.palette;
  const plan = planPoster(input, dims, pack);
  const u = dims.w / W;
  const k = plan.k;
  /** Units at scale k to pixels. */
  const px = (v: number) => Math.round(v * k * u * 10) / 10;
  /** Units (unscaled) to pixels. */
  const ux = (v: number) => Math.round(v * u * 10) / 10;
  const { w, h } = dims;
  const H = plan.H;
  const gap = ux(plan.gap);

  const box = (style: Record<string, string | number>, ...children: ReactNode[]) => <div style={{ display: "flex", ...style }}>{children}</div>;
  const txt = (style: Record<string, string | number>, s: string) => <div style={{ display: "flex", ...style }}>{s}</div>;
  const image = (src: string, iw: number, ih: number, style: Record<string, string | number> = {}) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" src={src} width={iw} height={ih} style={{ width: iw, height: ih, ...style }} />
  );
  const diamond = (size: number, color: string) => box({ width: size, height: size, backgroundColor: color, transform: "rotate(45deg)", flexShrink: 0 });
  const iconCircle = (name: PosterIcon, size: number) =>
    box(
      { width: px(size), height: px(size), borderRadius: px(size / 2), border: `${Math.max(1, px(3))}px solid ${pal.gold}`, backgroundColor: "rgba(255,255,255,0.82)", alignItems: "center", justifyContent: "center", flexShrink: 0 },
      image(posterIconUri(name, pal.ink), px(size * 0.56), px(size * 0.56)),
    );

  const layers: ReactNode[] = [];

  // 1. Frame: the pack's drawing, an AI picture (stretched to the poster, with a drawn gold edge and a soft panel behind the words), or plain paper.
  const aiFrame = poster.frame.source === "ai" ? input.assets.frame : null;
  if (aiFrame) {
    layers.push(image(aiFrame.dataUri, w, h, { position: "absolute", left: 0, top: 0, objectFit: "fill" }));
    layers.push(image(svgDataUri(frameEdgeSvg(W, H, pal.gold)), w, h, { position: "absolute", left: 0, top: 0 }));
  } else {
    const svg = poster.frame.source === "none" ? plainPaperSvg(W, H, pal) : pack.frame(W, H);
    layers.push(image(svgDataUri(svg), w, h, { position: "absolute", left: 0, top: 0 }));
  }

  // 2. Scene, bottom-anchored under the footer; an AI scene fades in from its top.
  if (poster.scene.source !== "none") {
    const aiScene = poster.scene.source === "ai" ? input.assets.scene : null;
    if (aiScene) {
      const sh = Math.round((w * aiScene.h) / Math.max(1, aiScene.w));
      const drawn = Math.min(sh, Math.round(ux(plan.sceneH * 1.05)));
      layers.push(
        image(aiScene.dataUri, w, drawn, {
          position: "absolute",
          left: 0,
          top: h - drawn,
          objectFit: "cover",
          objectPosition: "bottom",
          maskImage: `linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) ${Math.round(pack.fade.from * 100)}%, rgba(0,0,0,1) ${Math.round(pack.fade.to * 100)}%)`,
        }),
      );
    } else {
      // Drawn wider than the poster (1080 / scale) so that scaling it to the poster's width keeps every shape in proportion.
      const sw = W / plan.sceneScale;
      const sh = pack.scene.height;
      const drawnH = Math.round(ux(sh * plan.sceneScale));
      layers.push(image(svgDataUri(pack.scene.draw(sw, sh)), w, drawnH, { position: "absolute", left: 0, top: h - drawnH }));
    }
  }

  // 3. A soft paper panel behind the words when the frame is AI art (it rarely leaves a clean centre).
  if (aiFrame && pack.scrim > 0) {
    const c = pal.paper.replace("#", "");
    const rgb = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)).join(",");
    layers.push(
      box({
        position: "absolute",
        left: ux(SIDE + 34),
        top: ux(50),
        width: ux(W - 2 * (SIDE + 34)),
        height: Math.max(1, h - ux(FOOTER + plan.reserve + 70)),
        borderRadius: ux(60),
        backgroundColor: `rgba(${rgb},${pack.scrim})`,
      }, ...haloLayers({ rgb, alpha: pack.scrim, radius: ux(60), spread: ux(44), steps: 9 })),
    );
  }

  // 4. The words.
  const sections: ReactNode[] = [];
  const spacer = (key: string) => <div key={key} style={{ display: "flex", height: gap, flexShrink: 0 }} />;

  if (plan.heights.header) {
    const items: ReactNode[] = [];
    if (poster.logo && input.logo) {
      const s = fitImage(input.logo, px(330), px(124));
      items.push(image(input.logo.dataUri, s.width, s.height));
    }
    if (poster.partner.on) {
      if (items.length) items.push(box({ width: Math.max(1, px(2)), height: px(92), backgroundColor: pal.gold }));
      const logo = input.assets.partnerLogo;
      if (logo) {
        const s = fitImage(logo, px(300), px(124));
        items.push(image(logo.dataUri, s.width, s.height));
      } else {
        const b = 122;
        const label = poster.partner.label || "PARTNER";
        const labelSize = Math.min(26, (26 * 7) / Math.max(5, flyerTextLength(label)));
        items.push(
          box(
            { width: px(b), height: px(b), borderRadius: px(b / 2), backgroundColor: pal.ink, border: `${Math.max(1, px(4))}px solid ${pal.gold}`, alignItems: "center", justifyContent: "center", flexDirection: "column", position: "relative" },
            box({ position: "absolute", left: px(4), top: px(4), width: px(b - 16), height: px(b - 16), borderRadius: px((b - 16) / 2), border: `${Math.max(1, px(1.5))}px solid ${pal.gold}` }),
            txt({ fontFamily: fonts.display, fontWeight: 800, fontSize: px(labelSize), color: pal.paper, lineHeight: 1, letterSpacing: px(0.5) }, label),
            poster.partner.sub ? txt({ fontWeight: 800, fontSize: px(18), color: pal.gold, letterSpacing: px(4), marginTop: px(5), marginLeft: px(4) }, poster.partner.sub) : null,
          ),
        );
      }
    }
    sections.push(<div key="header" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: px(28), height: px(132), flexShrink: 0 }}>{items}</div>);
  }

  const center = { display: "flex", justifyContent: "center", textAlign: "center" as const, flexShrink: 0 };
  sections.push(
    <div key="headline" style={{ ...center, width: ux(COL), marginTop: px(10), fontFamily: fonts.display, fontWeight: 800, fontSize: ux(plan.headline.size * Math.min(k, 1)), lineHeight: 1.02, color: pal.ink, letterSpacing: px(1) }}>
      {design.headline}
    </div>,
  );

  if (plan.heights.subhead) {
    const rule = (flip: boolean) =>
      box({ alignItems: "center", gap: px(6), flexShrink: 0 }, ...(flip ? [box({ width: px(64), height: Math.max(1, px(2.5)), backgroundColor: pal.gold }), diamond(px(7), pal.gold)] : [diamond(px(7), pal.gold), box({ width: px(64), height: Math.max(1, px(2.5)), backgroundColor: pal.gold })]));
    sections.push(spacer("g-sub"));
    sections.push(
      <div key="subhead" style={{ display: "flex", alignItems: "center", gap: px(18), marginTop: px(12), flexShrink: 0, maxWidth: px(COL) }}>
        {rule(false)}
        <div style={{ ...center, fontWeight: 800, fontSize: px(35), letterSpacing: px(5), color: pal.goldText, textTransform: "uppercase", lineHeight: 1.2, maxWidth: px(SUBHEAD_W) }}>{poster.subhead}</div>
        {rule(true)}
      </div>,
    );
  }

  if (plan.heights.slogan) {
    sections.push(<div key="slogan" style={{ ...center, width: px(COL - 20), marginTop: px(12), fontWeight: 800, fontSize: px(46), letterSpacing: px(1.5), color: pal.ink, lineHeight: 1.18 }}>{poster.slogan}</div>);
  }

  if (plan.heights.stat) {
    const st = poster.stat;
    const valueSize = Math.min(118, (118 * 6) / Math.max(4, flyerTextLength(st.value)));
    sections.push(spacer("g-stat"));
    sections.push(
      <div key="stat" style={{ display: "flex", position: "relative", flexShrink: 0, marginTop: px(22), width: px(800) }}>
        {haloLayers({ rgb: "27,44,92", alpha: 0.14, radius: px(26), spread: px(16), dy: px(8) })}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          flexShrink: 0,
          width: px(800),
          padding: `${px(14)}px ${px(30)}px ${px(17)}px`,
          backgroundColor: pal.paper,
          border: `${Math.max(1, px(3))}px solid ${pal.gold}`,
          borderRadius: px(26),
          position: "relative",
        }}
      >
        {box({ position: "absolute", left: px(6), top: px(6), right: px(6), bottom: px(6), border: `${Math.max(1, px(1))}px solid ${pal.gold}`, borderRadius: px(20) })}
        {box(
          { alignItems: "center", gap: px(30) },
          iconCircle(st.icon, 100),
          box(
            { flexDirection: "column", alignItems: "center" },
            st.label ? txt({ fontWeight: 800, fontSize: px(26), letterSpacing: px(7), color: pal.ink, marginLeft: px(7), textTransform: "uppercase" }, st.label) : null,
            txt({ fontFamily: fonts.display, fontWeight: 900, fontSize: px(valueSize), lineHeight: 1, color: pal.accent, marginTop: px(-2) }, st.value),
          ),
          box({ width: px(100), flexShrink: 0 }),
        )}
        {st.caption ? <div style={{ ...center, fontWeight: 800, fontSize: px(27), letterSpacing: px(1.2), color: pal.ink, marginTop: px(4), textTransform: "uppercase", lineHeight: 1.22, maxWidth: px(740) }}>{st.caption}</div> : null}
      </div>
      </div>,
    );
  }

  if (plan.heights.ribbon) {
    const r = plan.ribbon;
    const band = r.band;
    const tall = band + 24;
    const when = box(
      { alignItems: "center", gap: px(22), flexShrink: 1 },
      poster.ribbon.date || poster.ribbon.time ? image(posterIconUri("calendar", pal.ribbonHi, 2.8), px(58), px(58)) : null,
      box(
        { flexDirection: "column", flexShrink: 1 },
        poster.ribbon.date ? txt({ fontWeight: 700, fontSize: px(35), color: pal.onAccent, lineHeight: 1.12 }, poster.ribbon.date) : null,
        poster.ribbon.time ? txt({ fontWeight: 800, fontSize: px(29), color: pal.ribbonHi, lineHeight: 1.15, marginTop: px(2) }, poster.ribbon.time) : null,
      ),
    );
    const where = design.venue_line
      ? box(
          { alignItems: "center", gap: px(16), flexShrink: 1 },
          image(posterIconUri("pin", pal.ribbonHi, 2.8), px(44), px(44)),
          txt({ fontWeight: 700, fontSize: px(r.oneRow ? 32 : 31), color: pal.onAccent, lineHeight: 1.2, flexShrink: 1 }, design.venue_line),
        )
      : null;
    sections.push(spacer("g-ribbon"));
    sections.push(
      <div key="ribbon" style={{ display: "flex", position: "relative", width: w, height: px(tall), marginTop: px(22), flexShrink: 0 }}>
        {image(svgDataUri(ribbonSvg({ W, H: tall, band, pal })), w, px(tall), { position: "absolute", left: 0, top: 0 })}
        <div
          style={{
            position: "absolute",
            left: ux(SIDE),
            top: 0,
            width: ux(COL),
            height: px(band),
            display: "flex",
            flexDirection: r.oneRow ? "row" : "column",
            alignItems: "center",
            justifyContent: "center",
            gap: px(r.oneRow ? 22 : 10),
            padding: `${px(14)}px ${px(20)}px`,
          }}
        >
          {when}
          {r.oneRow && where && (poster.ribbon.date || poster.ribbon.time) ? box({ width: Math.max(1, px(2)), height: px(72), backgroundColor: pal.ribbonHi, marginLeft: px(8), marginRight: px(8), opacity: 0.75 }) : null}
          {where}
        </div>
      </div>,
    );
  }

  if (poster.agenda.length) {
    sections.push(spacer("g-agenda"));
    sections.push(
      <div key="agenda" style={{ display: "flex", flexDirection: "column", marginTop: px(14), width: px(870), flexShrink: 0 }}>
        {poster.agenda.map((row, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              paddingTop: px(10),
              paddingBottom: px(10),
              borderBottom: i < poster.agenda.length - 1 ? `${Math.max(1, px(2))}px dashed ${pal.gold}` : `0px solid ${pal.paper}`,
            }}
          >
            {iconCircle(row.icon, 74)}
            <div style={{ display: "flex", width: px(262), marginLeft: px(24), fontWeight: 800, fontSize: px(29), color: pal.accent, flexShrink: 0, lineHeight: 1.2 }}>{row.time}</div>
            <div style={{ display: "flex", flex: 1, marginLeft: px(14), fontWeight: 700, fontSize: px(28), lineHeight: 1.22, color: pal.ink }}>{row.text}</div>
          </div>
        ))}
      </div>,
    );
  }

  if (plan.heights.paragraph) {
    sections.push(spacer("g-para"));
    sections.push(<div key="paragraph" style={{ ...center, marginTop: px(18), width: px(830), fontSize: px(23), lineHeight: 1.45, fontWeight: 500, color: pal.body }}>{poster.paragraph}</div>);
  }

  const column = (
    <div key="column" style={{ display: "flex", flexDirection: "column", alignItems: "center", flexGrow: 1, flexShrink: 0, paddingTop: ux(plan.top) }}>
      {sections}
    </div>
  );

  // 5. QR code and footer.
  const qr = design.show_qr && qrDataUri ? qrDataUri : null;
  const qs = Math.max(plan.sceneScale, 0.8);
  const q = (v: number) => Math.round(v * qs * u * 10) / 10;
  // A small honest line when AI made some of the art; nothing when it was all drawn in code.
  const credit = (aiFrame ? 1 : 0) + (input.assets.scene && poster.scene.source === "ai" ? 1 : 0) > 0 ? "Art: Google Gemini (AI)" : "";
  const footerText = poster.footer || input.centerName;

  return (
    <div style={{ width: w, height: h, display: "flex", flexDirection: "column", position: "relative", backgroundColor: pal.paper, fontFamily: fonts.body, color: pal.ink }}>
      {layers}
      {column}
      <div style={{ display: "flex", height: ux(plan.reserve), flexShrink: 0 }} />
      {qr
        ? box(
            { position: "absolute", left: ux(40), bottom: ux(FOOTER + 18), width: q(150) },
            ...haloLayers({ rgb: "27,44,92", alpha: 0.25, radius: q(16), spread: q(12), dy: q(6) }),
            box(
              {
                width: q(150),
                padding: `${q(12)}px ${q(12)}px ${q(8)}px`,
                backgroundColor: "#FFFFFF",
                borderRadius: q(16),
                border: `${Math.max(1, q(3))}px solid ${pal.gold}`,
                flexDirection: "column",
                alignItems: "center",
              },
              image(qr, q(120), q(120)),
              txt({ fontWeight: 800, fontSize: q(20), letterSpacing: q(5), color: pal.ink, marginTop: q(6), marginLeft: q(5) }, "RSVP"),
              txt({ fontWeight: 500, fontSize: q(13), color: pal.body }, "Scan to reply"),
            ),
          )
        : null}
      <div style={{ display: "flex", position: "relative", width: w, height: ux(FOOTER), flexShrink: 0, backgroundColor: pal.footerBg, borderTop: `${Math.max(1, ux(3))}px solid ${pal.gold}`, alignItems: "center", justifyContent: "center", gap: ux(18) }}>
        {diamond(ux(9), pal.gold)}
        <div style={{ display: "flex", fontFamily: fonts.display, fontWeight: 600, fontSize: ux(Math.min(30, (30 * 34) / Math.max(20, flyerTextLength(footerText)))), color: pal.footerText, letterSpacing: ux(1.5), maxWidth: ux(W - 340) }}>{footerText}</div>
        {diamond(ux(9), pal.gold)}
        {credit ? <div style={{ display: "flex", position: "absolute", right: ux(16), bottom: ux(6), fontSize: ux(12), fontWeight: 500, color: "rgba(255,255,255,0.7)" }}>{credit}</div> : null}
      </div>
    </div>
  );
}
