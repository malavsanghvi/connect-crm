// Readers for the JSON the Reports and Platform summary functions answer with (migrations 0672 and 0673). Each one checks the
// shape and gives back a typed value, or null when the database answered with something else (the caller then says "could not
// load", never shows zeros that nobody counted). Money stays integer cents. Pure.

import { asArr, asObj, int, isObj, rows, str } from "@/lib/commands/catalog/giving-json";

type Obj = Record<string, unknown>;

/** True when every named key is present (a function that answers with a different shape fails here, not as zeros). */
function has(o: Obj, ...keys: string[]): boolean {
  return keys.every((k) => o[k] !== undefined);
}

const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
export type PeopleOverview = {
  year: number;
  asOf: string | null;
  households: number;
  newInYear: number;
  householdsOnApp: number;
  zones: { zone: string; households: number }[];
  renewalsDue: number;
};

export function parsePeopleOverview(raw: unknown): PeopleOverview | null {
  if (!isObj(raw) || !has(raw, "households", "new_in_year", "households_on_app", "zones", "renewals_due")) return null;
  return {
    year: int(raw.year),
    asOf: str(raw.as_of),
    households: int(raw.households),
    newInYear: int(raw.new_in_year),
    householdsOnApp: int(raw.households_on_app),
    zones: rows(raw.zones).map((z) => ({ zone: str(z.zone) ?? "No zone", households: int(z.households) })),
    renewalsDue: int(raw.renewals_due),
  };
}

/** Households with a signed-in member, as a whole percent of all households; null when there are no households. */
export function onAppPercent(o: Pick<PeopleOverview, "households" | "householdsOnApp">): number | null {
  return o.households > 0 ? Math.round((100 * o.householdsOnApp) / o.households) : null;
}

export type MembershipMatrix = {
  cells: { tier: string; status: string; memberships: number }[];
  activeHouseholds: Record<string, number>;
  applications: Record<string, number>;
};

export function parseMembershipMatrix(raw: unknown): MembershipMatrix | null {
  if (!isObj(raw) || !has(raw, "cells", "active_households", "applications")) return null;
  return {
    cells: rows(raw.cells).map((c) => ({ tier: str(c.tier) ?? "", status: str(c.status) ?? "", memberships: int(c.memberships) })),
    activeHouseholds: Object.fromEntries(rows(raw.active_households).map((r) => [str(r.tier) ?? "", int(r.households)])),
    applications: Object.fromEntries(rows(raw.applications).map((r) => [str(r.status) ?? "", int(r.applications)])),
  };
}

export const cellCount = (m: MembershipMatrix, tier: string, status: string): number =>
  m.cells.filter((c) => c.tier === tier && c.status === status).reduce((sum, c) => sum + c.memberships, 0);

export type MembershipChanges = {
  from: string | null;
  to: string | null;
  started: { tier: string; memberships: number }[];
  startedTotal: number;
  ended: { status: string; memberships: number }[];
  endedTotal: number;
  applications: { status: string; applications: number }[];
  applicationsTotal: number;
  activeNow: number;
  renewalsDue60Days: number;
};

export function parseMembershipChanges(raw: unknown): MembershipChanges | null {
  if (!isObj(raw) || !has(raw, "started_total", "ended_total", "active_now")) return null;
  return {
    from: str(raw.from),
    to: str(raw.to),
    started: rows(raw.started).map((r) => ({ tier: str(r.tier) ?? "", memberships: int(r.memberships) })),
    startedTotal: int(raw.started_total),
    ended: rows(raw.ended).map((r) => ({ status: str(r.status) ?? "", memberships: int(r.memberships) })),
    endedTotal: int(raw.ended_total),
    applications: rows(raw.applications).map((r) => ({ status: str(r.status) ?? "", applications: int(r.applications) })),
    applicationsTotal: int(raw.applications_total),
    activeNow: int(raw.active_now),
    renewalsDue60Days: int(raw.renewals_due_60_days),
  };
}

