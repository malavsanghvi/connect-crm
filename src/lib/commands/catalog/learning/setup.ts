// What the Learning commands read to describe a term's setup: the terms, their rules, the levels, the fees and the classes. All of it is
// set-up data (terms, levels, fees, classes); nothing here reads a learner: no enrollment, registration, attendance, homework or
// progress table is touched (tests/commands/learning-d2.test.ts keeps it that way).

import type { Tables } from "@/lib/database.types";
import { isModuleEnabled } from "@/lib/modules";
import { formatDate } from "@/lib/pathshala/format";
import {
  loadLevelFees,
  loadLevelRows,
  loadPayNowReady,
  loadTermRules,
  NEEDS_UPDATE,
  type Loaded,
} from "@/lib/pathshala-registration/db";
import type { LevelFee, LevelRow, TermRules } from "@/lib/pathshala-registration/contract";
import { buildFeeGroups, type FeeGroup, type TrackLite } from "@/lib/pathshala-registration/fees";
import { feeLabel, formatMoney } from "@/lib/pathshala-registration/money";
import { payNowBlockedReason } from "@/lib/pathshala-registration/rules";
import { schoolOrGeneric } from "@/lib/kind-samples";

import { must } from "../db";
import { CommandDbError, CommandError, type CommandContext } from "../../types";

export type Term = Tables<"pathshala_terms">;
export type ClassRow = Tables<"pathshala_classes">;

export const NO_TERM = "That term was not found, or you can't see it.";

/** The kind the words are chosen from: the session's, or (a test's fake session) one that says nothing about itself. */
const PLAIN_KIND = { terms: {}, modules: {}, usesTradition: false } as const;

/** What the community calls its school ("Pathshala", "Religious school", or plainly "school"): the word a person reads while a command runs. */
export function school(ctx: Pick<CommandContext, "session">): string {
  return schoolOrGeneric(ctx.session.kind ?? PLAIN_KIND);
}
export const NO_ACCESS_HERE = "You don't have access to this area.";

/** "$130.00", with the community's currency. */
export function money(ctx: CommandContext, cents: number): string {
  return formatMoney(cents, ctx.session.center.currency);
}

/** "Free", "$130.00" or "Not set". */
export function fee(ctx: CommandContext, cents: number | null | undefined): string {
  return feeLabel(cents, ctx.session.center.currency);
}

/** A date for a sentence: "Sun, Sep 6, 2026". */
export function day(ctx: CommandContext, iso: string | null | undefined): string {
  return formatDate(iso, ctx.session.center.time_zone);
}

/** The result of one of the registration loaders (0590) as its value, or the sentence the screens give. */
export function loadedValue<T>(loaded: Loaded<T>, what: string): T {
  if (loaded.status === "ok") return loaded.value;
  if (loaded.status === "missing") throw new CommandError(NEEDS_UPDATE);
  if (loaded.status === "error") throw new CommandDbError(loaded.error, `read ${what}`);
  throw new CommandError(`Could not read ${what} — the database answered with something unexpected (${loaded.message}). Has the latest migration been applied?`);
}

export type SetupWorld = {
  givingOn: boolean;
  /** The terms asked about (one, or every term that is not closed). */
  terms: Term[];
  /** Every term of the community, newest first (to suggest a fee from an earlier term). */
  allTerms: Term[];
  rules: Map<string, TermRules>;
  levels: LevelRow[];
  fees: LevelFee[];
  tracks: TrackLite[];
  /** The classes of the terms asked about. */
  classes: ClassRow[];
  /** Null when the funds could not be read. */
  funds: { id: string; key: string | null; name: string }[] | null;
  /** The sentence saying why "Pay when registering" cannot be used, or null when it can. */
  payNowBlocked: string | null;
};

type SetupOptions = { termId?: string; includeClosed?: boolean; readiness?: boolean };

/** Read the set-up data of one term (given), or of every term that is not closed. */
export async function loadSetup(ctx: CommandContext, opts: SetupOptions = {}): Promise<SetupWorld> {
  const { db, center } = ctx.session;
  const givingOn = isModuleEnabled(ctx.session, "giving");
  const allTerms = (must(await db.from("pathshala_terms").select("*").eq("center_id", center.id).order("starts_on", { ascending: false }), "read the terms") ?? []) as Term[];
  let terms: Term[];
  if (opts.termId) {
    const one = allTerms.find((t) => t.id === opts.termId);
    if (!one) throw new CommandError(NO_TERM);
    terms = [one];
  } else {
    terms = opts.includeClosed ? allTerms : allTerms.filter((t) => t.status !== "closed");
  }
  const ids = terms.map((t) => t.id);

  const [rules, levels, fees, tracks, classes, funds, ready] = await Promise.all([
    loadTermRules(db, ids),
    loadLevelRows(db, center.id),
    loadLevelFees(db, center.id),
    db.from("pathshala_tracks").select("id, key, name").eq("center_id", center.id),
    ids.length ? db.from("pathshala_classes").select("*").eq("center_id", center.id).in("term_id", ids).order("name") : Promise.resolve({ data: [] as ClassRow[], error: null }),
    givingOn ? db.from("funds").select("id, key, name").eq("center_id", center.id).eq("active", true).order("name") : Promise.resolve({ data: [] as { id: string; key: string | null; name: string }[], error: null }),
    opts.readiness ? loadPayNowReady(db, center.id) : Promise.resolve(null),
  ]);
  if (tracks.error) throw new CommandDbError(tracks.error, "read the tracks");
  if (classes.error) throw new CommandDbError(classes.error, "read the classes");
  if (funds.error) console.error("[learning] could not read the funds; the fund line says so:", funds.error);

  let payNowBlocked: string | null = null;
  if (ready) {
    payNowBlocked = payNowBlockedReason({
      givingOn,
      ready:
        ready.status === "ok"
          ? { status: "ok", sentence: ready.value }
          : ready.status === "missing"
            ? { status: "missing" }
            : { status: "error", reason: ready.status === "shape" ? `the answer could not be read (${ready.message})` : "the database could not say" },
    });
  }

  return {
    givingOn,
    terms,
    allTerms,
    rules: loadedValue(rules, "the terms' rules"),
    levels: loadedValue(levels, "the levels"),
    fees: loadedValue(fees, "the fees"),
    tracks: (tracks.data ?? []) as TrackLite[],
    classes: (classes.data ?? []) as ClassRow[],
    funds: funds.error ? null : ((funds.data ?? []) as { id: string; key: string | null; name: string }[]),
    payNowBlocked,
  };
}

/** The levels of a term with their fees, grouped by track, as the Fees screen builds them. */
export function groupsFor(world: SetupWorld, term: Term): FeeGroup[] {
  return buildFeeGroups({
    term,
    terms: world.allTerms,
    tracks: world.tracks,
    levels: world.levels,
    classes: world.classes.filter((c) => c.term_id === term.id),
    fees: world.fees,
    seats: null,
  });
}

/** The rules of one term; a term whose rules could not be found is an error to show, never a guess. */
export function rulesOf(world: SetupWorld, term: Term): TermRules {
  const r = world.rules.get(term.id);
  if (!r) throw new CommandError(`The rules of ${term.name} could not be found. Reload and try again.`);
  return r;
}

/** The term as people name it in a sentence: its name and its dates. */
export function termTitle(ctx: CommandContext, term: Pick<Term, "name" | "starts_on" | "ends_on">): string {
  return `${term.name} (${day(ctx, term.starts_on)} to ${day(ctx, term.ends_on)})`;
}
