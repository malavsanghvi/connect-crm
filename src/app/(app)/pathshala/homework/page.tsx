import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { HouseholdCard, type CardLabels } from "@/components/household-card";
import { Badge, Card, EmptyState, FilterBar, buttonClass } from "@/components/ui";
import { isPermissionError } from "@/lib/access-db";
import { identifierRules } from "@/lib/center-rules";
import { loadClasses, loadTerms, pickTerm } from "@/lib/data/pathshala";
import { formatDateTime } from "@/lib/dates";
import { explainError } from "@/lib/errors";
import { loadHomeworkQueue, signHomeworkFiles, type SignedFile } from "@/lib/gyan-homework/db";
import {
  attemptText,
  fileRemoved,
  householdBriefText,
  matchesQueueFilters,
  pointsText,
  queueLevelOptions,
  queueLimitNote,
  REVIEW_NOTE_MAX,
  submissionStatusLabel,
  submissionStatusTone,
  type QueueItem,
  type QueueView,
} from "@/lib/gyan-homework/homework";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { canAccess } from "@/lib/permissions";
import { hrefWith, isUuid, param, type RawSearchParams } from "@/lib/search-params";
import { getSession, type CrmSession } from "@/lib/session";

import { reviewHomework } from "../actions";
import { LoadProblem, PNoAccess, PathshalaHeader, ViewChips } from "../ui";
import { SubmissionParts } from "./parts";

export const metadata: Metadata = { title: "Homework" };

const SUBTITLE = "Homework handed in for Gyan Path levels · accept it (points are paid once) or send it back with a note the family reads too";

type ClassInfo = { id: string; name: string };

/**
 * This term's classes (for the filter and the row labels) and where the learners on screen are placed. Both are
 * conveniences: when they cannot be read the queue still shows, without the class filter, and says why. RLS lets
 * the principal read every enrollment, a class teacher only their own class's, and the content team none: a learner
 * with no placement on screen is "not placed" only for the principal (QueueRow).
 */
async function classContext(session: CrmSession, personIds: string[]): Promise<{ classes: ClassInfo[]; placements: Map<string, string[]>; problem: string | null }> {
  const { db, center } = session;
  const placements = new Map<string, string[]>();
  try {
    const term = pickTerm(await loadTerms(db, center.id));
    const classes = term ? (await loadClasses(db, center.id, term.id)).map((c) => ({ id: c.id, name: c.name })) : [];
    if (personIds.length) {
      const { data, error } = await db.from("pathshala_enrollments").select("student_person_id, class_id").in("student_person_id", personIds).in("status", ["placed", "active"]);
      if (error) throw error;
      for (const e of data ?? []) if (e.class_id) placements.set(e.student_person_id, [...(placements.get(e.student_person_id) ?? []), e.class_id]);
    }
    return { classes, placements, problem: null };
  } catch (error) {
    console.error("[pathshala/homework] could not load the classes for the filter:", error);
    return { classes: [], placements, problem: explainError(error) };
  }
}

