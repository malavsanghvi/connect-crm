import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { buildPledgeDocument, paperFor, pledgePdfFileName, pdfMoney, type PledgeDocData } from "@/lib/pledge-pdf/document";
import { firstDrawableLogo, sniffLogo } from "@/lib/pledge-pdf/logo";
import { renderPledgePdf, wrapLine } from "@/lib/pledge-pdf/render";
import { drawable, drawableMoney } from "@/lib/pledge-pdf/text";
import { emailPlace } from "@/lib/merge/format";

// The pledge PDF: one builder (what it says) and one renderer (how it is drawn), used by the Print route and by the email's
// attachment. Money is integer cents until the builder formats it, in the community's own currency, locale and time zone.

const RIVERSIDE: PledgeDocData = {
  center: {
    id: "c-1",
    name: "Riverside Community Center",
    currency: "USD",
    time_zone: "America/Chicago",
    country: "US",
    languages: ["en"],
    household_label: "Member household ID",
    branding: { logo_path: "c-1/brand/logo-1.png", mark_path: "c-1/brand/mark-1.png", primary: "#1B2C5C", accent: "#C9731C", address: null },
  },
  organization: {
    legal_name: "Riverside Community Center Inc.",
    ein: "12-3456789",
    address: { line1: "100 River Rd", city: "Houston", state: "TX", postal_code: "77001" },
    public_email: "office@riverside.example",
    public_phone: "+1 713 555 0100",
    website: "https://riverside.example",
  },
  pledge: {
    id: "p-1",
    number: "PL-0455",
    status: "partially_paid",
    pledged_at: "2026-10-03",
    due_on: "2026-11-02",
    amount_cents: 120_000,
    paid_cents: 40_000,
    installments: 3,
    dedication: "In memory of a friend",
    campaign: "Building campaign",
    fund: "Building fund",
    pledged_by: "Tunde Adeyemi",
  },
  household: {
    id: "h-1",
    name: "Adeyemi, Tunde, Folake & Zoya",
    number: "H-0127",
    org_household_id: "0127",
    primary_member: "Tunde Adeyemi",
    minor_first_names: ["Zoya"],
    address: { line1: "12 Oak St", city: "Houston", state_region: "TX", postal_code: "77002" },
  },
  payments: [
    { received_on: "2026-10-20", method: "check", receipt_number: "R-100231", amount_cents: 25_000 },
    { received_on: "2026-10-27", method: "zelle", receipt_number: "R-100244", amount_cents: 15_000 },
  ],
  wording: { signed_by: "The Treasurer", personal_note: "Thank you for building this with us." },
};

const NOW = new Date("2026-10-14T15:00:00Z");

