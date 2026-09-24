"use server";

import { redirect } from "next/navigation";

import { failure, type ActionResult } from "@/lib/errors";
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
  redirect("/login");
}
