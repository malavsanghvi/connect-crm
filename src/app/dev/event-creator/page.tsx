import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { RailWorkspace } from "@/components/shell/workspace-rail";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { FIXTURE_KINDS, fixtureCtx, fixtureDraft, type FixtureKind } from "@/lib/event-creator/fixtures";
import { CARD_IDS, NO_EXISTING, type CardId, type CreatorExisting } from "@/lib/event-creator/types";
import { WORKSPACES } from "@/lib/workspaces";

import { PreviewShell } from "../admin-giving/preview-shell";
import { PreviewCreator } from "./preview-creator";

export const metadata: Metadata = { title: "Create an event · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function sampleRail(): RailWorkspace[] {
  return WORKSPACES.filter((w) => !["learning", "store", "platform"].includes(w.key)).map((w) => ({
    key: w.key,
    label: w.label,
    href: w.key === "events" ? "/dev/event-creator" : "/",
    icon: w.icon,
    placement: w.placement,
    paths: w.key === "events" ? ["/dev/event-creator"] : [`/__preview/${w.key}`],
    tabs: [],
  }));
}

/** Where each community's preview opens, unless ?step= or ?more=1 says otherwise. */
const OPEN_AT: Record<FixtureKind, CardId> = { temple: "what", church: "help", chamber: "money", club: "who" };

/** What already hangs off the temple's draft on the Review card (made-up shifts and checklist). */
const TEMPLE_EXISTING: CreatorExisting = {
  ...NO_EXISTING,
  shifts: [
    { id: "s1", station: "entry", notes: "Welcome desk", capacity: 4, starts_at: "2026-11-08T23:30:00Z", ends_at: "2026-11-09T02:30:00Z" },
    { id: "s2", station: "kitchen", notes: "Kitchen", capacity: 8, starts_at: "2026-11-08T21:00:00Z", ends_at: "2026-11-09T02:30:00Z" },
  ],
  checklist: [{ id: "a1", name: "Book the sound system", phase: "pre", due_on: "2026-10-30", state: "not_started" }],
};

/**
 * DEV ONLY. The guided event creator (New look) inside the shell with invented data, drawn without a database or a session.
 * `?kind=temple|church|chamber|club` picks the community; `?step=<card>` opens a card (what, where, who, money, help, words,
 * sending, more, review); `?more=1` opens More settings. Returns notFound() in production.
 */
export default async function EventCreatorPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const kindParam = one(sp.kind);
  const kind: FixtureKind = FIXTURE_KINDS.includes(kindParam as FixtureKind) ? (kindParam as FixtureKind) : "temple";
  const stepParam = one(sp.step);
  const step: CardId = one(sp.more) === "1" ? "more" : CARD_IDS.includes(stepParam as CardId) ? (stepParam as CardId) : OPEN_AT[kind];
  const ctx = fixtureCtx(kind);
  const draft = fixtureDraft(kind, { saved: step !== "what" });
  const existing = step === "review" && kind === "temple" ? TEMPLE_EXISTING : NO_EXISTING;
  return (
    <PreviewShell community={ctx.community.name} workspaces={sampleRail()}>
      <PreviewCreator ctx={ctx} draft={draft} existing={existing} step={step} />
    </PreviewShell>
  );
}
