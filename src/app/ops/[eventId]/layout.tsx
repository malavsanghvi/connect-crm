import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { CenteredPanel, SetupScreen } from "@/components/setup-screen";
import { ToastProvider } from "@/components/toast";
import { isUuid } from "@/lib/search-params";
import { loadSession } from "@/lib/session";

export const metadata: Metadata = { title: "Volunteer mode" };

// Phone-first "volunteer mode": no portal chrome, big targets, a dark header.
export default async function OpsLayout({ children, params }: { children: ReactNode; params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const state = await loadSession();
  if (state.status === "env_missing") return <SetupScreen problems={state.problems} />;
  if (state.status === "signed_out") redirect(`/login?next=/ops/${eventId}/checkin`);
  if (state.status !== "ok") {
    return (
      <CenteredPanel title="Volunteer mode could not start">
        <p role="alert" className="text-danger">
          {state.status === "center_missing" ? `No center with the slug "${state.slug}" exists.` : `${state.message}.`}
        </p>
      </CenteredPanel>
    );
  }
  let eventName = "Event";
  if (isUuid(eventId)) {
    const { data, error } = await state.session.db.from("events").select("name").eq("id", eventId).maybeSingle();
    if (error) console.error("[ops] event name unavailable; showing a generic title:", error);
    if (data?.name) eventName = data.name;
  }
  return (
    <ToastProvider>
      <div className="min-h-screen bg-frame">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-navy px-4 py-2 text-white">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-gold">Volunteer mode · {state.session.center.short_name || state.session.center.name}</p>
            <p className="truncate font-display text-lg font-semibold">{eventName}</p>
          </div>
          <Link href={isUuid(eventId) ? `/events/live?event=${eventId}` : "/"} className="inline-flex min-h-11 items-center rounded-full border border-white/40 px-4 text-sm font-bold text-white">
            Exit
          </Link>
        </header>
        <main className="mx-auto w-full max-w-xl px-4 py-4">{children}</main>
      </div>
    </ToastProvider>
  );
}
