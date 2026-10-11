"use server";

import { cookies } from "next/headers";

import { failure, type ActionResult } from "@/lib/errors";
import { LOOK_COOKIE, type Look } from "@/lib/look";

/**
 * Remember which look of the portal this person wants ("New look" or "Classic look"). The choice is a cookie on this browser
 * (not a setting of the community and not a permission), so it changes nothing for anyone else. Next.js sends the refreshed page
 * back with the answer, so the whole portal repaints in the chosen look.
 */
export async function setLookAction(look: Look): Promise<ActionResult<{ look: Look }>> {
  if (look !== "classic" && look !== "v2") {
    return { ok: false, error: "Could not change the look — that choice is not available. Reload the page and try again." };
  }
  try {
    // Loaded here, not at the top, so that rendering the shell (which imports this action for its button) never needs the
    // server-only request helpers.
    const { currentOrigin } = await import("@/lib/center-resolve");
    const origin = await currentOrigin();
    (await cookies()).set(LOOK_COOKIE, look, {
      path: "/",
      sameSite: "lax",
      secure: origin.protocol.startsWith("https"),
      maxAge: 60 * 60 * 24 * 365,
    });
    return { ok: true, data: { look } };
  } catch (error) {
    return failure("Could not change the look", error);
  }
}
