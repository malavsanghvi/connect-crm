import { PersonEventsBody } from "@/components/people-v2/events/person-events";
import { canAccess } from "@/lib/permissions";
import { eventAddSetup } from "@/lib/people-v2/event-add-setup";
import type { FamilyModel } from "@/lib/people-v2/family-model";
import { loadPersonEvents } from "@/lib/people-v2/person-events-load";
import { NO_ACCESS_TEXT } from "@/lib/people-v2/slideover";
import type { CrmSession } from "@/lib/session";

/**
 * The Events section of the person slide-over (only drawn with the Events module): this person's own tickets, read with the viewer's own
 * database access, and the control to add them to an event. A role that cannot read events is told so in words; a read that failed says
 * so (the control is still there). `model` is the Family page's own, or null on the page of a person who is in no family.
 */
export async function PersonEventsServer({ session, person, model }: { session: CrmSession; person: { id: string; firstName: string }; model: FamilyModel | null }) {
  if (!canAccess(session, "events")) return <p className="m-0 py-1 text-[14px] text-muted">{NO_ACCESS_TEXT}</p>;
  const [list, add] = await Promise.all([loadPersonEvents(session, person.id), eventAddSetup(session, model, person.id)]);
  return <PersonEventsBody firstName={person.firstName} list={list} timeZone={session.center.time_zone} add={add} />;
}
