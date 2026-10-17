import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Badge, Card, ChipLinks, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { ApprovePlan, DraftPlan, PlanEditor } from "@/components/care/plan-controls";
import { NO_ACCESS } from "@/lib/care/model";
import { byMonth, comingUp, dayLine, itemLine, planInput } from "@/lib/care/plan";
import { loadCarePlan, seesCare } from "@/lib/data/care";
import { kindName } from "@/lib/kind";
import { hrefWith, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Care plan" };

// The care plan from the mission (DonorDelight slice 8): a yearly calendar of relationship moments, which group of households gets which touch and when,
// drafted from the organization's mission, calendar, fiscal year and quiet periods. Everyone with a care key reads it; whoever manages DonorDelight
// drafts, edits and approves it. Nothing in it runs by itself, an edit returns an approved plan to draft, and no moment asks for money. The database
// decides (app.care_plan_get, 0896: no platform-admin branch).

function defaultYear(today: Date): number {
  return today.getUTCFullYear() + (today.getUTCMonth() >= 10 ? 1 : 0);
}

export default async function CarePlanPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const sp = await searchParams;
  const label = kindName(session.kind, "care", "DonorDelight");
  const header = <PageHeader title={`${label}: care plan`} description="A calendar for the year: which households we thank, call or greet, and when, before anyone is asked. Nothing in it runs by itself." />;
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

  const asked = Number(param(sp, "year"));
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= 2100 ? asked : defaultYear(new Date());
  const read = await loadCarePlan(session, year);
  if (read.status === "no_access") return card(NO_ACCESS);
  if (read.status === "off") return card(read.message);
  if (read.status === "error") {
    return (
      <>
        {header}
        <Alert
          tone="danger"
          title="Could not load the care plan"
          action={
            <a href={hrefWith("/care/plan", sp, {})} className={buttonClass("bad", "xs")}>
              Try again
            </a>
          }
        >
          {read.error.charAt(0).toUpperCase() + read.error.slice(1).replace(/\.?$/, ".")}
        </Alert>
      </>
    );
  }

  const plan = read.data;
  if (plan.canManage && param(sp, "edit") === "1" && plan.exists) {
    return (
      <>
        {header}
        <Card title={`Edit the ${year} plan`}>
          <PlanEditor key={`${year}-${plan.updatedAt ?? ""}`} year={year} initial={planInput(plan)} />
        </Card>
      </>
    );
  }

  const years = [...new Set([defaultYear(new Date()) - 1, defaultYear(new Date()), defaultYear(new Date()) + 1, ...plan.years, year])].sort();
  const chips = years.map((y) => ({ key: String(y), label: String(y), href: hrefWith("/care/plan", sp, { year: String(y), edit: null }) }));
  const upcoming = plan.exists ? comingUp(plan.items, plan.today, 30) : [];
  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        <ChipLinks label="Year" items={chips} active={String(year)} />
        {!plan.exists ? (
          <Card padded={false}>
            <EmptyState title={`There is no plan for ${year} yet.`}>
              {plan.canManage ? (
                <div className="mt-2 flex justify-center">
                  <DraftPlan year={year} label="Your care team" replace={false} />
                </div>
              ) : (
                "Someone who manages this area drafts the plan."
              )}
            </EmptyState>
          </Card>
        ) : (
          <>
            <Card
              title={
                <>
                  {year} {plan.status === "approved" ? <Badge tone="success">Approved</Badge> : <Badge tone="warning">Draft: not approved</Badge>}
                </>
              }
              description={plan.status === "approved" ? `Approved ${dayLine((plan.approvedAt ?? "").slice(0, 10))}. Editing it returns it to draft.` : "A draft runs nothing. Approve it when it is ready."}
              actions={
                plan.canManage ? (
                  <Link href={`/care/plan?year=${year}&edit=1`} className={buttonClass("ghost", "xs")}>
                    Edit
                  </Link>
                ) : undefined
              }
            >
              {plan.summary ? <p className="m-0 text-[14px] text-ink-2">{plan.summary}</p> : null}
              {plan.canManage && plan.status === "draft" ? (
                <div className="mt-3">
                  <ApprovePlan year={year} />
                </div>
              ) : null}
            </Card>
            {upcoming.length > 0 ? (
              <Card title="Coming up in the next 30 days">
                <ul className="m-0 list-none p-0">
                  {upcoming.map((i) => (
                    <li key={i.id} className="border-b border-line-soft py-2 last:border-b-0">
                      <span className="font-semibold text-ink">{dayLine(i.on)}</span> · {i.title}
                      <div className="text-[12.5px] text-muted">{itemLine(i)}</div>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            {byMonth(plan.items).map(([month, items]) => (
              <Card key={month} title={month}>
                <ul className="m-0 list-none p-0">
                  {items.map((i) => (
                    <li key={i.id} className="border-b border-line-soft py-2 last:border-b-0" data-moment={i.id}>
                      <span className="font-semibold text-ink">{dayLine(i.on)}</span> · {i.title}
                      <div className="text-[12.5px] text-muted">{itemLine(i)}</div>
                      {i.note ? <div className="text-[13px] text-ink-2">{i.note}</div> : null}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
            {plan.canManage ? <DraftPlan year={year} label="Your care team" replace /> : null}
          </>
        )}
      </div>
    </>
  );
}
