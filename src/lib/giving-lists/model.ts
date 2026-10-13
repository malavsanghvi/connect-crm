// The page models of Giving's Pledges and Payments tabs (New look). Pure: the loader (src/lib/data/giving-lists.ts), the dev
// preview fixtures and the tests build them; the views draw them.

import type { CardLabels } from "@/components/household-card";
import type { GivingTab } from "@/lib/giving-today/tabs";
import { kindModuleLabel, moduleNotOffered, notOfferedExplanation, notPartOfKindSentence, type KindProfile } from "@/lib/kind";
import { moduleDef, moduleOffMessage, type ModuleKey } from "@/lib/modules";
import type { GivingExportList } from "@/lib/giving-export/csv";
import { canAccess, type AccessKey, type PermissionContext } from "@/lib/permissions";

import type { PaymentViewKey } from "./payments";
import type { Chip, ListRow } from "./types";

export const PAGE_SIZE = 50;

export type Pager = { page: number; total: number; prev: string | null; next: string | null; label: string };

/**
 * What the list area shows: rows, an error with a retry, "You don't have access to this area" (never an empty table), or the
 * switched-off sentence of an add-on that is off (never an empty page).
 */
export type ListBody =
  | { state: "ok"; rows: ListRow[]; empty: string }
  | { state: "error"; error: string; retry: string }
  | { state: "no_access"; area: string; access: AccessKey }
  | { state: "off"; title: string; message: string };

export type ListsCommon = {
  title: string;
  tabs: GivingTab[];
  currency: string;
  locale: string;
  timeZone: string;
  today: string;
  labels: CardLabels;
  /** The search as typed (the address keeps it as ?q=). */
  q: string;
  searchLabel: string;
  /** The address without ?q= and ?page=: the search keeps the chips that are chosen. */
  searchBase: string;
  body: ListBody;
  pager: Pager | null;
  /** The search found exactly one row: its actions are shown open, no menu to go through. */
  expandSingle: boolean;
  /** Parts that could not be read (the rest of the page still works). */
  problems: string[];
  /** Who sees what ("Limited view: …"). */
  note: string | null;
  /** Where Record payment goes until slice 2's sheet is wired in; null without the right. */
  recordHref: string | null;
  /** Export this list as it is filtered (slice 9); null where the list has no export (or it could not be read). */
  exportOffer?: ExportOffer | null;
};

/**
 * The Export button of a list. `ready`: the route to download from (the list's own filters), how many rows the list has now and the
 * list's word. `no_permission`: the person sees the list but may not export it (data.export), said in a line, never a dead button.
 */
export type ExportOffer =
  | {
      state: "ready";
      href: string;
      list: GivingExportList;
      count: number;
      /** "check, received in 2026", or "every payment". */
      filterText: string;
      /** The address asked for the sheet (?export=1, from the box's "export payments 2026"): it opens once the page is drawn. */
      open?: boolean;
    }
  | { state: "no_permission" };

export function exportOffer(
  ctx: PermissionContext,
  list: GivingExportList,
  href: string,
  count: number,
  filterText: string,
  open = false,
): ExportOffer {
  return canAccess(ctx, "givingExport") ? { state: "ready", href, list, count, filterText, open } : { state: "no_permission" };
}

/** The export route's address for a list: the list's own filters, without paging or the ?export=1 that opened the sheet. */
export function exportHref(list: GivingExportList, sp: Record<string, string | string[] | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s !== undefined && s !== "" && k !== "page" && k !== "export" && k !== "list") usp.set(k, s);
  }
  usp.set("list", list);
  return `/giving/export?${usp.toString()}`;
}

export type PledgesModel = ListsCommon & {
  chips: Chip[];
  buckets: Chip[];
  /** "$31,450.00 open across 131 pledges · $8,200.00 of it behind". */
  summary: string | null;
};

export type PaymentsModel = ListsCommon & {
  view: PaymentViewKey;
  views: Chip[];
  methods: Chip[];
  sources: Chip[];
  /** All payments: All years, this year and the two before it (?year=). */
  years: Chip[];
  /** The Recurring view's status chips. */
  statuses: Chip[];
  /** Flagged refunds, made in a card provider's dashboard, above the refund requests. */
  flagged: ListRow[];
};

export function pager(page: number, total: number, hrefFor: (page: number) => string): Pager | null {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE && page <= 1) return null;
  const from = Math.min(total, (page - 1) * PAGE_SIZE + 1);
  const to = Math.min(total, page * PAGE_SIZE);
  return {
    page,
    total,
    prev: page > 1 ? hrefFor(page - 1) : null,
    next: page < pages ? hrefFor(page + 1) : null,
    label: `${from.toLocaleString("en-US")} to ${to.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`,
  };
}

/** The sentence a switched-off add-on shows in place of its view, as ModuleGate words it. */
export function switchedOff(kind: KindProfile, module: ModuleKey, centerName: string): Extract<ListBody, { state: "off" }> {
  const label = kindModuleLabel(kind, module, moduleDef(module).label);
  if (moduleNotOffered(kind, module)) return { state: "off", title: notPartOfKindSentence(label, kind.label), message: notOfferedExplanation(centerName, kind.label) };
  return { state: "off", title: `${label} is switched off`, message: moduleOffMessage(module, centerName, label) };
}
