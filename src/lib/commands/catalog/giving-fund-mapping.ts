import { QBO_PURPOSES } from "@/lib/labels";

import { defineCommand } from "../define";
import { object, type Infer } from "../schema";

import { rpcJson } from "./db";
import { asObj, bool, int, rows, str } from "./giving-json";

export type FundMappingData = {
  /** Every required purpose has an account and the treasurer approved the mapping. */
  ready: boolean;
  required: number;
  mapped: number;
  approved: number;
  missing: { purpose: string; label: string }[];
  mappings: { purpose: string; label: string; account: string | null; approved: boolean }[];
  funds: number;
  funds_without_class: { name: string; restricted: boolean }[];
  next_step: string;
  where_to_fix: string;
};

const input = object({});

const labelOf = (purpose: string): string => QBO_PURPOSES.find((p) => p.purpose === purpose)?.label ?? purpose.replace(/[._]/g, " ");

export const fundMappingStatus = defineCommand<Infer<typeof input>, FundMappingData>({
  key: "giving.fund_mapping_status",
  title: "Show how funds map to QuickBooks accounts",
  description:
    "Where the QuickBooks mapping stands: which kinds of income and clearing accounts still need a QuickBooks account chosen, which choices a treasurer has approved, " +
    "and which funds have no QuickBooks class. Says in one sentence what to do next. Read only: it never chooses an account or approves the mapping. That is done on Accounting > QuickBooks > Setup.",
  level: "read",
  permission: "qboLedger",
  module: "accounting",
  input,
  async execute(ctx) {
    const { db, center } = ctx.session;
    const j = asObj(await rpcJson(db, "giving_fund_mapping_status", { p_center: center.id }, "read the QuickBooks mapping"));
    const required = Array.isArray(j.required_purposes) ? j.required_purposes.length : 0;
    const missing = (Array.isArray(j.missing_purposes) ? (j.missing_purposes as unknown[]) : []).flatMap((p) => (typeof p === "string" ? [{ purpose: p, label: labelOf(p) }] : []));
    const mappings = rows(j.mappings).map((m) => ({
      purpose: str(m.purpose) ?? "",
      label: labelOf(str(m.purpose) ?? ""),
      account: str(m.account),
      approved: bool(m.approved),
    }));
    const mapped = int(j.mapped_count);
    const approved = int(j.approved_count);
    const withoutClass = rows(j.funds_without_class).map((n) => ({ name: str(n.name) ?? "", restricted: bool(n.restricted) }));
    const ready = missing.length === 0 && mapped > 0 && approved >= mapped;
    const next =
      missing.length > 0
        ? `Choose a QuickBooks account for ${missing.map((m) => m.label).join(", ")}.`
        : mapped === 0
          ? "Nothing is mapped yet: choose a QuickBooks account for each kind of income."
          : approved < mapped
            ? "Every account is chosen. A treasurer still needs to approve the mapping."
            : withoutClass.length > 0
              ? `The mapping is approved. ${withoutClass.length} fund${withoutClass.length === 1 ? " has" : "s have"} no QuickBooks class, which is optional.`
              : "The mapping is complete and approved.";
    return {
      ok: true,
      data: {
        ready,
        required,
        mapped,
        approved,
        missing,
        mappings,
        funds: int(j.funds_count),
        funds_without_class: withoutClass,
        next_step: next,
        where_to_fix: "/accounting/qbo/setup",
      },
      message: ready ? "The QuickBooks mapping is complete and approved." : undefined,
    };
  },
});