// ---------------------------------------------------------------------------
// Giving
// ---------------------------------------------------------------------------
export type PaymentsSummary = {
  from: string | null;
  to: string | null;
  group: string;
  totals: { payments: number; receivedCents: number; refundedCents: number; netCents: number };
  groups: { key: string; label: string; payments: number; receivedCents: number; refundedCents: number | null; netCents: number | null }[];
};

export function parsePaymentsSummary(raw: unknown): PaymentsSummary | null {
  if (!isObj(raw)) return null;
  const totals = asObj(raw.totals);
  if (!has(totals, "payments", "received_cents", "refunded_cents", "net_cents")) return null;
  return {
    from: str(raw.from),
    to: str(raw.to),
    group: str(raw.group) ?? "none",
    totals: { payments: int(totals.payments), receivedCents: int(totals.received_cents), refundedCents: int(totals.refunded_cents), netCents: int(totals.net_cents) },
    groups: rows(raw.groups).map((g) => ({
      key: str(g.key) ?? "",
      label: str(g.label) ?? "",
      payments: int(g.payments),
      receivedCents: int(g.received_cents),
      refundedCents: intOrNull(g.refunded_cents),
      netCents: intOrNull(g.net_cents),
    })),
  };
}

export type PledgesSummary = {
  from: string | null;
  to: string | null;
  totals: { pledges: number; pledgedCents: number; paidCents: number; writtenOffCents: number };
  campaigns: { campaignId: string | null; campaign: string | null; pledges: number; pledgedCents: number; paidCents: number; writtenOffCents: number }[];
  openNow: { pledges: number; openCents: number };
};

export function parsePledgesSummary(raw: unknown): PledgesSummary | null {
  if (!isObj(raw)) return null;
  const totals = asObj(raw.totals);
  const open = asObj(raw.open_now);
  if (!has(totals, "pledges", "pledged_cents") || !has(open, "pledges", "open_cents")) return null;
  return {
    from: str(raw.from),
    to: str(raw.to),
    totals: { pledges: int(totals.pledges), pledgedCents: int(totals.pledged_cents), paidCents: int(totals.paid_cents), writtenOffCents: int(totals.written_off_cents) },
    campaigns: rows(raw.campaigns).map((c) => ({
      campaignId: str(c.campaign_id),
      campaign: str(c.campaign),
      pledges: int(c.pledges),
      pledgedCents: int(c.pledged_cents),
      paidCents: int(c.paid_cents),
      writtenOffCents: int(c.written_off_cents),
    })),
    openNow: { pledges: int(open.pledges), openCents: int(open.open_cents) },
  };
}

/** What is still owed on a campaign's pledges made in the range: pledged, less paid, less what was written off. */
export const outstandingCents = (c: { pledgedCents: number; paidCents: number; writtenOffCents: number }): number => c.pledgedCents - c.paidCents - c.writtenOffCents;

// ---------------------------------------------------------------------------
// Events and the store
// ---------------------------------------------------------------------------
export type Attendance = {
  from: string | null;
  to: string | null;
  checkIns: number;
  events: number;
  topEvents: { eventId: string | null; name: string; startsAt: string | null; checkIns: number }[];
  byMonth: { month: string; checkIns: number }[];
};

export function parseAttendance(raw: unknown): Attendance | null {
  if (!isObj(raw) || !has(raw, "check_ins", "events")) return null;
  return {
    from: str(raw.from),
    to: str(raw.to),
    checkIns: int(raw.check_ins),
    events: int(raw.events),
    topEvents: rows(raw.top_events).map((e) => ({ eventId: str(e.event_id), name: str(e.name) ?? "An event", startsAt: str(e.starts_at), checkIns: int(e.check_ins) })),
    byMonth: rows(raw.by_month).map((m) => ({ month: str(m.month) ?? "", checkIns: int(m.check_ins) })),
  };
}

