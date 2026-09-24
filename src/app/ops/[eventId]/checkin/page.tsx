import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LoadProblem } from "@/components/events/load-problem";
import { NoAccess } from "@/components/ui";
import { load, loadEventAccess, loadLiveStats, row } from "@/lib/data/events";
import { readPublicEnv } from "@/lib/env";
import { eventAreas } from "@/lib/events/access";
import { isUuid } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { CheckInScreen } from "./checkin-screen";

export const metadata: Metadata = { title: "Check-in" };

export default async function CheckInPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) notFound();
  const session = await getSession();
  const access = await loadEventAccess(session);
  if (!eventAreas.checkIn(access, eventId)) {
    return (
      <NoAccess
        area="The check-in screen for this event"
        access="eventsManage"
        extra="Check-in volunteers get access for one event from the event lead (event page › Volunteers › Give check-in access)."
      />
    );
  }
  const env = readPublicEnv();
  if (!env.ok) return <LoadProblem message="The app is not configured (Supabase settings are missing)" />;
  const res = await load(async () => {
    const event = row(await session.db.from("events").select("id, name, status, lunch_enabled").eq("id", eventId).maybeSingle(), "the event");
    if (!event) return null;
    return { event, stats: await loadLiveStats(session.db, eventId) };
  });
  if (!res.ok) return <LoadProblem message={res.error} retryHref={`/ops/${eventId}/checkin`} />;
  if (!res.data) notFound();
  const { event, stats } = res.data;
  return (
    <CheckInScreen
      eventId={event.id}
      eventStatus={event.status}
      initialCheckedIn={stats.checkedIn}
      expected={stats.confirmed}
      timeZone={session.center.time_zone}
      supabaseEnv={{ supabaseUrl: env.env.supabaseUrl, supabaseAnonKey: env.env.supabaseAnonKey }}
    />
  );
}
