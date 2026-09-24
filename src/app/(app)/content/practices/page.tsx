import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { BlockGrid, Card, EmptyState, Field, InfoBox, QueryError, StatusText, TableWrap } from "@/components/ui";
import { POINTS_LIMITS, practiceCategoryLabel, practiceDefaultTime, readPointsRules, type PointsRules } from "@/lib/content";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { savePointsRulesAction } from "../actions";
import { ContentHeader, contentGate } from "../shared";
import { PracticeButton } from "./practice-form";

export const metadata: Metadata = { title: "Content · Practices & points" };

const SUB = "My Jain Way practice catalog, points, streaks and Saathi rules";

const RULE_FIELDS: { key: keyof PointsRules; unit: string }[] = [
  { key: "day_complete_bonus", unit: "points when every chosen practice is done" },
  { key: "streak_rest_days_per_month", unit: "per month (travel or illness)" },
  { key: "anumodana_points", unit: "points per anumodana" },
  { key: "anumodana_daily_cap", unit: "anumodanas a day, at most" },
  { key: "support_points", unit: "points · once per person per day" },
  { key: "behind_after_days", unit: "days without practice" },
];

export default async function PracticesPage() {
  const session = await getSession();
  const gate = contentGate(session, SUB);
  if (gate) return gate;
  const { db, center } = session;
  const canManage = canAccess(session, "contentManage");
  const canSaveRules = canAccess(session, "centerSettings");
  const points = readPointsRules(center.rules);

  const practices = await db
    .from("practices")
    .select("*")
    .or(`center_id.eq.${center.id},center_id.is.null`)
    .order("sort_order")
    .order("name");

  return (
    <>
      <ContentHeader sub={SUB} actions={canManage ? <PracticeButton label="New practice" /> : null} />
      <BlockGrid>
        <Card title="Practice catalog" span={7} padded={false}>
          {practices.error ? (
            <div className="p-4">
              <QueryError what="the practice catalog" error={practices.error} retryHref="/content/practices" />
            </div>
          ) : (practices.data ?? []).length === 0 ? (
            <EmptyState title="No practices yet" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Practice</th>
                    <th>Category</th>
                    <th>Default time</th>
                    <th className="num">Points</th>
                    <th>Active</th>
                    {canManage ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {(practices.data ?? []).map((p) => (
                    <tr key={p.id}>
                      <td className="font-bold">
                        {p.name}
                        {p.center_id === null ? <div className="text-xs font-normal text-muted">Shared catalog</div> : null}
                      </td>
                      <td>{practiceCategoryLabel(p.category)}</td>
                      <td className="whitespace-nowrap">{practiceDefaultTime(p)}</td>
                      <td className="num">{p.points}</td>
                      <td>{p.active ? <StatusText tone="ok">Yes</StatusText> : <StatusText tone="warn">No</StatusText>}</td>
                      {canManage ? (
                        <td className="text-right">
                          {p.center_id ? <PracticeButton label="Edit" practice={p} /> : <span className="text-xs text-muted">Read-only</span>}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card title="Points, streaks and Saathi" span={5}>
          <ActionForm action={savePointsRulesAction} submitLabel="Save rules" hideSubmit={!canSaveRules}>
            <div className="mb-3 flex flex-col gap-3">
              {RULE_FIELDS.map(({ key, unit }) => (
                <Field key={key} label={POINTS_LIMITS[key].label} htmlFor={`pr-${key}`} hint={unit}>
                  <input
                    id={`pr-${key}`}
                    name={key}
                    inputMode="numeric"
                    required
                    defaultValue={points[key]}
                    disabled={!canSaveRules}
                    className="crm-input"
                  />
                </Field>
              ))}
              <div>
                <p className="crm-label">Standings</p>
                <InfoBox>Private to the member · totals only in reports</InfoBox>
              </div>
              <div>
                <p className="crm-label">Saathi alerts go to</p>
                <InfoBox>Anumodana senders first, then family · members can opt out</InfoBox>
              </div>
            </div>
            {!canSaveRules ? <p className="mb-2 text-[13px] text-muted">These are center rules; saving them needs settings.manage.</p> : null}
            <p className="mb-2 text-xs text-muted">Streak rest days are stored here; the streak counter does not apply them yet.</p>
          </ActionForm>
        </Card>
      </BlockGrid>
    </>
  );
}
