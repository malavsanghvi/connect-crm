import { redirect } from "next/navigation";

import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

/** Communications opens on the first tab the user can use. */
export default async function CommsIndex() {
  const session = await getSession();
  redirect(canAccess(session, "comms") || !canAccess(session, "commsInbox") ? "/comms/newsletters" : "/comms/inbox");
}
