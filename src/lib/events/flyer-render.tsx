// The flyer renderer — server side only (next/og, fonts from disk). Not
// marked `server-only` so the render tests can import it; no client component
// imports it (the flyer panel asks POST /api/events/<id>/flyer instead).
//
// next/og (satori + resvg, bundled with Next, no new dependency) turns JSX
// into a PNG. Satori's limits shape this file: flexbox only, every element
// with more than one child is display:flex, images need explicit sizes, PNG /
// JPEG / GIF / SVG images only (never WebP, HEIC or AVIF), and no full
// shaping for Gujarati or Devanagari (said in a note, see flyer-fonts.ts).
//
// Every measure is in units u = width / 1080, so Post (1080×1350), Story
// (1080×1920) and Print (2550×3300, US Letter at 300 dpi) share proportions.
// Text colours come from textOn() on solid panels and scrims, and the brand
// colours are used for text only where they reach 4.5:1 against what is
// behind them.

import type { ReactElement, ReactNode } from "react";

import { ImageResponse } from "next/og";
import { PDFDocument } from "pdf-lib";
import QRCode from "qrcode";

import { contrastRatio, parseHexColor, textOn } from "@/lib/setup";

import { FLYER_SIZES, fitFontSize, flyerTextRoom, type FlyerDesign, type FlyerSize, type FlyerTemplate } from "./flyer";
import type { FlyerBrand } from "./flyer-brand";
import { getFlyerFonts } from "./flyer-fonts";

export type FlyerImage = { dataUri: string; w: number; h: number };

export type FlyerRenderInput = {
  design: FlyerDesign;
  brand: FlyerBrand;
  centerName: string;
  /** The chosen background, already loaded (pattern SVG, album photo or AI art), or null for a plain colour. */
  background: FlyerImage | null;
  /** The logo for light backgrounds, and for dark ones (falls back to `logo` on a white pill). */
  logo: FlyerImage | null;
  logoDark: FlyerImage | null;
  /** What the QR code opens (the member app's event page), or null when there is none. */
  qrLink: string | null;
};

export type FlyerDims = { w: number; h: number };
type Fonts = { display: string; body: string };

/** Too many renders at once: the route answers 503 and the panel offers to try again. */
export class FlyerBusyError extends Error {
  constructor() {
    super("The flyer maker is busy making other flyers. Try again in a few seconds.");
    this.name = "FlyerBusyError";
  }
}

/** The pixel size of a flyer: full size, or the scaled-down preview (half for Post and Story, a quarter for Print). */
export function flyerDims(size: FlyerSize, scale: "preview" | "full"): FlyerDims {
  const s = FLYER_SIZES[size];
  const k = scale === "full" ? 1 : size === "print" ? 0.25 : 0.5;
  return { w: Math.round(s.w * k), h: Math.round(s.h * k) };
}

/**
 * Where a template draws the background, so a pattern can be drawn at exactly
 * that size. Classic's top box (and Minimal's photo corner) can give way to
 * the words when they need the room — down to `pictureMinHeight` — and the
 * picture is then cropped to fit (object-fit: cover), never squashed.
 */
export function backgroundBox(template: FlyerTemplate, dims: FlyerDims): FlyerDims {
  if (template === "classic") return { w: dims.w, h: Math.round(dims.h * 0.55) };
  if (template === "minimal") {
    const side = Math.round(dims.w * 0.36);
    return { w: side, h: side };
  }
  return dims;
}

/** The smallest height Classic's top box and Minimal's photo corner shrink to when the words need the room. */
export function pictureMinHeight(template: FlyerTemplate, dims: FlyerDims): number {
  return Math.round(dims.h * (template === "classic" ? 0.28 : 0.16));
}

/**
 * The font sizes (in units) of the date, venue and tagline lines: the
 * template's own size for ordinary lengths, smaller as a line nears its limit
 * (FLYER_LIMITS), so a flyer with every field at its longest still fits.
 */
export function lineSizes(design: Pick<FlyerDesign, "date_line" | "venue_line" | "tagline">, base: { date: number; venue: number; tagline: number }) {
  return {
    date: fitFontSize(design.date_line, 40, base.date),
    venue: fitFontSize(design.venue_line, 64, base.venue),
    tagline: fitFontSize(design.tagline, 110, base.tagline),
  };
}