export type StoreSales = {
  from: string | null;
  to: string | null;
  orders: number;
  salesCents: number;
  byMonth: { month: string; orders: number; salesCents: number }[];
  topItems: { item: string; units: number; salesCents: number }[];
};

export function parseStoreSales(raw: unknown): StoreSales | null {
  if (!isObj(raw) || !has(raw, "orders", "sales_cents")) return null;
  return {
    from: str(raw.from),
    to: str(raw.to),
    orders: int(raw.orders),
    salesCents: int(raw.sales_cents),
    byMonth: rows(raw.by_month).map((m) => ({ month: str(m.month) ?? "", orders: int(m.orders), salesCents: int(m.sales_cents) })),
    topItems: rows(raw.top_items).map((i) => ({ item: str(i.item) ?? "An item", units: int(i.units), salesCents: int(i.sales_cents) })),
  };
}

export type PeriodFigures = {
  from: string | null;
  to: string | null;
  giving: { payments: number; receivedCents: number; refundedCents: number; netCents: number };
  newHouseholds: number;
  membershipsStarted: number;
  applicationsReceived: number;
  checkIns: number;
  store: { orders: number; salesCents: number };
};

export function parsePeriodFigures(raw: unknown): PeriodFigures | null {
  if (!isObj(raw) || !has(raw, "giving", "new_households", "check_ins", "store")) return null;
  const g = asObj(raw.giving);
  const s = asObj(raw.store);
  return {
    from: str(raw.from),
    to: str(raw.to),
    giving: { payments: int(g.payments), receivedCents: int(g.received_cents), refundedCents: int(g.refunded_cents), netCents: int(g.net_cents) },
    newHouseholds: int(raw.new_households),
    membershipsStarted: int(raw.memberships_started),
    applicationsReceived: int(raw.applications_received),
    checkIns: int(raw.check_ins),
    store: { orders: int(s.orders), salesCents: int(s.sales_cents) },
  };
}

// ---------------------------------------------------------------------------
// Platform (0673)
// ---------------------------------------------------------------------------
export type WaitingItem = {
  /** golive, promote, verification, access_request or readiness. */
  kind: string;
  centerId: string | null;
  slug: string | null;
  community: string;
  since: string | null;
  detail: string;
  /** A few more sentences (the go-live checks that fail). */
  more: string[];
};

export type ConsentState = {
  centerId: string;
  slug: string;
  community: string;
  environment: string;
  /** not_agreed, on or off: the community's own administrator's agreement to record how the portal is used. */
  activityRecording: string;
  sharesWithWeaver: boolean;
  supportAccessUntil: string | null;
};

export type PlatformWaiting = {
  asOf: string | null;
  counts: { golive: number; promote: number; verification: number; accessRequests: number; readiness: number; accessRequestsWaitingOnThem: number };
  items: WaitingItem[];
  consent: ConsentState[];
};

export function parsePlatformWaiting(raw: unknown): PlatformWaiting | null {
  if (!isObj(raw) || !has(raw, "counts", "items", "consent")) return null;
  const c = asObj(raw.counts);
  return {
    asOf: str(raw.as_of),
    counts: {
      golive: int(c.golive),
      promote: int(c.promote),
      verification: int(c.verification),
      accessRequests: int(c.access_requests),
      readiness: int(c.readiness),
      accessRequestsWaitingOnThem: int(c.access_requests_waiting_on_them),
    },
    items: rows(raw.items).map((i) => ({
      kind: str(i.kind) ?? "other",
      centerId: str(i.center_id),
      slug: str(i.slug),
      community: str(i.community) ?? "A community",
      since: str(i.since),
      detail: str(i.detail) ?? "",
      more: asArr(i.more).filter((x): x is string => typeof x === "string"),
    })),
    consent: rows(raw.consent).map((k) => ({
      centerId: str(k.center_id) ?? "",
      slug: str(k.slug) ?? "",
      community: str(k.community) ?? "A community",
      environment: str(k.environment) ?? "",
      activityRecording: str(k.activity_recording) ?? "not_agreed",
      sharesWithWeaver: k.shares_with_weaver === true,
      supportAccessUntil: str(k.support_access_until),
    })),
  };
}

