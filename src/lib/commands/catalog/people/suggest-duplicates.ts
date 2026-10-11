import { isAdultMember } from "../../child-filter";
import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, type HouseholdCard } from "../../types";

import { cardsFor, fullName, today } from "./shared";

const LIMIT = 20;

const input = object({ kind: f.withDefault(f.enum("Which suggestions: person, household, or any.", ["any", "person", "household"]), "any") });

type PersonSide = { id: string; name: string; member_number: string | null; signs_in: boolean; details_on_file: number };

export type DuplicateSuggestion = {
  candidate_id: string;
  kind: "person" | "household";
  score: number | null;
  /** People: the two records, with whether each signs in to the app and how many profile details it has. */
  first?: PersonSide;
  second?: PersonSide;
  households: HouseholdCard[];
  /** People only: the record that would be kept (the one that signs in; else the one with more details). The person decides. */
  suggested_keep_id?: string;
  next_step: string;
};

export type SuggestDuplicatesData = { count: number; suggestions: DuplicateSuggestion[]; for_the_screen: number };

type Row = { id: string; first_name: string; last_name: string; preferred_name: string | null; date_of_birth: string | null; member_number: string | null; email: string | null; phone_e164: string | null; gender: string | null; profession: string | null; employer: string | null };

export const suggestDuplicates = defineCommand<Infer<typeof input>, SuggestDuplicatesData>({
  key: "people.suggest_duplicates",
  title: "Suggest duplicate people and households",
  description:
    "Show the pairs the system thinks may be duplicates (open suggestions), so a person can compare them. This only prepares: nothing is merged or dismissed. " +
    "For two people it shows each record's member number, whether it signs in to the app and how many details it has, and the households they are in (cards). " +
    "To act, use people.merge_people or people.merge_households (the person confirms a card showing both records), or people.dismiss_duplicate if they are not the same. " +
    "Pairs that involve a child are only counted; they are compared on the People screen.",
  level: "draft",
  permission: "households",
  module: "people",
  input,
  async execute(ctx, inp) {
    const { db, center } = ctx.session;
    let q = db.from("merge_candidates").select("id, kind, left_id, right_id, score").eq("center_id", center.id).eq("status", "open").order("created_at").limit(LIMIT);
    if (inp.kind !== "any") q = q.eq("kind", inp.kind);
    const cand = await q;
    if (cand.error) throw new CommandDbError(cand.error, "read the suggested duplicates");
    const rows = cand.data ?? [];
    const personIds = [...new Set(rows.filter((c) => c.kind === "person").flatMap((c) => [c.left_id, c.right_id]))];

    const people = new Map<string, Row>();
    const logins = new Set<string>();
    const links = new Map<string, string[]>();
    if (personIds.length) {
      const [p, cu, hm] = await Promise.all([
        db.from("people").select("id, first_name, last_name, preferred_name, date_of_birth, member_number, email, phone_e164, gender, profession, employer").in("id", personIds),
        db.from("center_users").select("person_id").eq("center_id", center.id).in("person_id", personIds),
        db.from("household_members").select("person_id, household_id, role").in("person_id", personIds).is("left_at", null),
      ]);
      const failed = p.error ?? cu.error ?? hm.error;
      if (failed) throw new CommandDbError(failed, "read the suggested duplicates");
      for (const r of (p.data ?? []) as Row[]) people.set(r.id, r);
      for (const r of cu.data ?? []) if (r.person_id) logins.add(r.person_id);
      const roleOf = new Map<string, string[]>();
      for (const r of hm.data ?? []) {
        links.set(r.person_id, [...(links.get(r.person_id) ?? []), r.household_id]);
        roleOf.set(r.person_id, [...(roleOf.get(r.person_id) ?? []), r.role]);
      }
      // A person is an adult by birth date; with none on file, by being a head, spouse or parent everywhere they are listed.
      for (const id of personIds) {
        const r = people.get(id);
        const roles = roleOf.get(id) ?? [];
        const adult = r ? (r.date_of_birth ? isAdultMember({ date_of_birth: r.date_of_birth }, today(ctx)) : roles.length > 0 && roles.every((x) => isAdultMember({ date_of_birth: null, role: x }, today(ctx)))) : false;
        if (!adult) people.delete(id);
      }
    }

    const suggestions: DuplicateSuggestion[] = [];
    let forScreen = 0;
    const side = (id: string): PersonSide | null => {
      const r = people.get(id);
      if (!r) return null;
      const filled = [r.email, r.phone_e164, r.date_of_birth, r.gender, r.profession, r.employer].filter((v) => v && String(v).trim()).length;
      return { id, name: fullName(r), member_number: r.member_number, signs_in: logins.has(id), details_on_file: filled };
    };

    for (const c of rows) {
      if (c.kind === "household") {
        const households = await cardsFor(ctx, [c.left_id, c.right_id]);
        suggestions.push({ candidate_id: c.id, kind: "household", score: c.score, households, next_step: "Compare the two cards. Keep the household with the community household ID, the membership and the giving history. Then use people.merge_households." });
        continue;
      }
      const a = side(c.left_id);
      const b = side(c.right_id);
      if (!a || !b) {
        forScreen += 1;
        continue;
      }
      const households = await cardsFor(ctx, [...(links.get(a.id) ?? []), ...(links.get(b.id) ?? [])]);
      const keep = a.signs_in !== b.signs_in ? (a.signs_in ? a : b) : b.details_on_file > a.details_on_file ? b : a;
      suggestions.push({
        candidate_id: c.id,
        kind: "person",
        score: c.score,
        first: a,
        second: b,
        households,
        suggested_keep_id: keep.id,
        next_step: a.signs_in && b.signs_in ? "Both records sign in to the app, so they cannot be merged here. Ask the platform team." : "Show both records and their households to the person. If they are the same person, use people.merge_people.",
      });
    }
    return { ok: true, data: { count: suggestions.length, suggestions, for_the_screen: forScreen }, message: suggestions.length === 0 && forScreen === 0 ? "There are no suggested duplicates." : undefined };
  },
});