/**
 * The colours a pattern is drawn in for a template: on the paper colour for
 * Classic, transparent in Minimal's corner, and "on dark" (the primary colour
 * behind white or ink ornaments) for Festival, whose scrim is the primary colour.
 */
export function patternColorsFor(template: FlyerTemplate, brand: Pick<FlyerBrand, "primary" | "accent" | "background">) {
  if (template === "festival") return { primary: textOn(brand.primary), accent: brand.accent, background: brand.primary, transparent: false };
  return { primary: brand.primary, accent: brand.accent, background: brand.background, transparent: template === "minimal" };
}

function rgba(hex: string, alpha: number): string {
  const c = parseHexColor(hex) ?? [27, 44, 92];
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}

/** A brand colour for text on `bg` when it reads at 4.5:1, else white or ink (textOn). */
function readable(preferred: string, bg: string): string {
  return (contrastRatio(preferred, bg) ?? 0) >= 4.5 ? preferred : textOn(bg);
}

/** Fit an image of natural size (w, h) into a box of maxW × maxH, keeping its shape. */
function fit(img: FlyerImage, maxW: number, maxH: number): { width: number; height: number } {
  const ratio = img.w > 0 && img.h > 0 ? img.w / img.h : 1;
  let height = maxH;
  let width = height * ratio;
  if (width > maxW) {
    width = maxW;
    height = width / ratio;
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

function Logo({ img, u, onLight }: { img: FlyerImage; u: number; onLight: boolean }) {
  const size = fit(img, 340 * u, 84 * u);
  return (
    <div
      style={{
        display: "flex",
        padding: `${Math.round(14 * u)}px ${Math.round(22 * u)}px`,
        backgroundColor: onLight ? "#FFFFFF" : "transparent",
        borderRadius: Math.round(18 * u),
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="" src={img.dataUri} width={size.width} height={size.height} style={{ width: size.width, height: size.height }} />
    </div>
  );
}

function Qr({ src, u, color, accent }: { src: string; u: number; color: string; accent: string }) {
  const side = Math.round(220 * u);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
      <div style={{ display: "flex", padding: Math.round(12 * u), backgroundColor: "#FFFFFF", borderRadius: Math.round(16 * u), border: `${Math.max(1, Math.round(3 * u))}px solid ${accent}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" src={src} width={side} height={side} style={{ width: side, height: side }} />
      </div>
      <div style={{ display: "flex", marginTop: Math.round(10 * u), fontSize: Math.round(24 * u), fontWeight: 700, color }}>Scan to RSVP</div>
    </div>
  );
}

function Line({ children, style }: { children: ReactNode; style: Record<string, string | number> }) {
  return <div style={{ display: "flex", ...style }}>{children}</div>;
}

function Ornament({ u, color, compact = false }: { u: number; color: string; compact?: boolean }) {
  const rule = { display: "flex", width: Math.round(120 * u), height: Math.max(1, Math.round(3 * u)), backgroundColor: color };
  const d = Math.round(18 * u);
  return (
    <div style={{ display: "flex", alignItems: "center", flexShrink: 0, margin: `${Math.round((compact ? 14 : 26) * u)}px 0` }}>
      <div style={rule} />
      <div style={{ display: "flex", width: d, height: d, margin: `0 ${Math.round(16 * u)}px`, backgroundColor: color, transform: "rotate(45deg)" }} />
      <div style={rule} />
    </div>
  );
}

/**
 * The flyer as JSX for next/og, at `dims` pixels.
 *
 * Satori does not shrink a flex item unless told to (its default flexShrink
 * is 0), so each template says which part gives way when the words are long:
 * the picture in Classic and in Minimal's photo corner, never the words, the
 * QR code or the centre's name. The secondary lines also get smaller near
 * their limits (lineSizes). tests/events-flyer-render.test.ts renders every
 * template with every field at its longest and checks nothing is cut off.
 */
export function flyerElement(input: FlyerRenderInput, dims: FlyerDims, fonts: Fonts, qrDataUri: string | null): ReactElement {
  const { design, brand } = input;
  const { w, h } = dims;
  const u = w / 1080;
  const px = (n: number) => Math.round(n * u * 10) / 10;
  const primary = brand.primary;
  const accent = brand.accent;
  const paper = brand.background;
  const onPaper = textOn(paper);
  const onPrimary = textOn(primary);
  const qr = design.show_qr && qrDataUri ? qrDataUri : null;
  const bg = input.background;
  const darkLogo = input.logoDark ?? null;
  const root = { width: w, height: h, display: "flex", fontFamily: fonts.body, fontSize: px(30) } as const;
  const headline = (base: number, comfortable: number, color: string, align: "left" | "center" = "left") => (
    <Line style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: px(fitFontSize(design.headline, comfortable, base, 0.5)), lineHeight: 1.06, color, textAlign: align }}>
      {design.headline}
    </Line>
  );
  const bgImg = (bw: number, bh: number, extra: Record<string, string | number> = {}) =>
    bg ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt="" src={bg.dataUri} width={bw} height={bh} style={{ width: bw, height: bh, objectFit: "cover", ...extra }} />
    ) : null;
  /** The background filling a box that may have shrunk: full width, the box's height, cropped to fit. */
  const coverImg = (bw: number, bh: number) =>
    bg ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt="" src={bg.dataUri} width={bw} height={bh} style={{ position: "absolute", top: 0, left: 0, width: bw, height: "100%", objectFit: "cover" }} />
    ) : null;

  if (design.template === "festival") {
    const pillText = textOn(accent);
    const size = lineSizes(design, { date: 38, venue: 34, tagline: 30 });
    // A long headline (over twice the comfortable length) brings the ornaments closer, to leave the words room.
    const compact = flyerTextRoom(design.headline) > 56;
    return (
      <div style={{ ...root, position: "relative", backgroundColor: primary, color: onPrimary }}>
        {bgImg(w, h, { position: "absolute", top: 0, left: 0 })}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: w,
            height: h,
            display: "flex",
            backgroundImage: `linear-gradient(180deg, ${rgba(primary, 0.5)} 0%, ${rgba(primary, 0.86)} 26%, ${rgba(primary, 0.93)} 100%)`,
          }}
        />
        <div style={{ position: "absolute", top: 0, left: 0, width: w, height: h, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", padding: px(72) }}>
          <div style={{ display: "flex", minHeight: px(84) }}>
            {darkLogo ? <Logo img={darkLogo} u={u} onLight={false} /> : input.logo ? <Logo img={input.logo} u={u} onLight /> : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: w - px(144) }}>
            <Ornament u={u} color={accent} compact={compact} />
            {headline(112, 28, onPrimary, "center")}
            <Ornament u={u} color={accent} compact={compact} />
            {design.date_line ? (
              <Line style={{ backgroundColor: accent, color: pillText, borderRadius: px(999), padding: `${px(14)}px ${px(36)}px`, fontSize: px(size.date), fontWeight: 700, textAlign: "center" }}>
                {design.date_line}
              </Line>
            ) : null}
            {design.venue_line ? <Line style={{ marginTop: px(22), fontSize: px(size.venue), fontWeight: 700, textAlign: "center" }}>{design.venue_line}</Line> : null}
            {design.tagline ? <Line style={{ marginTop: px(18), fontSize: px(size.tagline), lineHeight: 1.35, textAlign: "center", maxWidth: px(860) }}>{design.tagline}</Line> : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            {qr ? <Qr src={qr} u={u} color={onPrimary} accent={accent} /> : null}
            <Line style={{ marginTop: px(18), fontSize: px(26), fontWeight: 700 }}>{input.centerName}</Line>
          </div>
        </div>
      </div>
    );
  }

  if (design.template === "minimal") {
    const box = backgroundBox("minimal", dims);
    const head = readable(primary, paper);
    const pad = px(96);
    // A photo or AI art is part of the layout (the words start below it, so they never run over a busy picture);
    // a pattern is drawn faintly, so it stays a corner behind the words.
    const picture = bg !== null && design.background.source !== "pattern";
    const size = lineSizes(design, { date: 40, venue: 32, tagline: 30 });
    const spacer = <div style={{ display: "flex", flexGrow: 1, flexShrink: 1 }} />;
    return (
      <div style={{ ...root, position: "relative", flexDirection: "column", backgroundColor: paper, color: onPaper }}>
        {bg && !picture ? (
          <div style={{ position: "absolute", top: 0, right: 0, display: "flex", width: box.w, height: box.h, overflow: "hidden" }}>{bgImg(box.w, box.h)}</div>
        ) : null}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            flexGrow: 0,
            ...(picture ? { flexBasis: box.h, flexShrink: 1, minHeight: pictureMinHeight("minimal", dims) } : { flexShrink: 0 }),
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", padding: `${pad}px ${px(48)}px 0 ${pad}px`, minHeight: pad + px(84) }}>
            {input.logo ? <Logo img={input.logo} u={u} onLight={false} /> : null}
          </div>
          {picture ? (
            <div style={{ position: "relative", display: "flex", width: box.w, flexShrink: 0, overflow: "hidden", borderBottomLeftRadius: px(48) }}>{coverImg(box.w, box.h)}</div>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 0, padding: `${picture ? px(48) : 0}px ${pad}px ${pad}px` }}>
          {spacer}
          <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
            <div style={{ display: "flex", width: px(96), height: px(6), backgroundColor: accent, marginBottom: px(36) }} />
            {headline(picture ? 112 : 124, 26, head)}
            {design.date_line ? <Line style={{ marginTop: px(36), fontSize: px(size.date), fontWeight: 700, color: head }}>{design.date_line}</Line> : null}
            {design.venue_line ? <Line style={{ marginTop: px(12), fontSize: px(size.venue) }}>{design.venue_line}</Line> : null}
            {design.tagline ? <Line style={{ marginTop: px(28), fontSize: px(size.tagline), lineHeight: 1.4, maxWidth: px(820) }}>{design.tagline}</Line> : null}
          </div>
          {spacer}
          <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", flexShrink: 0, marginTop: px(28) }}>
            <Line style={{ fontSize: px(26), fontWeight: 700 }}>{input.centerName}</Line>
            {qr ? <Qr src={qr} u={u} color={onPaper} accent={accent} /> : null}
          </div>
        </div>
      </div>
    );
  }

  if (design.template === "photo") {
    const size = lineSizes(design, { date: 38, venue: 30, tagline: 28 });
    return (
      <div style={{ ...root, position: "relative", backgroundColor: primary, color: onPrimary }}>
        {bgImg(w, h, { position: "absolute", top: 0, left: 0 })}
        {input.logo ? (
          <div style={{ position: "absolute", top: px(48), left: px(48), display: "flex" }}>
            <Logo img={input.logo} u={u} onLight />
          </div>
        ) : null}
        <div style={{ position: "absolute", left: 0, bottom: 0, width: w, display: "flex", flexDirection: "row", alignItems: "flex-end", backgroundColor: primary, padding: `${px(56)}px ${px(64)}px` }}>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, marginRight: qr ? px(40) : 0 }}>
            <div style={{ display: "flex", width: px(110), height: px(7), backgroundColor: accent, marginBottom: px(24) }} />
            {headline(88, 32, onPrimary)}
            {design.date_line ? <Line style={{ marginTop: px(22), fontSize: px(size.date), fontWeight: 700 }}>{design.date_line}</Line> : null}
            {design.venue_line ? <Line style={{ marginTop: px(8), fontSize: px(size.venue) }}>{design.venue_line}</Line> : null}
            {design.tagline ? <Line style={{ marginTop: px(16), fontSize: px(size.tagline), lineHeight: 1.35 }}>{design.tagline}</Line> : null}
            <Line style={{ marginTop: px(22), fontSize: px(24), fontWeight: 700 }}>{input.centerName}</Line>
          </div>
          {qr ? <Qr src={qr} u={u} color={onPrimary} accent={accent} /> : null}
        </div>
      </div>
    );
  }

  // classic
  const top = backgroundBox("classic", dims);
  const head = readable(primary, paper);
  const size = lineSizes(design, { date: 40, venue: 32, tagline: 30 });
  return (
    <div style={{ ...root, flexDirection: "column", backgroundColor: paper, color: onPaper }}>
      <div
        style={{
          position: "relative",
          display: "flex",
          width: top.w,
          // The picture gives way to the words: it starts at 55% of the height and shrinks (cropped, not squashed) when they need the room.
          flexBasis: top.h,
          flexGrow: 0,
          flexShrink: 1,
          minHeight: pictureMinHeight("classic", dims),
          overflow: "hidden",
          backgroundColor: accent,
          // A plain colour still gets a soft depth: the primary colour, warming slightly towards the accent.
          backgroundImage: `linear-gradient(165deg, ${rgba(primary, 1)} 35%, ${rgba(primary, 0.82)} 100%)`,
        }}
      >
        {coverImg(top.w, top.h)}
        {input.logo ? (
          <div style={{ position: "absolute", top: px(48), left: px(48), display: "flex" }}>
            <Logo img={input.logo} u={u} onLight />
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, flexShrink: 0, padding: `${px(52)}px ${px(64)}px ${px(48)}px` }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flexGrow: 1, flexShrink: 1, marginRight: qr ? px(40) : 0 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", width: px(120), height: px(8), backgroundColor: accent, borderRadius: px(4), marginBottom: px(26) }} />
            {headline(92, 34, head)}
            {design.date_line ? <Line style={{ marginTop: px(24), fontSize: px(size.date), fontWeight: 700, color: head }}>{design.date_line}</Line> : null}
            {design.venue_line ? <Line style={{ marginTop: px(10), fontSize: px(size.venue) }}>{design.venue_line}</Line> : null}
            {design.tagline ? <Line style={{ marginTop: px(20), fontSize: px(size.tagline), lineHeight: 1.35 }}>{design.tagline}</Line> : null}
          </div>
          <Line style={{ marginTop: px(22), fontSize: px(26), fontWeight: 700 }}>{input.centerName}</Line>
        </div>
        {qr ? (
          <div style={{ display: "flex", alignItems: "flex-end", flexShrink: 0 }}>
            <Qr src={qr} u={u} color={onPaper} accent={accent} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Rendering ────────────────────────────────────────────────────────────────
const MAX_CONCURRENT = 2;
let active = 0;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export function isPng(b: Uint8Array): boolean {
  return b.length > 8 && PNG_SIGNATURE.every((v, i) => b[i] === v);
}

/** Every word on the flyer (for choosing fonts). */
export function flyerText(input: Pick<FlyerRenderInput, "design" | "centerName">): string {
  const d = input.design;
  return [d.headline, d.tagline, d.date_line, d.venue_line, input.centerName, "Scan to RSVP"].join(" ");
}

/**
 * The flyer as PNG bytes. Always buffered (never streamed) so a renderer
 * failure comes back as an ordinary error. At most two renders run at once;
 * a third throws FlyerBusyError.
 */
export async function renderFlyerPng(
  input: FlyerRenderInput,
  scale: "preview" | "full",
  dimsOverride?: FlyerDims,
): Promise<{ png: Uint8Array; notes: string[]; dims: FlyerDims }> {
  if (active >= MAX_CONCURRENT) throw new FlyerBusyError();
  active++;
  try {
    const dims = dimsOverride ?? flyerDims(input.design.size, scale);
    const notes: string[] = [];
    const set = await getFlyerFonts(input.brand, flyerText(input));
    notes.push(...set.notes);
    let qr: string | null = null;
    if (input.design.show_qr) {
      if (input.qrLink) {
        qr = await QRCode.toDataURL(input.qrLink, { errorCorrectionLevel: "M", margin: 1, width: Math.max(64, Math.round((220 * dims.w) / 1080)) });
      } else {
        notes.push("The flyer has no QR code: the member web app's address is not set, so there is no RSVP link to put in it.");
      }
    }
    const el = flyerElement(input, dims, { display: set.display, body: set.body }, qr);
    const res = new ImageResponse(el, { width: dims.w, height: dims.h, fonts: set.fonts });
    const png = new Uint8Array(await res.arrayBuffer());
    if (!isPng(png)) throw new Error("the image renderer returned no picture");
    return { png, notes, dims };
  } finally {
    active--;
  }
}

/** A one-page US Letter PDF (612 × 792 pt) with the print-size PNG drawn edge to edge. */
export async function renderFlyerPdf(png: Uint8Array, title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title || "Event flyer");
  doc.setCreator("Community Connect");
  doc.setProducer("Community Connect");
  const img = await doc.embedPng(png);
  const page = doc.addPage([612, 792]);
  page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  return doc.save();
}
