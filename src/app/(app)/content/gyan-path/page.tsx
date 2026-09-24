import type { Metadata } from "next";
import Link from "next/link";

import { Toggle } from "@/components/controls";
import { DrawerForm } from "@/components/drawer-form";
import { RowActions } from "@/components/row-actions";
import { Card, EmptyState, QueryError, StatusText, TableWrap, buttonClass } from "@/components/ui";
import { contentStatusLabel, goalLearnerStats } from "@/lib/content";
import { fetchAll } from "@/lib/data/fetch-all";
import { can, canAccess } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { addStepAction, deleteStepAction, saveGoalAction, saveLevelAction } from "../actions";
import { ContentHeader, contentGate } from "../shared";

export const metadata: Metadata = { title: "Content · Gyan Path" };

const SUB = "Goals, chapters and levels by tradition · each level is learn, quiz, quiz, recite";

const TRADITION_LABEL: Record<string, string> = {
  shvetambar_murtipujak: "Shvetambar Murtipujak",
  sthanakvasi: "Sthanakvasi",
  terapanthi: "Terapanthi",
  digambar: "Digambar",
  other: "Other",
};

function GoalFields({ goal }: { goal?: { id: string; name: string; key: string; tradition: string | null; description: string | null; sort_order: number; recommended: boolean } }) {
  const p = goal ? `g-${goal.id.slice(0, 6)}` : "g-new";
  return (
    <>
      {goal ? <input type="hidden" name="id" value={goal.id} /> : null}
      <div>
        <label htmlFor={`${p}-name`} className="crm-label">
          Goal
        </label>
        <input id={`${p}-name`} name="name" required defaultValue={goal?.name ?? ""} placeholder="Learn Samayik" className="crm-input" />
      </div>
      <div>
        <label htmlFor={`${p}-trad`} className="crm-label">
          Tradition
        </label>
        <select id={`${p}-trad`} name="tradition" defaultValue={goal?.tradition ?? ""} className="crm-input">
          <option value="">All traditions</option>
          {Object.entries(TRADITION_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${p}-desc`} className="crm-label">
          Description
        </label>
        <textarea id={`${p}-desc`} name="description" rows={3} defaultValue={goal?.description ?? ""} className="crm-input" />
      </div>
      <div>
        <label htmlFor={`${p}-ord`} className="crm-label">
          Order
        </label>
        <input id={`${p}-ord`} name="sort_order" inputMode="numeric" defaultValue={goal?.sort_order ?? 0} className="crm-input" />
      </div>
      <Toggle name="recommended" label="Recommended" defaultChecked={goal?.recommended ?? false} onNote="Recommended to new learners" offNote="Not recommended" />
      <p className="text-xs text-muted">Next, add levels (with chapters, treasure rewards and teacher sign-off) and each level&apos;s learn, quiz and recite steps.</p>
    </>
  );
}

export default async function GyanPathPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const gate = contentGate(session, SUB);
  if (gate) return gate;
  const sp = await searchParams;
  const { db, center } = session;
  const canManage = canAccess(session, "contentManage");
  const seesProgress = can(session, ["pathshala.teach", "pathshala.manage"]);

  const goals = await db
    .from("gyan_goals")
    .select("id, center_id, tradition, key, name, description, sort_order, recommended")
    .or(`center_id.eq.${center.id},center_id.is.null`)
    .order("sort_order")
    .order("name");
  const goalList = goals.data ?? [];
  const goalIds = goalList.map((g) => g.id);
  const levels = goalIds.length
    ? await db.from("gyan_levels").select("*").in("goal_id", goalIds).order("sort_order")
    : { data: [], error: null };
  const levelList = levels.data ?? [];
  const steps = levelList.length
    ? await db.from("gyan_steps").select("*").in("level_id", levelList.map((l) => l.id)).order("sort_order")
    : { data: [], error: null };
  const stepList = steps.data ?? [];
  const goalOfLevel = new Map(levelList.map((l) => [l.id, l.goal_id]));
  const stepsByGoal = new Map<string, string[]>(goalIds.map((g) => [g, []]));
  for (const s of stepList) stepsByGoal.get(goalOfLevel.get(s.level_id) ?? "")?.push(s.id);

  const progress = seesProgress
    ? await fetchAll((f, t) =>
        db.from("gyan_progress").select("person_id, step_id").eq("center_id", center.id).not("completed_at", "is", null).order("id").range(f, t),
      )
    : null;
  const stats = progress && !progress.error ? goalLearnerStats(stepsByGoal, progress.data) : null;

  const selectedId = param(sp, "goal");
  const selected = goalList.find((g) => g.id === selectedId) ?? goalList[0];
  const selLevels = selected ? levelList.filter((l) => l.goal_id === selected.id) : [];
  const contentIds = stepList.filter((s) => selLevels.some((l) => l.id === s.level_id) && s.content_item_id).map((s) => s.content_item_id as string);
  const items = contentIds.length ? await db.from("content_items").select("id, status, media_path, media_url, title").in("id", contentIds) : null;
  const itemById = new Map((items?.data ?? []).map((i) => [i.id, i]));
  const linkableRes = canManage
    ? await db
        .from("content_items")
        .select("id, title, kind")
        .or(`center_id.eq.${center.id},center_id.is.null`)
        .in("kind", ["sutra", "audio_lesson", "pachchakhan", "video", "explainer"])
        .order("title")
        .limit(500)
    : null;
  const linkable = linkableRes?.data ?? [];
  const editable = Boolean(selected && selected.center_id !== null && canManage);
  const error = goals.error ?? levels.error ?? steps.error ?? items?.error ?? linkableRes?.error ?? null;

  return (
    <>
      <ContentHeader
        sub={SUB}
        actions={
          canManage ? (
            <DrawerForm label="New goal" kicker="Gyan Path" title="New goal" subtitle="Tradition, chapters, levels, treasure rewards, teacher sign-off" action={saveGoalAction} submitLabel="Create goal">
              <GoalFields />
            </DrawerForm>
          ) : null
        }
      />
      {error ? (
        <div className="mb-4">
          <QueryError what="Gyan Path" error={error} retryHref="/content/gyan-path" />
        </div>
      ) : null}
      <Card title="Goals" padded={false} className="mb-4">
        {progress?.error ? (
          <p className="px-4 pt-2 text-[13px] text-danger">Could not count learners — the progress records could not be read. Reload to try again.</p>
        ) : null}
        {progress?.truncated ? <p className="px-4 pt-2 text-[13px] text-brown">Learner counts use the first 50,000 completed steps only.</p> : null}
        {goalList.length === 0 ? (
          <EmptyState title="No Gyan Path goals yet" />
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Goal</th>
                  <th>Tradition</th>
                  <th className="num">Levels</th>
                  <th className="num">Learners</th>
                  <th className="num">Completion</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {goalList.map((g) => {
                  const st = stats?.get(g.id);
                  return (
                    <tr key={g.id} aria-selected={g.id === selected?.id}>
                      <td className="font-bold">
                        {g.name}
                        {g.center_id === null ? <div className="text-xs font-normal text-muted">Shared goal · read-only</div> : null}
                      </td>
                      <td>{g.tradition ? TRADITION_LABEL[g.tradition] : "All traditions"}</td>
                      <td className="num">{levelList.filter((l) => l.goal_id === g.id).length}</td>
                      <td className="num" title={seesProgress ? undefined : "Learner counts need Pathshala access (pathshala.teach or pathshala.manage)"}>
                        {st ? st.learners.toLocaleString() : "—"}
                      </td>
                      <td className="num">{st?.completionPct !== null && st?.completionPct !== undefined ? `${st.completionPct}%` : "—"}</td>
                      <td className="text-right">
                        <Link href={`/content/gyan-path?goal=${g.id}`} className={buttonClass("ghost", "xs")}>
                          Levels
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        {!seesProgress ? <p className="px-4 pb-3 pt-1 text-xs text-muted">Learners and completion need Pathshala access (pathshala.teach or pathshala.manage).</p> : null}
      </Card>

      {selected ? (
        <Card
          title={`${selected.name} · levels`}
          description={(() => {
            const t = selLevels.filter((l) => l.treasure).map((l) => `${l.sort_order || selLevels.indexOf(l) + 1} (${l.treasure})`);
            return t.length ? `Treasure levels: ${t.join(", ")}` : "No treasure levels yet";
          })()}
          padded={false}
          actions={
            editable ? (
              <>
                <DrawerForm label="Edit goal" variant="ghost" size="sm" kicker="Gyan Path" title={selected.name} action={saveGoalAction} submitLabel="Save goal" resetOnSuccess={false}>
                  <GoalFields goal={selected} />
                </DrawerForm>
                <DrawerForm label="Add level" size="sm" kicker={selected.name} title="New level" action={saveLevelAction} submitLabel="Add level">
                  <LevelFields goalId={selected.id} nextOrder={selLevels.length + 1} />
                </DrawerForm>
              </>
            ) : null
          }
        >
          {selLevels.length === 0 ? (
            <EmptyState title="No levels yet" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Level</th>
                    <th>Text</th>
                    <th>Audio</th>
                    <th>Quizzes</th>
                    <th>Sign-off</th>
                    {editable ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {selLevels.map((l, i) => {
                    const ls = stepList.filter((s) => s.level_id === l.id);
                    const textItems = ls.filter((s) => (s.kind === "read" || s.kind === "recite") && s.content_item_id).map((s) => itemById.get(s.content_item_id as string));
                    const quizzes = ls.filter((s) => s.kind === "quiz").length;
                    const audio = ls.filter((s) => s.kind === "listen" || s.kind === "recite").map((s) => (s.content_item_id ? itemById.get(s.content_item_id) : undefined));
                    const textStatus = textItems.find(Boolean)?.status;
                    const recorded = audio.some((a) => a && (a.media_path || a.media_url));
                    return (
                      <tr key={l.id}>
                        <td className="num">{i + 1}</td>
                        <td className="font-bold">
                          {l.name}
                          {l.chapter ? <div className="text-xs font-normal text-muted">{l.chapter}</div> : null}
                          <div className="text-xs font-normal text-muted">
                            {ls.length} step{ls.length === 1 ? "" : "s"}
                            {l.points ? ` · ${l.points} points` : ""}
                          </div>
                        </td>
                        <td>
                          {textStatus ? (
                            <StatusText tone={textStatus === "published" || textStatus === "approved" ? "ok" : "warn"}>
                              {textStatus === "published" ? "Approved" : contentStatusLabel(textStatus)}
                            </StatusText>
                          ) : (
                            <StatusText tone="warn">No text linked</StatusText>
                          )}
                        </td>
                        <td>{recorded ? <StatusText tone="ok">Recorded</StatusText> : <StatusText tone="warn">To record</StatusText>}</td>
                        <td>{quizzes ? `${quizzes} question${quizzes === 1 ? "" : "s"}` : "—"}</td>
                        <td>{l.requires_teacher_signoff ? <span className="font-bold text-purple">Teacher</span> : "—"}</td>
                        {editable ? (
                          <td className="text-right">
                            <div className="flex flex-wrap justify-end gap-2">
                              <DrawerForm label="Edit" variant="ghost" size="xs" kicker={selected.name} title={l.name} action={saveLevelAction} submitLabel="Save level" resetOnSuccess={false}>
                                <LevelFields goalId={selected.id} level={l} nextOrder={i + 1} />
                              </DrawerForm>
                              <DrawerForm label="Steps" variant="ghost" size="xs" kicker={`${selected.name} · ${l.name}`} title="Steps" action={addStepAction} submitLabel="Add step" intro={<StepList steps={ls} />}>
                                <StepFields levelId={l.id} nextOrder={ls.length + 1} items={linkable} />
                              </DrawerForm>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          {selected.center_id === null ? (
            <p className="px-4 pb-3 pt-1 text-xs text-muted">Shared goals come from the platform library; only the platform team can change them.</p>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}

function LevelFields({
  goalId,
  nextOrder,
  level,
}: {
  goalId: string;
  nextOrder: number;
  level?: { id: string; key: string; name: string; chapter: string | null; points: number; sort_order: number; treasure: string | null; requires_teacher_signoff: boolean };
}) {
  const p = level ? `l-${level.id.slice(0, 6)}` : "l-new";
  return (
    <>
      <input type="hidden" name="goal_id" value={goalId} />
      {level ? <input type="hidden" name="id" value={level.id} /> : null}
      {level ? <input type="hidden" name="key" value={level.key} /> : null}
      <div>
        <label htmlFor={`${p}-name`} className="crm-label">
          Level
        </label>
        <input id={`${p}-name`} name="name" required defaultValue={level?.name ?? ""} className="crm-input" />
      </div>
      <div>
        <label htmlFor={`${p}-ch`} className="crm-label">
          Chapter
        </label>
        <input id={`${p}-ch`} name="chapter" defaultValue={level?.chapter ?? ""} placeholder="Foundations" className="crm-input" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${p}-ord`} className="crm-label">
            Number
          </label>
          <input id={`${p}-ord`} name="sort_order" inputMode="numeric" defaultValue={level?.sort_order ?? nextOrder} className="crm-input" />
        </div>
        <div>
          <label htmlFor={`${p}-pts`} className="crm-label">
            Points
          </label>
          <input id={`${p}-pts`} name="points" inputMode="numeric" defaultValue={level?.points ?? 0} className="crm-input" />
        </div>
      </div>
      <div>
        <label htmlFor={`${p}-tr`} className="crm-label">
          Treasure reward
        </label>
        <input id={`${p}-tr`} name="treasure" defaultValue={level?.treasure ?? ""} placeholder="Foundations badge" className="crm-input" />
      </div>
      <Toggle
        name="requires_teacher_signoff"
        label="Teacher sign-off"
        defaultChecked={level?.requires_teacher_signoff ?? false}
        onNote="A teacher signs off before it counts"
        offNote="Completes on its own"
      />
    </>
  );
}

function StepList({ steps }: { steps: { id: string; kind: string; title: string }[] }) {
  if (steps.length === 0) return <p className="text-[13px] text-muted">No steps yet. Each level is usually learn, quiz, quiz, recite.</p>;
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((s) => (
        <li key={s.id} className="cc-kv">
          <span>
            <span className="font-bold capitalize">{s.kind === "read" ? "learn" : s.kind}</span> · {s.title}
          </span>
          <RowActions action={deleteStepAction} fields={{ id: s.id }} buttons={[{ label: "Remove", value: "remove", variant: "bad", confirm: `Remove the step "${s.title}"?` }]} />
        </li>
      ))}
    </ol>
  );
}

