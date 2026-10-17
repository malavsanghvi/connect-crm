import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Badge, Card, ChipLinks, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { GestureEditor, InstallGestures, PauseGesture } from "@/components/care/gesture-controls";
import { WHOS, WHO_LABEL, blankGesture, gestureInput, gestureLine, needsLine, suitsLine, type Gesture, type Who } from "@/lib/care/gestures";
import { CHANNEL_LABEL, NO_ACCESS, TOUCH_KIND_LABEL } from "@/lib/care/model";
import { loadGestures, seesCare } from "@/lib/data/care";
import { kindName } from "@/lib/kind";
import { hrefWith, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Gestures" };

// The gesture library (DonorDelight slice 6): things to do FOR a supporter, each with its cost, effort, who should do it and which households it suits.
// A gesture is never paired with an ask. Everyone with a care key reads it; whoever manages DonorDelight (care.manage) adds the starters for their
// kind of organization, edits, pauses and resumes. On a household's Care card the gestures that suit it are offered as ideas. The database decides
// (app.care_gestures_list, 0894: no platform-admin branch).

function whoOf(v: string | undefined): Who | null {
  return v && (WHOS as readonly string[]).includes(v) ? (v as Who) : null;
}

function GestureCard({ g, canManage }: { g: Gesture; canManage: boolean }) {
  const suits = suitsLine(g);
  const needs = needsLine(g);
  return (
    <Card
      title={
        <>
          {g.name} {g.enabled ? null : <Badge tone="warning">Paused</Badge>}
          {g.suggest ? null : <Badge tone="neutral"> Chosen by a person</Badge>}
        </>
      }
      description={gestureLine(g)}
      actions={
        canManage ? (
          <>
            <Link href={`/care/gestures?edit=${g.id}`} className={buttonClass("ghost", "xs")}>
              Edit
            </Link>
            <PauseGesture id={g.id} enabled={g.enabled} />
          </>
        ) : undefined
      }
    >
      <p className="m-0 text-[14px] text-ink-2">{g.description}</p>
      <p className="m-0 mt-1 text-[12.5px] text-muted">
        Records: {TOUCH_KIND_LABEL[g.kind]}
        {g.channel ? ` · ${CHANNEL_LABEL[g.channel]}` : ""} · no ask
      </p>
      {suits ? <p className="m-0 mt-0.5 text-[12.5px] text-muted">{suits}</p> : null}
      {needs ? <p className="m-0 mt-0.5 text-[12.5px] text-muted">{needs}</p> : null}
      {g.draft ? <p className="m-0 mt-2 whitespace-pre-wrap rounded-field border border-line-soft bg-ground px-3 py-2 text-[12.5px] text-muted">{g.draft}</p> : null}
    </Card>
  );
}

export default async function GesturesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const sp = await searchParams;
  const label = kindName(session.kind, "care", "DonorDelight");
  const header = <PageHeader title={`${label}: gestures`} description="Things to do for a supporter, each with its cost, effort and who should do it. A gesture is never paired with an ask." />;
  const card = (title: string, body?: string) => (
    <>
      {header}
      <div className="cc-card px-6 py-10 text-center">
        <p className="font-display text-[22px] font-semibold text-ink">{title}</p>
        {body ? <p className="mx-auto mt-2 max-w-lg text-[13px] text-muted">{body}</p> : null}
      </div>
    </>
  );

  if (!seesCare(session)) return card(NO_ACCESS, `${label} is open only to the roles your organization gives it. Ask your organization's owner or care lead.`);

  const read = await loadGestures(session);
  if (read.status === "no_access") return card(NO_ACCESS);
  if (read.status === "off") return card(read.message);
  if (read.status === "error") {
    return (
      <>
        {header}
        <Alert
          tone="danger"
          title="Could not load the gestures"
          action={
            <a href="/care/gestures" className={buttonClass("bad", "xs")}>
              Try again
            </a>
          }
        >
          {read.error.charAt(0).toUpperCase() + read.error.slice(1).replace(/\.?$/, ".")}
        </Alert>
      </>
    );
  }

  const data = read.data;
  const edit = param(sp, "edit");
  const editing = data.canManage && edit ? (edit === "new" ? blankGesture() : (() => { const g = data.gestures.find((x) => x.id === edit); return g ? gestureInput(g) : null; })()) : null;
  if (editing) {
    return (
      <>
        {header}
        <Card title={editing.id ? "Change the gesture" : "A new gesture"}>
          <GestureEditor key={editing.id ?? "new"} initial={editing} />
        </Card>
      </>
    );
  }

  const who = whoOf(param(sp, "who") ?? undefined);
  const shown = who ? data.gestures.filter((g) => g.who === who || g.who === "anyone") : data.gestures;
  const chips = [
    { key: "all", label: `Everyone (${data.gestures.length})`, href: hrefWith("/care/gestures", sp, { who: null }) },
    ...WHOS.filter((w) => w !== "anyone").map((w) => ({
      key: w,
      label: `${WHO_LABEL[w]} (${data.gestures.filter((g) => g.who === w || g.who === "anyone").length})`,
      href: hrefWith("/care/gestures", sp, { who: w }),
    })),
  ];
  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        {data.canManage ? (
          <div className="flex flex-wrap items-center gap-3">
            {data.startersMissing > 0 ? <InstallGestures count={data.startersMissing} label={data.label} /> : null}
            <Link href="/care/gestures?edit=new" className={buttonClass("ghost", "sm")}>
              New gesture
            </Link>
          </div>
        ) : null}
        {data.gestures.length > 0 ? <ChipLinks label="Best done by" items={chips} active={who ?? "all"} /> : null}
        {shown.length === 0 ? (
          <Card padded={false}>
            <EmptyState title={data.gestures.length === 0 ? "No gestures yet." : "No gesture for that person."}>
              {data.gestures.length === 0
                ? data.canManage
                  ? "Add the starter gestures written for your kind of organization, then change any word."
                  : "Someone who manages this area adds the gestures."
                : null}
            </EmptyState>
          </Card>
        ) : (
          shown.map((g) => <GestureCard key={g.id} g={g} canManage={data.canManage} />)
        )}
      </div>
    </>
  );
}
