// Money is integer cents everywhere (docs/ARCHITECTURE.md). Format only at the edge.

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string): Intl.NumberFormat {
  let f = formatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatters.set(currency, f);
  }
  return f;
}

/**
 * The single money formatter. `null`/`undefined` render as an em dash so a
 * missing amount is never mistaken for $0.00.
 */
export function formatCents(
  cents: number | bigint | null | undefined,
  currency: string = "USD",
): string {
  if (cents === null || cents === undefined) return "—";
  const n = typeof cents === "bigint" ? Number(cents) : cents;
  if (!Number.isFinite(n)) return "—";
  const whole = Math.round(n);
  const negative = whole < 0;
  const abs = Math.abs(whole);
  // Integer arithmetic for the cents so large amounts never pick up float error.
  const dollars = Math.trunc(abs / 100);
  const rest = abs % 100;
  const parts = formatter(currency).formatToParts(dollars);
  const out = parts
    .map((p) => (p.type === "fraction" ? String(rest).padStart(2, "0") : p.value))
    .join("");
  return negative ? `-${out}` : out;
}

/**
 * Parse a human-entered or statement amount into integer cents.
 * Accepts "$1,234.56", "1234", "12.5", "-12.00" and accounting negatives "(12.00)".
 * Returns null for anything that is not a clean amount (including more than 2 decimals).
 */
export function parseAmountToCents(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (!s) return null;
  let parenthesized = false;
  if (/^\(.*\)$/.test(s)) {
    parenthesized = true;
    s = s.slice(1, -1).trim();
  }
  // One optional sign, before or after the "$" ("-$12", "$-12", "+12"); never two.
  const m = /^([+-])?\s*\$?\s*([+-])?\s*(\d*)(?:\.(\d{0,2}))?$/.exec(s.replace(/,/g, ""));
  if (!m) return null;
  const [, sign1, sign2, whole, frac] = m;
  if (sign1 && sign2) return null;
  const sign = sign1 ?? sign2;
  if (parenthesized && sign) return null;
  if (whole === "" && (frac === undefined || frac === "")) return null;
  const dollars = whole === "" ? 0 : Number(whole);
  const cents = frac === undefined || frac === "" ? 0 : Number(frac.padEnd(2, "0"));
  const total = dollars * 100 + cents;
  if (!Number.isSafeInteger(total)) return null;
  return parenthesized || sign === "-" ? -total : total;
}

/** Sum of integer cents. */
export function sumCents(values: Array<number | null | undefined>): number {
  let t = 0;
  for (const v of values) if (typeof v === "number" && Number.isFinite(v)) t += v;
  return t;
}