function StepFields({ levelId, nextOrder, items }: { levelId: string; nextOrder: number; items: { id: string; title: string; kind: string }[] }) {
  return (
    <>
      <p className="cc-section mt-2">Add a step</p>
      <input type="hidden" name="level_id" value={levelId} />
      <div>
        <label htmlFor={`s-${levelId}-kind`} className="crm-label">
          Kind
        </label>
        <select id={`s-${levelId}-kind`} name="kind" defaultValue="read" className="crm-input">
          <option value="read">Learn (read)</option>
          <option value="listen">Listen</option>
          <option value="quiz">Quiz</option>
          <option value="recite">Recite</option>
          <option value="video">Video</option>
          <option value="practice">Practice</option>
        </select>
      </div>
      <div>
        <label htmlFor={`s-${levelId}-title`} className="crm-label">
          Title
        </label>
        <input id={`s-${levelId}-title`} name="title" required className="crm-input" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`s-${levelId}-ord`} className="crm-label">
            Order
          </label>
          <input id={`s-${levelId}-ord`} name="sort_order" inputMode="numeric" defaultValue={nextOrder} className="crm-input" />
        </div>
        <div>
          <label htmlFor={`s-${levelId}-pts`} className="crm-label">
            Points
          </label>
          <input id={`s-${levelId}-pts`} name="points" inputMode="numeric" defaultValue={0} className="crm-input" />
        </div>
      </div>
      <div>
        <label htmlFor={`s-${levelId}-ci`} className="crm-label">
          Linked text or audio
        </label>
        <select id={`s-${levelId}-ci`} name="content_item_id" defaultValue="" className="crm-input">
          <option value="">None</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.title} ({i.kind.replace(/_/g, " ")})
            </option>
          ))}
        </select>
        <p className="crm-hint">Sutra text and audio come from the Library and must be approved there.</p>
      </div>
      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 text-[13px] font-bold">Quiz question (quiz steps)</legend>
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor={`s-${levelId}-qq`} className="crm-label">
              Question
            </label>
            <input id={`s-${levelId}-qq`} name="quiz_question" className="crm-input" placeholder="How many lines does the Navkar Mantra have?" />
          </div>
          <div>
            <label htmlFor={`s-${levelId}-qo`} className="crm-label">
              Answers, one per line
            </label>
            <textarea id={`s-${levelId}-qo`} name="quiz_options" rows={4} className="crm-input" />
          </div>
          <div>
            <label htmlFor={`s-${levelId}-qa`} className="crm-label">
              Right answer (line number)
            </label>
            <input id={`s-${levelId}-qa`} name="quiz_answer" inputMode="numeric" className="crm-input" placeholder="2" />
          </div>
        </div>
      </fieldset>
    </>
  );
}
