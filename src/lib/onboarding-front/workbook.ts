// "Templates, step by step" (board 2a of docs/handoff/prototypes/onboarding-data/Templates.dc.html): the starter workbook
// explained as tabs in load order, each with its column guide (built from the import registry's own field definitions, the
// same ones Data import's templates are made from) and the checks Weaver's code runs on a filled tab, in plain words. Pure:
// the page decides who may see what; this turns the registry into words.
//
// Built for every organization: which tabs appear comes from the organization's kind (a module the kind never offers has no
// tab) and its switches (a module switched off is listed as "off, not included"); a choice the kind does not have (a
// tradition's kind of pledge, say) is left out of the allowed values.

import { entitiesInOrder, type EntityDef, type FieldDef, type Tier } from "@/lib/import/registry";
import { kindHas, kindModuleLabel, moduleNotOffered, type KindProfile } from "@/lib/kind";
import { moduleDef, type ModuleKey } from "@/lib/modules";

/** The tabs of the starter workbook: what nearly every organization loads, in the registry's load order. */
export const STARTER_TAB_KEYS: readonly string[] = [
  "zones",
  "funds",
  "membership_types",
  "campaigns",
  "households",
  "people",
  "memberships",
  "store_items",
  "pledges",
  "payments",
  "payment_allocations",
  "events",
];

/** Tabs an organization can leave empty and still load the rest. */
export const OPTIONAL_TAB_KEYS: ReadonlySet<string> = new Set(["zones", "campaigns", "store_items", "payment_allocations", "events"]);

export type Need = "Required" | "Optional" | "Choice";

export type GuideRow = { column: string; need: Need; example: string; rule: string };

export type WorkbookTab = {
  key: string;
  /** "A1", "B2" … */
  code: string;
  name: string;
  what: string;
  note: string | null;
  optional: boolean;
  /** Names of the tabs in this workbook that must be loaded first. */
  needs: string[];
  guide: GuideRow[];
  checks: string[];
  /** Data import's own templates for this tab (CSV, and Excel with a Columns sheet). */
  csvHref: string;
  xlsxHref: string;
  /** Data import with this tab picked; null when this person cannot load it. */
  loadHref: string | null;
};

export type WorkbookSection = { tier: Tier; letter: "A" | "B" | "C"; title: string; sub: string; tabs: WorkbookTab[] };

export type ModuleChip = { label: string; included: boolean };

export type WorkbookModel = { sections: WorkbookSection[]; chips: ModuleChip[]; tabCount: number; firstKey: string | null };

export type WorkbookInput = {
  kind: Pick<KindProfile, "modules" | "terms" | "usesTradition">;
  /** Modules this organization has switched off. */
  modulesOff: readonly string[];
  /** The kind's name for its people, lower case ("members & households"). */
  peopleWord: string;
  /** Whether this person may load a tab (UI convenience; the database checks again). */
  canLoad: (e: EntityDef) => boolean;
};

const SECTION: Record<Tier, { letter: "A" | "B" | "C"; title: (people: string) => string; sub: string }> = {
  setup: { letter: "A", title: () => "Your lists", sub: "The words the rest of the workbook uses, so load these first." },
  records: { letter: "B", title: (people) => `Your ${people}`, sub: "Households first, then the people in them, then what they belong to." },
  history: { letter: "C", title: () => "Your history", sub: "What happened before Weaver. Past payments are marked as history, so they are never sent to QuickBooks." },
};

/** A choice that belongs to a module or feature the kind does not have is not offered ("Boli", "Pathshala fee" …). */
export function optionOfferedTo(kind: Pick<KindProfile, "modules" | "usesTradition">, value: string): boolean {
  const v = value.toLowerCase();
  if (v.startsWith("boli")) return !moduleNotOffered(kind, "bolis");
  if (v.startsWith("pathshala")) return !moduleNotOffered(kind, "pathshala");
  if (v === "labh") return kindHas(kind, "labh");
  if (v === "pujan") return kindHas(kind, "tradition");
  if (v === "store") return !moduleNotOffered(kind, "store");
  if (v === "event") return !moduleNotOffered(kind, "events");
  if (v.startsWith("membership")) return !moduleNotOffered(kind, "membership");
  return true;
}

function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const ensureStop = (s: string) => (/[.!?)]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

export function guideRows(e: EntityDef, kind: WorkbookInput["kind"]): GuideRow[] {
  return e.fields.map((f) => {
    const allowed = (f.options ?? []).filter((o) => optionOfferedTo(kind, o.value)).map((o) => o.label);
    const need: Need = f.required ? "Required" : allowed.length > 0 ? "Choice" : "Optional";
    const rule = allowed.length > 0 ? `${ensureStop(f.description)} One of: ${allowed.join(", ")}.` : ensureStop(f.description);
    return { column: f.label, need, example: f.example, rule };
  });
}

const REF_WORD: Partial<Record<string, string>> = { pledge: "a pledge", payment: "a payment", event: "an event" };

function refCheck(f: FieldDef, tableName: (table: string) => string): string | null {
  const r = f.ref;
  if (!r) return null;
  switch (r.kind) {
    case "household":
      return `${f.label} must match a household in your Households tab or one already in Weaver. A household is never found by its name.`;
    case "person":
      return `${f.label} must match a person in your People tab or one already in Weaver. A person is never found by name alone.`;
    case "lookup":
      return `${f.label} must be one of your ${tableName(r.table)}, loaded before this tab.`;
    default:
      return `${f.label} must match ${REF_WORD[r.kind] ?? "a record"} loaded before this tab.`;
  }
}