export default async function HomeworkQueuePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  if (!pathshalaAreas.homework(session)) {
    return (
      <>
        <PathshalaHeader description={SUBTITLE} />
        <PNoAccess area="Homework review (a Teacher role, pathshala.teach, pathshala.manage or content.manage)" />
      </>
    );
  }
  const sp = await searchParams;
  const view: QueueView = param(sp, "view") === "decided" ? "decided" : "waiting";
  const classFilter = param(sp, "class");
  const levelFilter = param(sp, "level");
  const tz = session.center.time_zone;
  const retryHref = hrefWith("/pathshala/homework", sp, {});
  const rules = identifierRules(session.center.rules);
  const labels: CardLabels = { orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel };

  const header = (
    <>
      <PathshalaHeader description={SUBTITLE} />
      <ViewChips
        active={view}
        tabs={[
          { key: "waiting", label: "With the teacher", href: hrefWith("/pathshala/homework", sp, { view: undefined }) },
          { key: "decided", label: "Decided", href: hrefWith("/pathshala/homework", sp, { view: "decided" }) },
        ]}
      />
    </>
  );

  const queue = await loadHomeworkQueue(session.db, session.center.id, view);
  if (queue.status !== "ok") {
    if (queue.status === "error" && isPermissionError(queue.error)) {
      return (
        <>
          {header}
          <PNoAccess area="Homework review (a Teacher role, pathshala.teach, pathshala.manage or content.manage)" />
        </>
      );
    }
    const message =
      queue.status === "missing"
        ? "Could not load the homework queue — the database does not have migration 0587 (learning assignments) yet. Apply it, then try again."
        : queue.status === "shape"
          ? `Could not read the homework queue — the database answered with something this screen cannot read (${queue.message}). Has the latest migration been applied?`
          : `Could not load the homework queue — ${explainError(queue.error)}.`;
    return (
      <>
        {header}
        <LoadProblem message={message} retryHref={retryHref} />
      </>
    );
  }
  const items = queue.value;

  const ctx = await classContext(session, [...new Set(items.map((i) => i.learner.person_id))]);
  const classId = isUuid(classFilter) ? classFilter : null;
  const visible = items.filter((it) => matchesQueueFilters(it, { classId, levelName: levelFilter ?? null }, ctx.placements));
  const levelOptions = queueLevelOptions(items);
  const className = (id: string | null) => (id ? (ctx.classes.find((c) => c.id === id)?.name ?? null) : null);
  // "Not placed in a class this term" is a claim only the principal's read of the enrollments can back.
  const seesAllPlacements = ctx.problem === null && pathshalaAreas.admin(session);
  // The household card links to the household's page for people who may open People.
  const householdHref = canAccess(session, "households") ? (id: string) => `/households/${id}` : () => undefined;

  // Two signing calls for every file on screen (not the removed ones): photos and voice notes show inline; the file
  // parts are signed as downloads (Content-Disposition: attachment) and open in a new tab.
  const live = visible.flatMap((it) => it.submission.files.filter((f) => !fileRemoved(f)));
  const inlinePaths = live.filter((f) => f.kind !== "file").map((f) => f.storage_path as string);
  const downloadPaths = live.filter((f) => f.kind === "file").map((f) => f.storage_path as string);
  const [inlineSigned, downloadSigned] = await Promise.all([
    signHomeworkFiles(session.db, inlinePaths),
    signHomeworkFiles(session.db, downloadPaths, { download: true }),
  ]);
  const signed: ReadonlyMap<string, SignedFile> = new Map([...inlineSigned, ...downloadSigned]);
  const limitNote = queueLimitNote(view, items.length);

  return (
    <>
      {header}
      <FilterBar action="/pathshala/homework">
        {view === "decided" ? <input type="hidden" name="view" value="decided" /> : null}
        <div>
          <label htmlFor="hw-class" className="crm-label">
            Class
          </label>
          <select id="hw-class" name="class" defaultValue={classId ?? ""} className="crm-input" disabled={ctx.problem !== null}>
            <option value="">All classes</option>
            {ctx.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="hw-level" className="crm-label">
            Level
          </label>
          <select id="hw-level" name="level" defaultValue={levelFilter ?? ""} className="crm-input">
            <option value="">All levels</option>
            {levelOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </FilterBar>
      {ctx.problem ? <p className="mb-3 text-[13px] text-danger">The class filter is unavailable — the classes could not be read ({ctx.problem}). Reload to try again.</p> : null}
      <Card title={view === "waiting" ? "With the teacher" : "Decided"} description={view === "waiting" ? `${visible.length} waiting` : `${visible.length} decided`} padded={false}>
        {visible.length === 0 ? (
          <EmptyState title={items.length === 0 ? (view === "waiting" ? "No homework waiting for a decision" : "Nothing decided yet") : "Nothing matches these filters"}>
            {items.length === 0 && view === "waiting"
              ? "When a learner hands in homework (and, for a child, a parent has given their OK), it shows up here."
              : ""}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3 p-2">
            {visible.map((it) => (
              <li key={it.submission.id}>
                <QueueRow
                  item={it}
                  view={view}
                  signed={signed}
                  labels={labels}
                  tz={tz}
                  currency={session.center.currency}
                  className={className}
                  placements={ctx.placements}
                  classes={ctx.classes}
                  seesAllPlacements={seesAllPlacements}
                  householdHref={householdHref}
                />
              </li>
            ))}
          </ul>
        )}
        {limitNote ? <p className="px-4 pb-3 pt-1 text-xs text-brown">{limitNote}</p> : null}
      </Card>
    </>
  );
}

function QueueRow({
  item,
  view,
  signed,
  labels,
  tz,
  currency,
  className,
  placements,
  classes,
  seesAllPlacements,
  householdHref,
}: {
  item: QueueItem;
  view: QueueView;
  signed: ReadonlyMap<string, SignedFile>;
  labels: CardLabels;
  tz: string;
  currency: string;
  className: (id: string | null) => string | null;
  placements: ReadonlyMap<string, string[]>;
  classes: ClassInfo[];
  /** The viewer read every enrollment, so "no placement" means "not placed". */
  seesAllPlacements: boolean;
  householdHref: (householdId: string) => string | undefined;
}) {
  const { submission: s, assignment: a, learner: l } = item;
  const learnerClasses = (placements.get(l.person_id) ?? []).map((id) => classes.find((c) => c.id === id)?.name).filter((n): n is string => Boolean(n));
  const forClass = className(a.class_id);
  const household = l.household;
  const briefHref = household?.kind === "brief" && household.household_id ? householdHref(household.household_id) : undefined;
  return (
    <article className="rounded-[12px] border border-line bg-white p-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-w-0">
          <p className="cc-section">Learner</p>
          <p className="mt-1 text-[15px] font-bold text-ink">
            {l.name}
            {l.is_child ? (
              <span className="ml-2">
                <Badge tone="purple">Child</Badge>
              </span>
            ) : null}
          </p>
          {learnerClasses.length ? (
            <p className="mb-2 text-xs text-muted">Class: {learnerClasses.join(", ")}</p>
          ) : seesAllPlacements ? (
            <p className="mb-2 text-xs text-muted">Not placed in a class this term</p>
          ) : null}
          {household?.kind === "card" ? (
            <HouseholdCard card={household.card} labels={labels} timeZone={tz} currency={currency} showGiving={false} href={householdHref(household.card.household_id)} />
          ) : household?.kind === "brief" ? (
            <p className="rounded-lg border border-line bg-white px-3 py-2 text-[13px]">
              {briefHref ? (
                <a href={briefHref} className="crm-link font-semibold" target="_blank" rel="noreferrer">
                  {householdBriefText(household)}
                </a>
              ) : (
                <span className="font-semibold text-ink">{householdBriefText(household)}</span>
              )}
              <span className="block text-xs text-muted">Household details need people.view.</span>
            </p>
          ) : (
            <p className="rounded-lg border border-saffron/60 bg-saffron-50 px-3 py-2 text-xs text-brown-900">
              The household card could not be shown for this learner, so the name above is all there is. Check the household in People before relying on it.
            </p>
          )}
        </div>
        <div className="min-w-0">
          <p className="cc-section">Homework</p>
          <p className="mt-1 text-[15px] font-bold text-ink">{a.title}</p>
          <p className="text-xs text-muted">
            {[a.goal_name, a.level_name].filter(Boolean).join(" · ") || "Gyan Path"} · {pointsText(a.points)}
            {a.class_id ? ` · for ${forClass ?? "one class"}` : ""}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <Badge tone={submissionStatusTone(s.status)}>{submissionStatusLabel(s.status)}</Badge>
            <span className="text-muted">{attemptText(s.attempt)}</span>
            {s.late ? <Badge tone="warning">Late</Badge> : null}
            {s.submitted_at ? <span className="text-muted">Handed in {formatDateTime(s.submitted_at, tz)}</span> : null}
          </p>
          <div className="mt-3">
            <SubmissionParts submission={s} signed={signed} learner={l.name} />
          </div>
          {s.parent_note ? (
            <p className="mt-3 text-[13px]">
              <span className="font-bold text-purple">Parent&apos;s note:</span> {s.parent_note}
            </p>
          ) : null}
          {view === "waiting" && s.status === "submitted" ? (
            <ActionForm
              action={reviewHomework.bind(null, s.id)}
              submitLabel="Accept"
              hideSubmit
              className="mt-4 flex flex-col gap-2 border-t border-line-soft pt-3"
              buttonsClassName="justify-end gap-1.5"
              extraButtons={
                <>
                  <button type="submit" name="decision" value="send_back" data-variant="bad" className={buttonClass("bad", "xs")}>
                    Send back
                  </button>
                  <button type="submit" name="decision" value="accept" data-variant="ok" className={buttonClass("ok", "xs")}>
                    Accept
                  </button>
                </>
              }
            >
              <input type="hidden" name="learner" value={l.name} />
              <label className="block">
                <span className="crm-label">Note for {l.name} and their family</span>
                <textarea name="note" rows={2} maxLength={REVIEW_NOTE_MAX} className="crm-input" placeholder="Required to send back; optional when accepting" />
                <span className="crm-hint block">Accepting pays {pointsText(a.points)} once. The note goes to the learner and to the household adults, never only to a child.</span>
              </label>
            </ActionForm>
          ) : (
            <div className="mt-3 border-t border-line-soft pt-2 text-[13px]">
              {s.decided_at ? (
                <p className="text-muted">
                  {s.status === "accepted" ? `Accepted${s.points_awarded ? ` · ${pointsText(s.points_awarded)} paid` : ""}` : s.status === "needs_work" ? "Sent back" : submissionStatusLabel(s.status)} ·{" "}
                  {formatDateTime(s.decided_at, tz)}
                </p>
              ) : null}
              {s.review_note ? (
                <p>
                  <span className="font-bold text-ink">Note:</span> {s.review_note}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
