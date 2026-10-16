import "server-only";

import { userNames } from "@/lib/data/lookups";
import type { DbErrorLike } from "@/lib/errors";
import {
  parseChipInOverview,
  parseChipInSettingsRow,
  parseFeeRateRows,
  parseFeeRates,
  splitPlatformRates,
  whoChanged,
  type ChipInOverview,
  type ChipInSettings,
  type FeeRateRow,
  type FeeRates,
} from "@/lib/payments/chip-in-platform";
import type { CrmSession } from "@/lib/session";

// What the platform team's Chip In card (Platform › Centers › one organization) and the fee-rate card (Platform › Payments) read.
// Each part is read on its own, so one that fails says so in its own place and the rest still shows. A refusal by the database's
// permission rules is its own answer ("You don't have access to this area"), never an empty table.

export type Section<T> = { ok: true; value: T } | { ok: false; reason: "no_access" } | { ok: false; reason: "error"; error: unknown };

const OK = <T>(value: T): Section<T> => ({ ok: true, value });

/** The database's "not allowed": a function that checks the platform admin, or a row level security refusal. */
export function isNoAccess(error: DbErrorLike | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42501" || /row-level security|permission denied|only the weaver team/i.test(error.message ?? "");
}

function fail<T>(error: DbErrorLike): Section<T> {
  return isNoAccess(error) ? { ok: false, reason: "no_access" } : { ok: false, reason: "error", error };
}

function badShape<T>(message: string): Section<T> {
  return { ok: false, reason: "error", error: new Error(message) };
}

export type ChipInCardData = {
  settings: Section<ChipInSettings | null>;
  overview: Section<ChipInOverview>;
  rates: Section<FeeRates>;
  /** "Last changed by": a name, "you", "a Weaver platform admin" or "Weaver's team". */
  changedBy: string;
};

/** The three reads behind the card on Platform › Centers › [organization]. */
export async function loadChipInCard(session: CrmSession, centerId: string): Promise<ChipInCardData> {
  const { db } = session;
  const [overviewRes, settingsRes, ratesRes] = await Promise.all([
    db.rpc("chip_in_overview", { p_center: centerId }),
    db
      .from("chip_in_settings")
      .select("asking, yearly_limit_cents, suggested_cents, reason, updated_by, updated_at")
      .eq("center_id", centerId)
      .maybeSingle(),
    db.rpc("payment_fee_rates_for", { p_center: centerId }),
  ]);

  let overview: Section<ChipInOverview>;
  if (overviewRes.error) overview = fail(overviewRes.error);
  else {
    const parsed = parseChipInOverview(overviewRes.data);
    overview = parsed.ok ? OK(parsed.value) : badShape(parsed.error);
  }

  let settings: Section<ChipInSettings | null>;
  if (settingsRes.error) settings = fail(settingsRes.error);
  else {
    const parsed = parseChipInSettingsRow(settingsRes.data);
    settings = parsed.ok ? OK(parsed.value) : badShape(parsed.error);
  }

  let rates: Section<FeeRates>;
  if (ratesRes.error) rates = fail(ratesRes.error);
  else {
    const parsed = parseFeeRates(ratesRes.data);
    rates = parsed.ok ? OK(parsed.value) : badShape(parsed.error);
  }

  // The database refused the platform check: the card says so once, instead of showing a form over data that was hidden.
  if (!overview.ok && overview.reason === "no_access") {
    const refused: Section<never> = { ok: false, reason: "no_access" };
    return { settings: refused, overview: refused, rates: refused, changedBy: "" };
  }

  let name: string | null = null;
  const by = settings.ok ? settings.value?.updatedBy : null;
  if (by) name = (await userNames(db, session.center.id, [by])).get(by)?.name ?? null;
  return { settings, overview, rates, changedBy: settings.ok && settings.value ? whoChanged(settings.value.updatedBy, session.userId, name) : "" };
}

export type PlatformFeeRatesData = {
  /** The rate in effect for each way to pay. */
  effective: FeeRates;
  /** The earlier platform rate rows, newest first, with who added each. */
  earlier: (FeeRateRow & { by: string })[];
};

/** The platform-wide Stripe fee rates (rows with no organization) for Platform › Payments. */
export async function loadPlatformFeeRates(session: CrmSession): Promise<Section<PlatformFeeRatesData>> {
  const { db } = session;
  const res = await db
    .from("payment_fee_rates")
    .select("id, method_class, bps, fixed_cents, cap_cents, effective_from, source_note, set_by")
    .is("center_id", null)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(30);
  if (res.error) return fail(res.error);
  const parsed = parseFeeRateRows(res.data);
  if (!parsed.ok) return badShape(parsed.error);
  const rows = parsed.value;
  const { effective, earlier } = splitPlatformRates(rows);
  const names = await userNames(db, session.center.id, earlier.map((r) => r.setBy));
  return OK({
    effective,
    earlier: earlier.map((r) => ({ ...r, by: whoChanged(r.setBy, session.userId, r.setBy ? (names.get(r.setBy)?.name ?? null) : null) })),
  });
}
