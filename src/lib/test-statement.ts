// The "Test Bank Statement" of a sandbox or a demo community: a CSV built from that community's own test data, so importing it shows
// the Reconcile view doing each of its jobs (a line that fits an open pledge, a payment recorded by hand and waiting for the bank, a
// payment confirmation waiting to be approved, a payer nobody knows, money out). Pure: the route that serves it reads the community,
// this file only words the lines and writes the CSV (in the format of the community's own bank account).

export type StatementFormat = "chase_csv" | "generic_csv";

export type SampleSource = {
  /** Today in the community's time zone, YYYY-MM-DD. */
  today: string;
  format: StatementFormat;
  /** Open pledges, one per family: who would pay, and how much of it is still uncovered. */
  pledges: { payer: string | null; cents: number }[];
  /** Payments recorded by hand that no bank line has banked yet. */
  payments: { payer: string | null; method: string; cents: number; checkNumber: string | null }[];
  /** Payment confirmations waiting for the treasury team. */
  proofs: { payer: string | null; method: string; cents: number; reference: string | null }[];
};

export type SampleLine = {
  daysAgo: number;
  description: string;
  /** Money in is positive; the one fee line is money out. */
  cents: number;
  /** Chase's own words for the kind of line. */
  type: string;
  details: string;
  check: string;
  /** What the Reconcile view should make of it, for the person reading the file's notes (not part of the CSV). */
  note: string;
};

/** A sandbox, or a demo community: the only places the test statement is offered. */
export function isTestCommunity(c: { environment?: string | null; rules?: unknown }, demoSession = false): boolean {
  const rules = c.rules && typeof c.rules === "object" ? (c.rules as { demo?: unknown }) : null;
  return c.environment === "sandbox" || demoSession || rules?.demo === true;
}

const MAX_EACH = 3;

/** A reference the way a Zelle line carries one: letters and digits, twelve of them, the same every time. */
function zelleRef(n: number): string {
  return `WFCT0TEST${String(n).padStart(3, "0")}`;
}

function zelle(payer: string | null, cents: number, daysAgo: number, n: number, note: string): SampleLine {
  return { daysAgo, description: `Zelle payment from ${payer ?? "Community Member"} ${zelleRef(n)}`, cents, type: "QUICKPAY_CREDIT", details: "CREDIT", check: "", note };
}

function byMethod(method: string, payer: string | null, cents: number, daysAgo: number, n: number, check: string | null, note: string): SampleLine {
  if (method === "zelle") return zelle(payer, cents, daysAgo, n, note);
  if (method === "check") {
    return { daysAgo, description: `Check deposit${check ? ` #${check}` : ""}`, cents, type: "CHECK_DEPOSIT", details: "DSLIP", check: check ?? "", note };
  }
  return { daysAgo, description: `DEPOSIT  ID NUMBER ${4400 + n}`, cents, type: "DEPOSIT", details: "DSLIP", check: "", note };
}

/** The lines of the statement, newest first. */
export function sampleLines(src: SampleSource): SampleLine[] {
  const lines: SampleLine[] = [];
  src.pledges.slice(0, MAX_EACH).forEach((p, i) => {
    lines.push(zelle(p.payer, p.cents, 1 + i, 1 + i, "Fits what this family still owes on an open pledge, so it is offered as new money for that pledge."));
  });
  src.payments.slice(0, 2).forEach((p, i) => {
    lines.push(byMethod(p.method, p.payer, p.cents, 4 + i, 10 + i, p.checkNumber, "Equals a payment already recorded by hand: Attach it, and no second payment is made."));
  });
  src.proofs.slice(0, 2).forEach((p, i) => {
    lines.push(byMethod(p.method, p.payer, p.cents, 6 + i, 20 + i, p.reference, "Equals a payment confirmation that is waiting: Approve and reconcile it."));
  });
  lines.push(zelle("Jordan Visitor", 7500, 2, 90, "Nobody in the community has this payer: the row says nothing explains it, and it is matched by hand or ignored."));
  lines.push({ daysAgo: 8, description: "DEPOSIT  ID NUMBER 9001", cents: 25000, type: "DEPOSIT", details: "DSLIP", check: "", note: "A deposit with no recorded checks or cash to explain it." });
  lines.push({ daysAgo: 9, description: "MONTHLY SERVICE FEE", cents: -1200, type: "FEE_TRANSACTION", details: "DEBIT", check: "", note: "Money out: only read when the import box for money out is ticked." });
  return lines.sort((a, b) => a.daysAgo - b.daysAgo);
}

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

function cell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** The CSV, in the format the community's bank account expects. */
export function buildTestStatement(src: SampleSource): { csv: string; lines: SampleLine[] } {
  const lines = sampleLines(src);
  const dated = lines.map((l) => ({ l, on: shiftDate(src.today, l.daysAgo) }));
  const out: string[] = [];
  if (src.format === "chase_csv") {
    // A running balance, worked from the oldest line to the newest and listed newest first, as the bank does.
    let balance = 1_250_000;
    const withBalance = [...dated].reverse().map((r) => {
      balance += r.l.cents;
      return { ...r, balance };
    });
    out.push("Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #");
    for (const r of withBalance.reverse()) {
      const [y, m, d] = r.on.split("-");
      out.push([r.l.details, `${m}/${d}/${y}`, cell(r.l.description), money(r.l.cents), r.l.type, money(r.balance), r.l.check].join(","));
    }
  } else {
    out.push("Date,Amount,Description,Check number");
    for (const r of dated) out.push([r.on, money(r.l.cents), cell(r.l.description), r.l.check].join(","));
  }
  return { csv: `${out.join("\n")}\n`, lines };
}
