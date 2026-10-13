// DEV PREVIEW AND TESTS ONLY (src/app/dev/giving-counts): invented counts for a neutral community club, so the counts tab can be
// drawn, screenshotted and tested without a database. Every name, number and amount is made up. The rows and chips come from the
// same pure core the real loader uses; what each role may do is decided as on the real page.

import { LISTS_COMMUNITY, LISTS_ROLES, type Community, type ListsRole } from "@/lib/giving-lists/fixtures";
import { switchedOff } from "@/lib/giving-lists/model";
import { TODAY_DATE, TODAY_FAMILIES } from "@/lib/giving-today/fixtures";
import { givingTabs } from "@/lib/giving-today/tabs";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess, type ScopedContext } from "@/lib/permissions";
import { hrefWith, type RawSearchParams } from "@/lib/search-params";
import { countsWord } from "@/lib/wording";

import { denominationsFor } from "./denominations";
import {
  countChips,
  countRow,
  countsSummary,
  countViewFromParam,
  isDeposited,
  type BankLineIn,
  type CountCan,
  type CounterChoice,
  type CountIn,
  type CountsModel,
} from "./model";

const cid = (n: number) => `3c2b1a09-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const SAMPLE_COUNTS: CountIn[] = [
  { id: cid(1), countedOn: "2026-10-11", totalCents: 41_250, bags: ["118", "119"], counters: ["Sam Carter", "Linh Nguyen"], event: "Harvest supper", depositRef: null, paymentId: null, matched: false, line: null },
  { id: cid(2), countedOn: "2026-10-04", totalCents: 38_000, bags: ["116", "117"], counters: ["Ama Mensah", "Tola Adeyemi"], event: null, depositRef: null, paymentId: null, matched: true, line: { id: cid(92), postedOn: "2026-10-06", amountCents: 38_000, account: "Operating ••4410" } },
  { id: cid(3), countedOn: "2026-09-27", totalCents: 52_475, bags: ["114", "115"], counters: ["Sam Carter", "Grace Lindqvist"], event: null, depositRef: "SLIP-4471", paymentId: null, matched: false, line: null },
  { id: cid(4), countedOn: "2026-10-12", totalCents: 0, bags: ["120"], counters: ["Lee Park", "Linh Nguyen"], event: null, depositRef: null, paymentId: null, matched: false, line: null },
];

/** The adults who can count, with their household cards (Linh and Sam share no household; Grace and Lee do). */
export const SAMPLE_COUNTERS: CounterChoice[] = [
  { userId: "u-0000-ama", name: "Ama Mensah", householdId: TODAY_FAMILIES.adeyemi.id, family: TODAY_FAMILIES.adeyemi },
  { userId: "u-0000-grace", name: "Grace Lindqvist", householdId: TODAY_FAMILIES.lindqvist.id, family: TODAY_FAMILIES.lindqvist },
  { userId: "u-0000-lee", name: "Lee Park", householdId: TODAY_FAMILIES.lindqvist.id, family: TODAY_FAMILIES.lindqvist },
  { userId: "u-0000-linh", name: "Linh Nguyen", householdId: TODAY_FAMILIES.nguyen.id, family: TODAY_FAMILIES.nguyen },
  { userId: "u-0000-sam", name: "Sam Carter", householdId: null, family: null },
];

/** Bank lines near the Oct 11 count: one of exactly its amount, one already taken by another count, one a cent off. */
export const SAMPLE_LINES: BankLineIn[] = [
  { id: cid(91), postedOn: "2026-10-13", amountCents: 41_250, description: "DEPOSIT BRANCH 0212 SLIP 4480", account: "Operating ••4410", status: "unmatched", taken: false },
  { id: cid(92), postedOn: "2026-10-06", amountCents: 38_000, description: "DEPOSIT BRANCH 0212 SLIP 4476", account: "Operating ••4410", status: "matched", taken: true },
  { id: cid(93), postedOn: "2026-10-12", amountCents: 41_251, description: "DEPOSIT BRANCH 0212", account: "Operating ••4410", status: "unmatched", taken: false },
];

function scoped(role: ListsRole, c: Community, modulesOff: readonly string[]): ScopedContext & { kind: Community["kind"] } {
  return { permissions: LISTS_ROLES[role].permissions, isPlatformAdmin: false, modulesOff: ["bolis", ...modulesOff], kind: c.kind };
}

export function sampleCountCan(role: ListsRole, c: Community = LISTS_COMMUNITY, modulesOff: readonly string[] = []): CountCan {
  const ctx = scoped(role, c, modulesOff);
  const bankOn = isModuleEnabled(ctx, "giving_bank");
  return { record: canAccess(ctx, "countingRecord"), match: bankOn && canAccess(ctx, "bankConfirm"), unmatch: bankOn && canAccess(ctx, "givingManage") };
}

export function sampleCountsModel(
  role: ListsRole = "treasurer",
  sp: RawSearchParams = {},
  c: Community = LISTS_COMMUNITY,
  opts: { modulesOff?: readonly string[] } = {},
): CountsModel {
  const modulesOff = opts.modulesOff ?? [];
  const ctx = scoped(role, c, modulesOff);
  const bankOn = isModuleEnabled(ctx, "giving_bank");
  const can = sampleCountCan(role, c, modulesOff);
  const word = countsWord(c.kind);
  const view = countViewFromParam(typeof sp.view === "string" ? sp.view : undefined);
  const path = "/dev/giving-counts";
  const fmt = { currency: c.currency, locale: c.locale, timeZone: c.timeZone, today: TODAY_DATE };
  const shell: CountsModel = {
    title: "Giving",
    tabs: givingTabs(ctx),
    ...fmt,
    labels: { orgMemberLabel: "member", orgHouseholdLabel: "Club household ID" },
    q: "",
    searchLabel: "",
    searchBase: path,
    pager: null,
    expandSingle: false,
    problems: [],
    note: null,
    recordHref: null,
    body: { state: "ok", rows: [], empty: "" },
    view,
    chips: [],
    can,
    bankOn,
    countsWord: word,
    summary: null,
  };
  const none: CountCan = { record: false, match: false, unmatch: false };
  if (!isModuleEnabled(ctx, "giving_counts")) return { ...shell, can: none, body: switchedOff(c.kind, "giving_counts", c.name) };
  if (!canAccess(ctx, "counting")) return { ...shell, can: none, body: { state: "no_access", area: word, access: "counting" } };
  const waiting = SAMPLE_COUNTS.filter((x) => !isDeposited(x));
  const shown = SAMPLE_COUNTS.filter((x) => view === "all" || (view === "waiting" ? !isDeposited(x) : isDeposited(x)));
  return {
    ...shell,
    chips: countChips(view, { all: SAMPLE_COUNTS.length, waiting: waiting.length, deposited: SAMPLE_COUNTS.length - waiting.length }, (v) =>
      hrefWith(path, sp, { view: v === "all" ? undefined : v }),
    ),
    summary: countsSummary(waiting.length, waiting.reduce((a, x) => a + x.totalCents, 0), fmt),
    note: !can.record ? "You can see the counts. Counting and recording deposits are for a counter with giving.record_offline." : null,
    body: { state: "ok", rows: shown.map((x) => countRow(x, { ...fmt, can, bankOn })), empty: "No counts here." },
  };
}

/** What Start a count opens with in the preview. */
export function sampleCountSheet(c: Community = LISTS_COMMUNITY) {
  return {
    counters: SAMPLE_COUNTERS,
    last: ["u-0000-sam", "u-0000-linh"],
    events: [{ id: cid(50), label: "Harvest supper · Oct 11, 2026" }],
    denominations: denominationsFor(c.currency) ? [...(denominationsFor(c.currency) ?? [])] : null,
    currency: c.currency,
    locale: c.locale,
    today: TODAY_DATE,
    countsWord: countsWord(c.kind),
    problem: null,
  };
}
