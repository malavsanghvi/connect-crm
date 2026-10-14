import "server-only";

import { can, type ScopedContext } from "@/lib/permissions";
import type { AppSupabase } from "@/lib/supabase/server";

// Keeping a class's Teacher role in step with its teacher rows. It lives here so the Server Actions on the Classes screen and the
// command learning.assign_teacher (the ⌘K palette and Niva) use the very same code.

/**
 * A pathshala_teachers row alone does not give the teacher access: RLS checks
 * role_grants (teacher, scope = class). Keep them in step when we are allowed to
 * (roles.manage); otherwise say plainly what the center admin must do.
 */
export async function syncTeacherGrant(
  supabase: AppSupabase,
  access: ScopedContext,
  centerId: string,
  classId: string,
  personId: string,
  mode: "grant" | "revoke",
  actorUserId: string,
): Promise<string | null> {
  const adminHint =
    mode === "grant"
      ? "Their access to this class must be granted by a center admin in Settings → Roles and access (role: Teacher, scoped to this class)."
      : "Ask a center admin to end their Teacher role for this class.";
  if (!can(access, "roles.manage")) return adminHint;
  const { data: cu, error: cuError } = await supabase
    .from("center_users")
    .select("user_id")
    .eq("center_id", centerId)
    .eq("person_id", personId)
    .maybeSingle();
  if (cuError) {
    console.error("[pathshala] teacher login lookup failed", cuError);
    return "We couldn't look up their login, so their class access was not changed. " + adminHint;
  }
  if (!cu) return "They haven't signed in yet, so their class access will need to be granted after they do.";
  if (mode === "grant") {
    const { data: existing, error: exError } = await supabase
      .from("role_grants")
      .select("id, ends_at")
      .eq("center_id", centerId)
      .eq("user_id", cu.user_id)
      .eq("role_key", "teacher")
      .eq("scope_id", classId);
    if (exError) {
      console.error("[pathshala] teacher grant lookup failed", exError);
      return "Their class access could not be checked. " + adminHint;
    }
    if ((existing ?? []).some((g) => !g.ends_at || g.ends_at > new Date().toISOString())) return "They already had teacher access to this class.";
    const { error } = await supabase.from("role_grants").insert({
      center_id: centerId,
      user_id: cu.user_id,
      role_key: "teacher",
      scope_kind: "class",
      scope_id: classId,
      granted_by: actorUserId,
      reason: "Assigned as Pathshala teacher",
    });
    if (error) {
      console.error("[pathshala] granting teacher role failed", error);
      return "Their class access could not be granted automatically. " + adminHint;
    }
    return "They can now open this class under Pathshala → My classes.";
  }
  const { error } = await supabase
    .from("role_grants")
    .update({ ends_at: new Date().toISOString() })
    .eq("center_id", centerId)
    .eq("user_id", cu.user_id)
    .eq("role_key", "teacher")
    .eq("scope_id", classId)
    .is("ends_at", null);
  if (error) {
    console.error("[pathshala] ending teacher role failed", error);
    return "Their class access could not be ended automatically. " + adminHint;
  }
  return "Their teacher access to this class has ended.";
}