describe("what the pledge PDF says", () => {
  const view = buildPledgeDocument(RIVERSIDE, { supabaseUrl: "https://x.supabase.co", now: NOW });

  it("carries the standard invoice details, in the community's own words and money", () => {
    expect(view.communityName).toBe("Riverside Community Center");
    expect(view.facts).toEqual([
      { label: "Pledge number", value: "PL-0455" },
      { label: "Date made", value: "October 3, 2026" },
      { label: "Due date", value: "November 2, 2026" },
      { label: "Status", value: "Partly paid" },
    ]);
    expect(view.amounts).toEqual([
      { label: "Amount pledged", value: "$1,200.00" },
      { label: "Paid to date", value: "$400.00" },
      { label: "Balance due", value: "$800.00", strong: true },
    ]);
    expect(view.balanceCents).toBe(80_000);
    expect(view.purpose).toEqual([
      { label: "Campaign", value: "Building campaign" },
      { label: "Fund", value: "Building fund" },
      { label: "Dedication", value: "In memory of a friend" },
      { label: "Pledged by", value: "Tunde Adeyemi" },
    ]);
    expect(view.payments).toEqual([
      { date: "October 20, 2026", method: "Check", reference: "R-100231", amount: "$250.00" },
      { date: "October 27, 2026", method: "Zelle", reference: "R-100244", amount: "$150.00" },
    ]);
    expect(view.paymentsTotal).toBe("$400.00");
    expect(view.instalments).toContain("3 instalments");
    expect(view.note).toBe("Thank you for building this with us.");
    expect(view.signedBy).toBe("The Treasurer");
    expect(view.generatedOn).toBe("October 14, 2026");
  });

  it("shows the family by its household card, never a child's name, and never by name alone", () => {
    expect(view.family.name).toBe("Adeyemi, Tunde, Folake");
    expect(view.family.lines).toEqual(["Household number H-0127", "Member household ID 0127", "Primary member: Tunde Adeyemi", "12 Oak St", "Houston, TX 77002"]);
    expect(JSON.stringify(view)).not.toContain("Zoya");
  });

  it("has the community's contact, address, tax id, footer and how to pay", () => {
    expect(view.communityLines).toEqual(["Riverside Community Center Inc.", "100 River Rd", "Houston, TX 77001", "+1 713 555 0100 · office@riverside.example · https://riverside.example"]);
    expect(view.footer[0]).toBe("Riverside Community Center Inc. · EIN 12-3456789");
    expect(view.footer[1]).toContain("not a receipt");
    expect(view.howToPay).toContain("contact Riverside Community Center (+1 713 555 0100 or office@riverside.example) and quote pledge PL-0455");
  });

  it("brands with the community's colours and logo files (the logo first, then the mark), in the public branding bucket", () => {
    expect(view.brand).toEqual({ primary: "#1B2C5C", accent: "#C9731C" });
    expect(view.logoUrls).toEqual([
      "https://x.supabase.co/storage/v1/object/public/branding/c-1/brand/logo-1.png",
      "https://x.supabase.co/storage/v1/object/public/branding/c-1/brand/mark-1.png",
    ]);
    expect(buildPledgeDocument(RIVERSIDE, {}).logoUrls).toEqual([]);
  });

  it("uses the platform's colours when the community has none (or a bad one), and the paper of its country", () => {
    const plain = buildPledgeDocument({ center: { name: "Bare Club", country: "GB", branding: { primary: "not a colour" } }, pledge: { amount_cents: 500 } });
    expect(plain.brand).toEqual({ primary: "#1B2C5C", accent: "#C9731C" });
    expect(plain.paper).toBe("a4");
    expect(paperFor("US")).toBe("letter");
    expect(paperFor("in")).toBe("a4");
    expect(paperFor(null)).toBe("a4");
  });

  it("a paid, written-off or cancelled pledge owes nothing; an open one owes the difference, to the cent", () => {
    const b = (status: string, paid: number) => buildPledgeDocument({ pledge: { status, amount_cents: 10_001, paid_cents: paid } });
    expect(b("open", 1).balanceCents).toBe(10_000);
    expect(b("partially_paid", 10_001).balanceCents).toBe(0);
    expect(b("paid", 0).balanceCents).toBe(0);
    expect(b("written_off", 100).balanceCents).toBe(0);
    expect(b("cancelled", 0).amounts[2]).toEqual({ label: "Balance", value: "$0.00", strong: true });
    expect(b("open", 1).amounts[0]?.value).toBe("$100.01");
  });

  it("writes money in another community's currency and locale, drawing the code where Helvetica lacks the symbol", () => {
    const india = emailPlace({ currency: "INR", time_zone: "Asia/Kolkata", country: "IN", languages: ["en"] });
    const spain = emailPlace({ currency: "EUR", time_zone: "Europe/Madrid", country: "ES", languages: ["es"] });
    expect(pdfMoney(12_500_050, india)).toBe("INR 1,25,000.50");
    expect(pdfMoney(12_500_050, spain)).toBe("125.000,50 €");
    expect(pdfMoney(-250, emailPlace({ currency: "USD" }))).toBe("-$2.50");
    const inr = buildPledgeDocument({ center: { name: "Chamber", currency: "INR", country: "IN", time_zone: "Asia/Kolkata", languages: ["en"] }, pledge: { amount_cents: 12_500_050, pledged_at: "2026-10-03" } });
    expect(inr.amounts[0]?.value).toBe("INR 1,25,000.50");
    expect(inr.facts[1]?.value).toBe("3 October 2026");
  });

  it("says when a letter had to be drawn plainer, and never prints a character the font lacks", () => {
    const v = buildPledgeDocument({ center: { name: "Club" }, household: { name: "Łukasz Ñandú" }, pledge: { amount_cents: 100 } });
    expect(v.family.name).toBe("?ukasz Ñandú");
    expect(v.fontNote).toContain("plainer form");
    expect(drawable("Ångström‑ünit").text).toBe("Ångström?ünit");
    expect(drawable("Zoë\u202f\u00a0Ng\u200b").text).toBe("Zoë Ng");
    expect(drawable("tab\tline\nbreak").text).toBe("tab line break");
    expect(drawable("ś").text).toBe("s");
    expect(buildPledgeDocument(RIVERSIDE).fontNote).toBeNull();
  });

  it("names the file for the pledge and the community, with plain letters", () => {
    expect(view.fileName).toBe("Pledge-PL-0455-Riverside-Community-Center.pdf");
    expect(pledgePdfFileName(null, "Société Générale / Club")).toBe("Pledge-Societe-Generale-Club.pdf");
    expect(pledgePdfFileName("PL 9", null)).toBe("Pledge-PL-9.pdf");
    expect(pledgePdfFileName(null, null)).toBe("Pledge.pdf");
  });

  it("is honest about a pledge with no number, due date or payments", () => {
    const v = buildPledgeDocument({ center: { name: "Club" }, pledge: { status: "open", amount_cents: 2_500, paid_cents: 0 }, household: { name: "Rao" } });
    expect(v.number).toBe("Not numbered yet");
    expect(v.facts[2]?.value).toBe("—");
    expect(v.payments).toEqual([]);
    expect(v.paymentsTotal).toBeNull();
    expect(v.howToPay).toBe("To pay this pledge, contact Club and quote pledge number.");
  });
});