export type CommunitySummary = {
  community: {
    id: string;
    slug: string;
    name: string;
    status: string;
    environment: string;
    kind: string;
    tradition: string | null;
    timeZone: string;
    createdAt: string | null;
    movedToProductionAs: string | null;
    owner: string | null;
  };
  size: { households: number; people: number; signedInAccounts: number; activeMemberships: number };
  setup: { done: number; total: number } | null;
  readiness: { passing: number; total: number; failing: { check: string; detail: string }[] } | null;
  goLive: { status: string; requestedAt: string | null; firstApproved: boolean; secondApproved: boolean } | null;
  verification: { status: string; submittedAt: string | null; verifiedAt: string | null } | null;
  consent: { activityRecording: string; sharesWithWeaver: boolean; supportAccessUntil: string | null; nivaActionsSwitchedOn: number };
  modulesOff: string[];
  waysToPay: string[];
  portalAddresses: number;
  lastStaffActivityAt: string | null;
};

export function parseCommunitySummary(raw: unknown): CommunitySummary | null {
  if (!isObj(raw)) return null;
  const c = asObj(raw.community);
  if (!str(c.id) || !has(raw, "size", "consent")) return null;
  const size = asObj(raw.size);
  const consent = asObj(raw.consent);
  const setup = isObj(raw.setup) ? raw.setup : null;
  const ready = isObj(raw.readiness) ? raw.readiness : null;
  const golive = isObj(raw.go_live) ? raw.go_live : null;
  const verify = isObj(raw.verification) ? raw.verification : null;
  return {
    community: {
      id: str(c.id) ?? "",
      slug: str(c.slug) ?? "",
      name: str(c.name) ?? "A community",
      status: str(c.status) ?? "",
      environment: str(c.environment) ?? "",
      kind: str(c.kind) ?? "",
      tradition: str(c.tradition),
      timeZone: str(c.time_zone) ?? "",
      createdAt: str(c.created_at),
      movedToProductionAs: str(c.moved_to_production_as),
      owner: str(c.owner),
    },
    size: { households: int(size.households), people: int(size.people), signedInAccounts: int(size.signed_in_accounts), activeMemberships: int(size.active_memberships) },
    setup: setup ? { done: int(setup.done), total: int(setup.total) } : null,
    readiness: ready
      ? {
          passing: int(ready.passing),
          total: int(ready.total),
          failing: rows(ready.failing).map((f) => ({ check: str(f.check) ?? "", detail: str(f.detail) ?? "" })),
        }
      : null,
    goLive: golive
      ? { status: str(golive.status) ?? "", requestedAt: str(golive.requested_at), firstApproved: golive.first_approved === true, secondApproved: golive.second_approved === true }
      : null,
    verification: verify ? { status: str(verify.status) ?? "unverified", submittedAt: str(verify.submitted_at), verifiedAt: str(verify.verified_at) } : null,
    consent: {
      activityRecording: str(consent.activity_recording) ?? "not_agreed",
      sharesWithWeaver: consent.shares_with_weaver === true,
      supportAccessUntil: str(consent.support_access_until),
      nivaActionsSwitchedOn: int(consent.niva_actions_switched_on),
    },
    modulesOff: asArr(raw.modules_off).filter((x): x is string => typeof x === "string"),
    waysToPay: asArr(raw.ways_to_pay).filter((x): x is string => typeof x === "string"),
    portalAddresses: int(raw.portal_addresses),
    lastStaffActivityAt: str(raw.last_staff_activity_at),
  };
}
