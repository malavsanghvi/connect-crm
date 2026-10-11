// Pieces the Platform commands share. Every Platform command is platformOnly (types.ts): it is never listed, offered to Niva or run
// for anyone who is not on the Weaver team, whatever roles or permissions they hold in a community. These commands read counts,
// community names and plain sentences; they name no member, no learner and no child (D2).

import { experienceLabel } from "@/lib/experiences";
import { loadExperiences } from "@/lib/experiences-db";
import { isUuid } from "@/lib/search-params";
import type { AppSupabase } from "@/lib/supabase/server";

import { CommandError } from "../../types";

import { must } from "../db";

export type CommunityRef = { id: string; slug: string; name: string };

/**
 * The community a person means by its address (slug), its name or its id. An exact address or name wins; otherwise a name or address
 * that contains the words; when several match, the question comes back to the person with each one's address, never a guess.
 */
export async function findCommunity(db: AppSupabase, asked: string): Promise<CommunityRef> {
  const list = (must(await db.from("centers").select("id, slug, name").order("name"), "read the communities") ?? []).map((c) => ({ id: String(c.id), slug: String(c.slug), name: String(c.name) }));
  const q = asked.trim().toLowerCase();
  const byId = isUuid(q) ? list.filter((c) => c.id === q) : [];
  const exact = byId.length > 0 ? byId : list.filter((c) => c.slug.toLowerCase() === q || c.name.toLowerCase() === q);
  const found = exact.length > 0 ? exact : list.filter((c) => c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q));
  if (found.length === 1) return found[0];
  if (found.length === 0) throw new CommandError(`There is no community called "${asked}". Use its address (like jsh), its name or its id.`);
  throw new CommandError(`More than one community matches "${asked}": ${found.map((c) => `${c.name} (${c.slug})`).join(", ")}. Which one?`);
}

/** The kind of organization in words, falling back to its key when the list of kinds cannot be read. */
export async function kindLabel(db: AppSupabase, key: string): Promise<string> {
  try {
    const loaded = await loadExperiences(db);
    return loaded.status === "ok" ? experienceLabel(loaded.experiences, key) : key;
  } catch (error) {
    console.error("[platform] could not read the kinds of organization:", error);
    return key;
  }
}
