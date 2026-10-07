import type { Metadata } from "next";
import Link from "next/link";

import { DrawerForm } from "@/components/drawer-form";
import { Card, EmptyState, TableWrap } from "@/components/ui";
import { isPermissionError } from "@/lib/access-db";
import { loadClasses, loadLevels, loadTerms, pickTerm } from "@/lib/data/pathshala";
import { explainError } from "@/lib/errors";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { load, rows, viewerOf } from "@/lib/pathshala/server";
import type { LevelRow } from "@/lib/pathshala-registration/contract";
import { loadLevelRows, NEEDS_UPDATE } from "@/lib/pathshala-registration/db";
import { AUDIENCE_LABEL, ageBandLabel, levelAudience, nextSortOrder, sortLevels, sortTracks } from "@/lib/pathshala-registration/levels";
import { getSession } from "@/lib/session";

import { ActionButton, LoadProblemPage, Notice, PathshalaHeader, PBadge, PNoAccessPage } from "../ui";
import { saveLevelAction, setLevelActiveAction } from "./actions";
import { LevelFields } from "./level-fields";

export const metadata: Metadata = { title: "Pathshala levels" };

const SUBTITLE = "Levels · the steps of each track, their age bands, adult classes and children's levels";
const AREA = "Pathshala levels (pathshala.view or pathshala.manage)";

/**
 * Pathshala › Levels (PATHSHALA_REGISTRATION_PLAN §2.1, §3.3): per track, the levels in order with key, age band, who
 * they are for and whether they are offered; the principal adds, edits, reorders (the order number) and retires them.
 * Tracks stay in Setup › Lists. While the database has no 0590 the levels show as they are, read-only, and say why.
 */
