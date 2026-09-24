import "server-only";

import { cookies } from "next/headers";

import { normalizeSandboxCode } from "@/lib/platform-onboarding";

/** The sandbox code being redeemed, kept between the /start steps in an http-only cookie. */
export const START_COOKIE = "cc_start_code";

export async function readStartCode(): Promise<string | null> {
  try {
    return normalizeSandboxCode((await cookies()).get(START_COOKIE)?.value ?? null);
  } catch (error) {
    console.error("[start] could not read the code cookie:", error);
    return null;
  }
}