describe("the text the font can draw", () => {
  it("knows the Western European set", () => {
    expect(drawable("Zoë Ñ € “q” – — …").changed).toBe(false);
    expect(drawable("日本").text).toBe("??");
    expect(drawableMoney((d) => (d === "symbol" ? "₹100.00" : "INR 100.00"))).toBe("INR 100.00");
    expect(drawableMoney((d) => (d === "symbol" ? "$100.00" : "USD 100.00"))).toBe("$100.00");
  });

  it("wraps lines to a width and cuts a word that cannot fit", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont("Helvetica");
    const lines = wrapLine("one two three four five six seven eight nine ten", font, 10, 60);
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(60);
    expect(wrapLine("", font, 10, 60)).toEqual([""]);
    const cut = wrapLine("Supercalifragilisticexpialidocious", font, 10, 50);
    expect(cut.join("")).toBe("Supercalifragilisticexpialidocious");
    for (const l of cut) expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(50);
  });
});

// A 1x1 PNG and a minimal JPEG header, enough to tell the types apart and for pdf-lib to embed the PNG.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const JPEG_HEAD = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

describe("the logo", () => {
  it("is a PNG or a JPEG, told by its bytes, not by its name", () => {
    expect(sniffLogo(PNG)).toBe("png");
    expect(sniffLogo(JPEG_HEAD)).toBe("jpg");
    expect(sniffLogo(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffLogo(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBeNull();
    expect(sniffLogo(new Uint8Array())).toBeNull();
  });

  it("is the first file that loads and can be drawn: a WebP logo, a missing file and a huge file are skipped", async () => {
    const files: Record<string, Uint8Array | null | "throw"> = {
      "u://webp": Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      "u://missing": null,
      "u://boom": "throw",
      "u://huge": new Uint8Array(700_000).fill(1),
      "u://png": PNG,
    };
    const fetchBytes = async (url: string) => {
      const f = files[url];
      if (f === "throw") throw new Error("network down");
      return f ?? null;
    };
    const logo = await firstDrawableLogo(["u://webp", "u://missing", "u://boom", "u://huge", "u://png"], fetchBytes);
    expect(logo?.kind).toBe("png");
    expect(await firstDrawableLogo(["u://webp", "u://missing"], fetchBytes)).toBeNull();
    expect(await firstDrawableLogo([], fetchBytes)).toBeNull();
  });
});

describe("the rendered PDF", () => {
  it("is one valid PDF with the details drawn on it, and its metadata", async () => {
    const view = buildPledgeDocument(RIVERSIDE, { now: NOW });
    const out = await renderPledgePdf(view, null);
    expect(new TextDecoder().decode(out.bytes.slice(0, 5))).toBe("%PDF-");
    const pdf = await PDFDocument.load(out.bytes);
    expect(pdf.getPageCount()).toBe(out.pages);
    expect(out.pages).toBe(1);
    expect(pdf.getTitle()).toBe("Pledge PL-0455 · Riverside Community Center");
    expect(pdf.getAuthor()).toBe("Riverside Community Center");
    // Letter paper for a US community.
    expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    const said = out.text.join("\n");
    for (const expected of [
      "Riverside Community Center",
      "PLEDGE",
      "No. PL-0455",
      "Adeyemi, Tunde, Folake",
      "Household number H-0127",
      "Primary member: Tunde Adeyemi",
      "Pledge number",
      "October 3, 2026",
      "November 2, 2026",
      "Partly paid",
      "Building campaign",
      "Building fund",
      "Amount pledged",
      "$1,200.00",
      "Paid to date",
      "$400.00",
      "Balance due",
      "$800.00",
      "R-100231",
      "$250.00",
      "R-100244",
      "Total applied",
      "Thank you for building this with us.",
      "EIN 12-3456789",
      "Page 1 of 1",
      "Prepared October 14, 2026",
    ]) {
      expect(said, expected).toContain(expected);
    }
    expect(said).not.toContain("Zoya");
    expect(out.logoDrawn).toBe(false);
  });

  it("draws the logo when it can, and the name when it cannot", async () => {
    const view = buildPledgeDocument(RIVERSIDE, { now: NOW });
    const withLogo = await renderPledgePdf(view, { bytes: PNG, kind: "png" });
    expect(withLogo.logoDrawn).toBe(true);
    // Bytes that are not a picture: the name stays, nothing breaks.
    const broken = await renderPledgePdf(view, { bytes: Uint8Array.from([1, 2, 3]), kind: "png" });
    expect(broken.logoDrawn).toBe(false);
    expect(broken.text).toContain("Riverside Community Center");
    expect(withLogo.bytes.length).toBeGreaterThan(broken.bytes.length - 1);
  });

  it("uses A4 for a community outside the Letter countries, and fits a long list of payments on more pages", async () => {
    const many: PledgeDocData = {
      ...RIVERSIDE,
      center: { ...RIVERSIDE.center, country: "GB", currency: "GBP", languages: ["en"] },
      payments: Array.from({ length: 70 }, (_, i) => ({ received_on: "2026-10-20", method: "check", receipt_number: `R-${1000 + i}`, amount_cents: 100 })),
    };
    const out = await renderPledgePdf(buildPledgeDocument(many, { now: NOW }), null);
    const pdf = await PDFDocument.load(out.bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(pdf.getPage(0).getSize().width).toBeCloseTo(595.28, 1);
    expect(out.text.filter((t) => t.startsWith("R-10")).length).toBe(70);
    expect(out.text).toContain(`Page 2 of ${out.pages}`);
    expect(out.text.some((t) => t.endsWith("(continued)"))).toBe(true);
    // The payment table's heading is drawn again on the next page.
    expect(out.text.filter((t) => t === "Receipt").length).toBeGreaterThan(1);
  });

  it("renders a bare pledge with nothing but its amount", async () => {
    const out = await renderPledgePdf(buildPledgeDocument({ pledge: { amount_cents: 1 } }, { now: NOW }), null);
    expect(out.text).toContain("$0.01");
    expect(out.text).toContain("No payment has been applied to this pledge yet.");
  });
});