export default async function LevelsPage() {
  const v = viewerOf(await getSession());
  if (!pathshalaAreas.admin(v)) return <PNoAccessPage area={AREA} />;
  const { db, center } = v;
  const res = await load(async () => {
    const [tracks, levels, terms] = await Promise.all([
      db.from("pathshala_tracks").select("id, key, name").eq("center_id", center.id).then((r) => rows(r, "Pathshala tracks")),
      loadLevelRows(db, center.id),
      loadTerms(db, center.id),
    ]);
    const term = pickTerm(terms);
    const classes = term ? await loadClasses(db, center.id, term.id) : [];
    // Before 0590 there is no `active` flag: show the levels from the columns every database has, read-only.
    const fallback = levels.status === "missing" ? (await loadLevels(db, center.id)).map((l): LevelRow => ({ ...l, active: true })) : null;
    return { tracks, levels, fallback, term, classes };
  });
  if (!res.ok) return <LoadProblemPage message={res.error} retryHref="/pathshala/levels" />;
  const { tracks, levels, fallback, term, classes } = res.data;
  if (levels.status === "error") {
    if (isPermissionError(levels.error)) return <PNoAccessPage area={AREA} />;
    return <LoadProblemPage message={`Could not load the levels — ${explainError(levels.error)}.`} retryHref="/pathshala/levels" />;
  }
  if (levels.status === "shape") {
    return <LoadProblemPage message={`Could not read the levels — the database answered with something this screen cannot read (${levels.message}).`} retryHref="/pathshala/levels" />;
  }
  const list = levels.status === "ok" ? levels.value : (fallback ?? []);
  const canEdit = pathshalaAreas.manage(v) && levels.status === "ok";
  const classCount = new Map<string, number>();
  for (const c of classes) classCount.set(c.level_id, (classCount.get(c.level_id) ?? 0) + 1);

  return (
    <>
      <PathshalaHeader description={SUBTITLE} />
      {levels.status === "missing" ? (
        <div className="mb-4">
          <Notice tone="warning">
            {NEEDS_UPDATE} Until it is applied the levels show as they are and cannot be changed here; age bands, adult classes and retiring a
            level arrive with it.
          </Notice>
        </div>
      ) : null}
      <p className="mb-4 max-w-4xl text-[13px] text-muted">
        A level&apos;s age band is in whole years on the term&apos;s age cut-off date. It suggests levels to families, keeps adult classes (minimum 18
        or more) for adults and children&apos;s levels (maximum under 18) for children; a level with no band is open to anyone. Retire a level to stop
        offering it: its classes, enrollments and reports are kept. Fees are set per term, on each term&apos;s{" "}
        <Link className="crm-link" href="/pathshala/terms">
          Fees and rules
        </Link>{" "}
        page.
      </p>
      {tracks.length === 0 ? (
        <Card>
          <EmptyState title="No Pathshala tracks yet">
            Tracks (Jainism, Gujarati, Hindi …) are added in{" "}
            <Link className="crm-link" href="/setup/lists#pathshala">
              Setup › Lists
            </Link>
            ; then add each track&apos;s levels here.
          </EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {sortTracks(tracks).map((track) => {
            const trackLevels = sortLevels(list.filter((l) => l.track_id === track.id));
            return (
              <Card
                key={track.id}
                title={track.name}
                description={`${trackLevels.length} level${trackLevels.length === 1 ? "" : "s"}${term ? ` · classes counted for ${term.name}` : ""}`}
                padded={false}
                actions={
                  canEdit ? (
                    <DrawerForm label="Add level" size="sm" kicker="Pathshala" title={`New level in ${track.name}`} action={saveLevelAction.bind(null, null)} submitLabel="Add level">
                      <LevelFields level={null} track={track} nextOrder={nextSortOrder(trackLevels)} />
                    </DrawerForm>
                  ) : null
                }
              >
                {trackLevels.length === 0 ? (
                  <EmptyState title={`No levels in ${track.name} yet`}>{canEdit ? "Add the first one with Add level." : ""}</EmptyState>
                ) : (
                  <TableWrap>
                    <table className="crm-table crm-table-first-bold min-w-[760px]">
                      <thead>
                        <tr>
                          <th>Level</th>
                          <th>Order</th>
                          <th>Age band</th>
                          <th>For</th>
                          <th>{term ? term.name : "This term"}</th>
                          <th>Status</th>
                          {canEdit ? <th className="text-right">Change</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {trackLevels.map((l) => {
                          const n = classCount.get(l.id) ?? 0;
                          return (
                            <tr key={l.id}>
                              <td>
                                {l.name}
                                <span className="ml-2 font-mono text-[11px] font-normal text-muted">{l.key}</span>
                              </td>
                              <td>{l.sort_order}</td>
                              <td>{ageBandLabel(l.min_age, l.max_age)}</td>
                              <td>{AUDIENCE_LABEL[levelAudience(l.min_age, l.max_age)]}</td>
                              <td>{n ? `${n} class${n === 1 ? "" : "es"}` : <span className="text-muted">No class</span>}</td>
                              <td>{l.active ? <PBadge tone="success">Offered</PBadge> : <PBadge tone="muted">Retired</PBadge>}</td>
                              {canEdit ? (
                                <td className="text-right">
                                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                                    <DrawerForm
                                      label="Edit"
                                      variant="ghost"
                                      size="xs"
                                      kicker={track.name}
                                      title={`Edit ${l.name}`}
                                      action={saveLevelAction.bind(null, l.id)}
                                      submitLabel="Save level"
                                      resetOnSuccess={false}
                                    >
                                      <LevelFields level={l} track={track} nextOrder={l.sort_order} />
                                    </DrawerForm>
                                    {l.active ? (
                                      <ActionButton
                                        action={setLevelActiveAction.bind(null, l.id)}
                                        label="Retire"
                                        variant="bad"
                                        fields={{ active: "false" }}
                                        confirm={`Retire ${l.name}? It is no longer offered: no new classes or registrations. Its classes, enrollments and reports are kept, and you can offer it again later.`}
                                      />
                                    ) : (
                                      <ActionButton action={setLevelActiveAction.bind(null, l.id)} label="Offer again" fields={{ active: "true" }} />
                                    )}
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
              </Card>
            );
          })}
          {!pathshalaAreas.manage(v) ? <p className="text-[13px] text-muted">Only the Pathshala principal (pathshala.manage) can change levels.</p> : null}
        </div>
      )}
    </>
  );
}