/** The checks Weaver's code runs on every row of a filled tab, in plain words (Data import's own rules: mapping.ts buildRow). */
export function checksFor(e: EntityDef, tableName: (table: string) => string = (t) => t.replace(/_/g, " ")): string[] {
  const out: string[] = [];
  const required = e.fields.filter((f) => f.required).map((f) => f.label);
  if (required.length > 0) {
    out.push(`${listWords(required)} ${required.length === 1 ? "must be" : "must all be"} filled in. A row without ${required.length === 1 ? "it" : "them"} is listed with its row number, and not loaded.`);
  }
  for (const f of e.fields) {
    const c = refCheck(f, tableName);
    if (c) out.push(c);
  }
  const dates = e.fields.filter((f) => f.type === "date" || f.type === "datetime").map((f) => f.label);
  if (dates.length > 0) out.push(`Dates (${listWords(dates)}) are read the one way you choose for the whole file: day first or month first.`);
  const money = e.fields.filter((f) => f.type === "money").map((f) => f.label);
  if (money.length > 0) {
    out.push(
      e.moneyFields && e.moneyFields.length > 0
        ? `Amounts (${listWords(money)}) are kept in whole cents, and the total is compared with your file to the cent.`
        : `Amounts (${listWords(money)}) are kept in whole cents.`,
    );
  }
  const choices = e.fields.filter((f) => f.type === "enum").map((f) => f.label);
  if (choices.length > 0) out.push(`${listWords(choices)} ${choices.length === 1 ? "takes" : "take"} one of the listed values. Anything else is listed for you to fix; Weaver never guesses.`);
  if (e.fields.some((f) => f.type === "id")) out.push("Identifiers are kept exactly as written, as text, so leading zeros stay.");
  const contact = e.fields.filter((f) => (f.type === "email" || f.type === "phone") && !f.required).map((f) => f.label);
  if (contact.length > 0) out.push(`${listWords(contact)}: a value that is not one is left out with a warning. It never stops the row.`);
  if (e.key === "people") out.push("A birth date in the future stops the row. A child with no birth date is listed, so the rules for minors still apply.");
  const keys = e.sourceKey.map((k) => e.fields.find((f) => f.key === k)?.label).filter((x): x is string => Boolean(x));
  if (keys.length > 0) out.push(`Loading this tab again updates rows by ${listWords(keys)} instead of adding them twice.`);
  if (e.note) out.push(ensureStop(e.note));
  return out;
}

const encode = (k: string) => encodeURIComponent(k);

export function buildWorkbook(input: WorkbookInput, keys: readonly string[] = STARTER_TAB_KEYS): WorkbookModel {
  const { kind } = input;
  const offered = entitiesInOrder().filter((e) => keys.includes(e.key) && !(e.module && moduleNotOffered(kind, e.module)));
  const isOn = (e: EntityDef) => !e.module || !input.modulesOff.includes(e.module);
  const included = offered.filter(isOn);
  const byTable = new Map(entitiesInOrder().map((e) => [e.table, e.label]));
  const tableName = (t: string) => (byTable.get(t) ?? t.replace(/_/g, " ")).toLowerCase();
  const names = new Map(included.map((e) => [e.key, e.label]));

  const sections: WorkbookSection[] = [];
  for (const tier of ["setup", "records", "history"] as const) {
    const list = included.filter((e) => e.tier === tier);
    if (list.length === 0) continue;
    const s = SECTION[tier];
    sections.push({
      tier,
      letter: s.letter,
      title: `${s.letter}. ${s.title(input.peopleWord)}`,
      sub: s.sub,
      tabs: list.map((e, i) => ({
        key: e.key,
        code: `${s.letter}${i + 1}`,
        name: e.label,
        what: e.description,
        note: e.key === "payments" ? null : (e.note ?? null),
        optional: OPTIONAL_TAB_KEYS.has(e.key),
        needs: e.dependsOn.filter((d) => names.has(d)).map((d) => names.get(d)!),
        guide: guideRows(e, kind),
        checks: checksFor(e, tableName),
        csvHref: `/settings/import/template/${encode(e.key)}?format=csv`,
        xlsxHref: `/settings/import/template/${encode(e.key)}?format=xlsx`,
        loadHref: input.canLoad(e) ? `/settings/import/new?entity=${encode(e.key)}` : null,
      })),
    });
  }

  // One chip per module the tabs belong to, in the kind's words; a module switched off says so.
  const chips: ModuleChip[] = [];
  const seen = new Set<string>();
  for (const e of offered) {
    const m = (e.module ?? "people") as ModuleKey;
    if (seen.has(m)) continue;
    seen.add(m);
    const label = kindModuleLabel(kind, m, moduleDef(m)?.label ?? m);
    chips.push(isOn(e) ? { label, included: true } : { label: `${label}: off, not included`, included: false });
  }

  return { sections, chips, tabCount: included.length, firstKey: included.find((e) => e.key === "people")?.key ?? included[0]?.key ?? null };
}
