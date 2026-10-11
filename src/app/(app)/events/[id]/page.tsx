import type { Metadata } from "next";
import { cookies } from "next/headers";

import { LOOK_COOKIE, parseLook } from "@/lib/look";
import type { RawSearchParams } from "@/lib/search-params";

import { ClassicEventPage } from "./classic-event-page";
import { EventWorkspacePage } from "./workspace-page";

export const metadata: Metadata = { title: "Event" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<RawSearchParams> };

/**
 * One event. The "New look" switch (a per-person cookie) shows the Events workspace drawn in the admin-v2 board, with Niva beside
 * the event; everyone else gets the classic event page, unchanged.
 */
export default async function EventPage({ params, searchParams }: Props) {
  if (parseLook((await cookies()).get(LOOK_COOKIE)?.value) === "v2") return <EventWorkspacePage params={params} searchParams={searchParams} />;
  return <ClassicEventPage params={params} searchParams={searchParams} />;
}
