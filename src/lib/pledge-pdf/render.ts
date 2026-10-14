// Draws a pledge document (src/lib/pledge-pdf/document.ts) as an invoice-style PDF with pdf-lib: the community's logo (or its name)
// and colours at the top, who pledged, the pledge's number, dates and status, what it is for, the amounts, the payments applied,
// a note, how to pay, and a footer on every page. Built-in Helvetica only (no font file, nothing to download).
//
// `text` lists every string drawn, in order, so tests can check what the page says without reading PDF internals.
//
// Pure (no "@/" imports, no I/O): the portal's Print route and the background service (the email's attachment) both run it.

import { PDFDocument, StandardFonts, rgb, type Color, type PDFFont, type PDFPage } from "pdf-lib";

import type { PledgeDocView } from "./document";
import type { PdfLogo } from "./logo";

export type RenderedPledgePdf = { bytes: Uint8Array; pages: number; text: string[]; logoDrawn: boolean };

const MARGIN = 48;
const TOP = 40;
const BOTTOM = 66;

function toColor(hex: string, fallback: [number, number, number]): Color {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return rgb(...fallback);
  const n = parseInt(m[1]!, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** The colour mixed with white: `amount` of the colour (0 to 1). */
function tint(hex: string, amount: number): Color {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  const n = m ? parseInt(m[1]!, 16) : 0x1b2c5c;
  const mix = (c: number) => (255 - (255 - c) * amount) / 255;
  return rgb(mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255));
}

/** Lines of `s` that each fit `width` at this size (a word longer than the line is cut where it must be). */
export function wrapLine(s: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of s.split(" ")) {
    let w = word;
    while (w !== "" && font.widthOfTextAtSize(w, size) > width) {
      // Cut a word that is wider than the line.
      let cut = w.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut -= 1;
      if (line !== "") {
        out.push(line);
        line = "";
      }
      out.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    if (w === "") continue;
    const candidate = line === "" ? w : `${line} ${w}`;
    if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line !== "") out.push(line);
  return out.length > 0 ? out : [""];
}

export async function renderPledgePdf(view: PledgeDocView, logo: PdfLogo | null): Promise<RenderedPledgePdf> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [pw, ph] = view.paper === "a4" ? [595.28, 841.89] : [612, 792];
  const contentW = pw - MARGIN * 2;

  const primary = toColor(view.brand.primary, [0.106, 0.173, 0.361]);
  const accent = toColor(view.brand.accent, [0.788, 0.451, 0.11]);
  const ink = rgb(0.12, 0.11, 0.09);
  const muted = rgb(0.37, 0.35, 0.32);
  const hairline = rgb(0.89, 0.85, 0.78);
  const panel = tint(view.brand.primary, 0.07);

  pdf.setTitle(`Pledge ${view.number} · ${view.communityName}`);
  pdf.setAuthor(view.communityName);
  pdf.setSubject("Pledge");
  pdf.setCreator("Weaver");
  pdf.setProducer("Weaver");
  pdf.setCreationDate(new Date());

  const drawn: string[] = [];
  let page: PDFPage = pdf.addPage([pw, ph]);
  let y = ph - TOP;
  let logoDrawn = false;

  const put = (s: string, x: number, yy: number, size: number, font: PDFFont, color: Color) => {
    if (s === "") return;
    page.drawText(s, { x, y: yy, size, font, color });
    drawn.push(s);
  };
  const putRight = (s: string, xRight: number, yy: number, size: number, font: PDFFont, color: Color) => {
    put(s, xRight - font.widthOfTextAtSize(s, size), yy, size, font, color);
  };
  const rule = (yy: number, thickness: number, color: Color, x1 = MARGIN, x2 = pw - MARGIN) => {
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness, color });
  };
  const newPage = () => {
    page = pdf.addPage([pw, ph]);
    y = ph - TOP;
    put(view.communityName, MARGIN, y - 10, 10, bold, primary);
    putRight(`Pledge ${view.number} (continued)`, pw - MARGIN, y - 10, 10, regular, muted);
    rule(y - 18, 1, hairline);
    y -= 38;
  };
  const need = (h: number) => {
    if (y - h < BOTTOM) newPage();
  };
  const heading = (s: string) => {
    need(30);
    put(s.toUpperCase(), MARGIN, y - 9, 8.5, bold, muted);
    y -= 18;
  };
  const paragraph = (s: string, size: number, font: PDFFont, color: Color, x = MARGIN, width = contentW, leading = size * 1.4) => {
    for (const ln of wrapLine(s, font, size, width)) {
      need(leading);
      put(ln, x, y - size, size, font, color);
      y -= leading;
    }
  };

  // ── Header: logo or name on the left, the title and number on the right ─────────────────────────────────────────────────────
  const top = y;
  let leftY = top;
  if (logo) {
    try {
      const img = logo.kind === "png" ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes);
      const dims = img.scaleToFit(160, 46);
      page.drawImage(img, { x: MARGIN, y: leftY - dims.height, width: dims.width, height: dims.height });
      leftY -= dims.height + 8;
      logoDrawn = true;
    } catch {
      // A picture that cannot be read leaves the name in its place.
    }
  }
  const nameSize = logoDrawn ? 12 : 20;
  for (const ln of wrapLine(view.communityName, bold, nameSize, contentW * 0.55)) {
    put(ln, MARGIN, leftY - nameSize, nameSize, bold, primary);
    leftY -= nameSize * 1.25;
  }
  for (const raw of view.communityLines) {
    for (const ln of wrapLine(raw, regular, 9, contentW * 0.55)) {
      put(ln, MARGIN, leftY - 9, 9, regular, muted);
      leftY -= 12;
    }
  }
  putRight(view.title, pw - MARGIN, top - 26, 26, bold, primary);
  putRight(`No. ${view.number}`, pw - MARGIN, top - 44, 11, regular, muted);
  y = Math.min(leftY, top - 54) - 8;
  rule(y, 2, accent);
  y -= 18;

  // ── Who pledged, and the pledge's own facts ────────────────────────────────────────────────────────────────────────────────
  const colRight = MARGIN + contentW * 0.58;
  const leftTop = y;
  put(view.familyHeading.toUpperCase(), MARGIN, y - 9, 8.5, bold, muted);
  let famY = y - 22;
  for (const ln of wrapLine(view.family.name, bold, 12.5, contentW * 0.52)) {
    put(ln, MARGIN, famY, 12.5, bold, ink);
    famY -= 16;
  }
  for (const raw of view.family.lines) {
    for (const ln of wrapLine(raw, regular, 9.5, contentW * 0.52)) {
      put(ln, MARGIN, famY, 9.5, regular, muted);
      famY -= 13;
    }
  }
  let factY = leftTop - 9;
  for (const f of view.facts) {
    put(f.label, colRight, factY, 9.5, regular, muted);
    putRight(f.value, pw - MARGIN, factY, 10, bold, ink);
    factY -= 16;
  }
  y = Math.min(famY, factY) - 8;

  // ── What it is for ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  if (view.purpose.length > 0) {
    heading("What the pledge is for");
    for (const row of view.purpose) {
      const lines = wrapLine(row.value, regular, 10, contentW - 100);
      need(lines.length * 13 + 2);
      put(row.label, MARGIN, y - 10, 9.5, regular, muted);
      for (const ln of lines) {
        put(ln, MARGIN + 100, y - 10, 10, regular, ink);
        y -= 13;
      }
      y -= 2;
    }
    y -= 4;
  }

  // ── The amounts ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const boxW = Math.min(250, contentW);
  const boxX = pw - MARGIN - boxW;
  need(20 * view.amounts.length + 16);
  for (const a of view.amounts) {
    if (a.strong) {
      page.drawRectangle({ x: boxX, y: y - 22, width: boxW, height: 24, color: panel });
      put(a.label, boxX + 10, y - 15, 11, bold, primary);
      putRight(a.value, boxX + boxW - 10, y - 15, 12, bold, primary);
      y -= 26;
    } else {
      put(a.label, boxX + 10, y - 12, 10, regular, muted);
      putRight(a.value, boxX + boxW - 10, y - 12, 10.5, regular, ink);
      y -= 18;
    }
  }
  y -= 8;

  // ── Payments applied ───────────────────────────────────────────────────────────────────────────────────────────────────────
  heading("Payments applied to this pledge");
  if (view.payments.length === 0) {
    paragraph(view.paymentsEmpty, 10, regular, muted);
    y -= 6;
  } else {
    const cols = { date: MARGIN + 8, method: MARGIN + 170, ref: MARGIN + 270, right: pw - MARGIN - 8 };
    const drawHead = () => {
      need(40);
      page.drawRectangle({ x: MARGIN, y: y - 18, width: contentW, height: 20, color: panel });
      put("Date", cols.date, y - 12, 9, bold, primary);
      put("How it was paid", cols.method, y - 12, 9, bold, primary);
      put("Receipt", cols.ref, y - 12, 9, bold, primary);
      putRight("Amount", cols.right, y - 12, 9, bold, primary);
      y -= 22;
    };
    drawHead();
    for (const p of view.payments) {
      if (y - 20 < BOTTOM) {
        newPage();
        drawHead();
      }
      put(p.date, cols.date, y - 12, 10, regular, ink);
      put(p.method, cols.method, y - 12, 10, regular, ink);
      put(p.reference, cols.ref, y - 12, 10, regular, ink);
      putRight(p.amount, cols.right, y - 12, 10, regular, ink);
      rule(y - 18, 0.5, hairline);
      y -= 20;
    }
    if (view.paymentsTotal) {
      need(22);
      put("Total applied", cols.ref, y - 13, 10, bold, ink);
      putRight(view.paymentsTotal, cols.right, y - 13, 10.5, bold, ink);
      y -= 24;
    }
  }

  // ── Instalments, note, how to pay ──────────────────────────────────────────────────────────────────────────────────────────
  if (view.instalments) {
    y -= 4;
    paragraph(view.instalments, 10, regular, ink);
    y -= 6;
  }
  if (view.note || view.signedBy) {
    y -= 4;
    heading("Note");
    if (view.note) paragraph(view.note, 10, regular, ink);
    if (view.signedBy) {
      y -= 4;
      paragraph(view.signedBy, 10, bold, ink);
    }
    y -= 6;
  }
  {
    const lines = wrapLine(view.howToPay, regular, 9.5, contentW - 20);
    const h = lines.length * 13 + 16;
    need(h + 8);
    page.drawRectangle({ x: MARGIN, y: y - h, width: contentW, height: h, color: panel });
    let ty = y - 14;
    for (const ln of lines) {
      put(ln, MARGIN + 10, ty, 9.5, regular, ink);
      ty -= 13;
    }
    y -= h + 10;
    if (view.fontNote) paragraph(view.fontNote, 8, regular, muted);
  }

  // ── The footer on every page ───────────────────────────────────────────────────────────────────────────────────────────────
  const pages = pdf.getPages();
  pages.forEach((pg, i) => {
    page = pg;
    rule(BOTTOM - 14, 0.75, hairline);
    let fy = BOTTOM - 26;
    for (const raw of view.footer) {
      for (const ln of wrapLine(raw, regular, 8, contentW * 0.74)) {
        put(ln, MARGIN, fy, 8, regular, muted);
        fy -= 10;
      }
    }
    putRight(`Page ${i + 1} of ${pages.length}`, pw - MARGIN, BOTTOM - 26, 8, regular, muted);
    putRight(`Prepared ${view.generatedOn}`, pw - MARGIN, BOTTOM - 36, 8, regular, muted);
  });

  const bytes = await pdf.save();
  return { bytes, pages: pages.length, text: drawn, logoDrawn };
}
