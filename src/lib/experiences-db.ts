// Loads the catalog of kinds of organization ("experiences") for the Platform screens.
//
// app.list_experiences() is added by the experiences migrations (0600–0605) and returns
// (key, label, description, family_key, family_label, faith_based, active, sort). Until the generated
// database types carry it, this file is the portal's typed view of it, and it falls back to the four
// categories of migration 0594 (app.organization_categories) when the function is not in the database yet,
// so the pickers work before and after the experiences migrations are applied. Delete the hand-written
// types once database.types.ts has the function.

import type { SupabaseClient } from "@supabase/supabase-js";

import { toExperiences, type Experience, type ExperienceRow } from "@/lib/experiences";
import { isMissingObject, warnMissingOnce } from "@/lib/modules-db";
import type { AppSupabase } from "@/lib/supabase/server";

type ExperiencesDatabase = {
  app: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      list_experiences: { Args: Record<string, never>; Returns: ExperienceRow[] };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type LoadedExperiences = { status: "ok"; experiences: Experience[]; source: "experiences" | "categories" } | { status: "error"; error: unknown };

/**
 * The kinds of organization: app.list_experiences(), else the four 0594 category rows.
 * `uses_tradition` is read from the category table when it is there (the experiences function does not
 * return it yet), so the legacy wizard knows whether to ask for a tradition.
 */
export async function loadExperiences(db: AppSupabase): Promise<LoadedExperiences> {
  try {
    const listed = await (db as unknown as SupabaseClient<ExperiencesDatabase, "app">).rpc("list_experiences");
    if (!listed.error) {
      const experiences = toExperiences(Array.isArray(listed.data) ? listed.data : []);
      return { status: "ok", experiences: await withTradition(db, experiences), source: "experiences" };
    }
    if (!isMissingObject(listed.error)) {
      console.error("[experiences] could not load app.list_experiences:", listed.error);
      return { status: "error", error: listed.error };
    }
    warnMissingOnce("app.list_experiences", listed.error);
    // Not in the database yet: the four categories of 0594 are the kinds of organization.
    const cats = await db.from("organization_categories").select("key, label, description, faith_based, uses_tradition, active, sort");
    if (cats.error) {
      console.error("[experiences] could not load the organization categories:", cats.error);
      return { status: "error", error: cats.error };
    }
    return {
      status: "ok",
      source: "categories",
      experiences: toExperiences(
        (cats.data ?? []).map((c) => ({
          key: c.key,
          label: c.label,
          description: c.description,
          family_key: null,
          family_label: null,
          faith_based: c.faith_based,
          active: c.active,
          sort: c.sort,
          uses_tradition: c.uses_tradition,
        })),
      ),
    };
  } catch (e) {
    console.error("[experiences] loading the kinds of organization threw:", e);
    return { status: "error", error: e };
  }
}

/** Best effort: adds `usesTradition` from the category table to kinds that do not carry it. Never fails the load. */
async function withTradition(db: AppSupabase, list: Experience[]): Promise<Experience[]> {
  if (list.every((e) => e.usesTradition !== null)) return list;
  try {
    const res = await db.from("organization_categories").select("key, uses_tradition");
    if (res.error || !res.data) return list;
    const by = new Map(res.data.map((r) => [r.key, r.uses_tradition]));
    return list.map((e) => (e.usesTradition === null && by.has(e.key) ? { ...e, usesTradition: by.get(e.key) ?? null } : e));
  } catch {
    return list;
  }
}
