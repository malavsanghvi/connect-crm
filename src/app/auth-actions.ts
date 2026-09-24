"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { failure, type ActionResult } from "@/lib/errors";
import { SETUP_LATER_COOKIE } from "@/lib/platform-setup/catalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signOutAction(): Promise<ActionResult> {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    return failure("Could not sign out", error);
  }
  const { error } = await supabase.auth.signOut();
  if (error) return failure("Could not sign out", error);
  // o-platform-setup: the next sign-in shows the platform setup wizard again while it is unfinished.
  (await cookies()).delete(SETUP_LATER_COOKIE);
  redirect("/login");
}
