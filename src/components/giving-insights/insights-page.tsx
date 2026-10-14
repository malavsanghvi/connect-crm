import { Alert, Card, ChipLinks, KpiGrid, NoAccess, PageHeader, Stat } from "@/components/ui";
import type { InsightsPage } from "@/lib/data/giving-insights";
import type { CategoryBlock, CategoryLine, InsightsView } from "@/lib/giving-insights/view";

// Giving › Insights (New look; B98 slice 1, docs/GIVING_INSIGHTS.md section 3.1): the community's own giving numbers, read
// only. No list of households, no score, nothing about a person (section 5). Money is in the community's currency.

export function InsightsScreen({ page }: { page: InsightsPage }) {
  const header = <PageHeader title="Insights" description="The community's giving, added up: read only, no names." />;
  if (page.state === "no_access") {
    return (
      <>
        {header}
        <NoAccess area="Giving insights" access="paymentsAll" />
      </>
    );
  }
  if (page.state === "off") {
    return (
      <>
        {header}
        <Alert tone="info" title="The Insights module is switched off for this community.">
          A community administrator can switch it on in Settings › Modules.
        </Alert>
      </>
    );
  }
  const chips = <ChipLinks label="Year" active={String(page.year)} items={page.years.map((y) => ({ key: String(y.year), label: y.label, href: y.href }))} />;
  if (page.state === "error") {
    return (
      <>
        {header}
        {chips}
        <Alert tone="danger" title="Could not load the giving insights">
          {page.error}
        </Alert>
      </>
    );
  }
  return (
    <>
      {header}
      {chips}
      {page.notice ? (
        <div className="mb-3">
          <Alert tone="warning">{page.notice}</Alert>
        </div>
      ) : null}
      <InsightsBody view={page.view} />
    </>
  );
}

export function InsightsBody({ view }: { view: InsightsView }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[13px] text-muted">{view.period}</p>
      <KpiGrid cols={3}>
        {view.figures.map((f) => (
          <Stat key={f.label} label={f.label} value={f.value} hint={f.hint ?? undefined} />
        ))}
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Who kept giving" description={view.retention.note}>
          <dl className="m-0 grid grid-cols-2 gap-3">
            <Count label="Kept" value={view.retention.kept} hint="Gave last year and this year" />
            <Count label={view.retention.lostWord} value={view.retention.lost} hint="Gave last year, not this year" />
            <Count label="New" value={view.retention.new} hint="A first gift ever" />
            <Count label="Came back" value={view.retention.regained} hint="Gave before last year, not last year" />
          </dl>
          <p className="m-0 mt-3 text-[13px] text-ink">{view.retention.rate ? `${view.retention.rate} of last year's givers gave again.` : "Nobody gave last year, so there is no retention rate yet."}</p>
          <p className="m-0 mt-2 text-[13px] text-muted">{view.concentration}</p>
        </Card>

        <Card title="Pledges" description={view.pledges.fulfilment ? `${view.pledges.fulfilment} of what was pledged this year is paid` : "Pledges made in the year"}>
          {view.pledges.lines.map((l) => (
            <p key={l} className="m-0 text-[13px] text-ink">
              {l}
            </p>
          ))}
          <table className="mt-3 w-full text-[13px]">
            <caption className="sr-only">Open pledges by how late they are</caption>
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 font-semibold">Open pledges</th>
                <th className="py-1 text-right font-semibold">Pledges</th>
                <th className="py-1 text-right font-semibold">Still owed</th>
              </tr>
            </thead>
            <tbody>
              {view.pledges.ageing.map((a) => (
                <tr key={a.label} className="border-t border-line">
                  <td className="py-1.5">{a.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{a.pledges.toLocaleString("en-US")}</td>
                  <td className="py-1.5 text-right tabular-nums">{a.open}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {view.categories.map((b) => (
          <CategoryCard key={b.key} block={b} />
        ))}
        <Card title="Not in a category" description="Gifts not applied to any pledge">
          <Lines lines={[view.noCategory]} />
        </Card>
      </div>

      <Card title="Month by month" description={view.peak ?? "No giving yet in this year."}>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {view.months.map((m) => (
            <li key={m.label} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-[13px]">
              <span className="text-muted">{m.label}</span>
              <span className="flex flex-col gap-0.5" aria-hidden>
                <span className="h-2 rounded-full bg-navy" style={{ width: `${m.bar}%` }} />
                <span className="h-1.5 rounded-full bg-line" style={{ width: `${m.barBefore}%` }} />
              </span>
              <span className="text-right tabular-nums">
                {m.now}
                <span className="sr-only"> (last year {m.before})</span>
                <span aria-hidden className="block text-[11.5px] text-muted">
                  last year {m.before}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="What is still to come" description="Open pledges by the month they are due (no due date: 30 days after the pledge)">
          <p className="m-0 text-[13px] text-ink">{view.pipeline.overdue}</p>
          {view.pipeline.months.length > 0 ? (
            <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-[13px]">
              {view.pipeline.months.map((m) => (
                <li key={m.label} className="flex justify-between gap-2 border-t border-line py-1.5">
                  <span>{m.label}</span>
                  <span className="tabular-nums">
                    {m.open} · {m.pledges.toLocaleString("en-US")} {m.pledges === 1 ? "pledge" : "pledges"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 mt-2 text-[13px] text-muted">No open pledge falls due in the next twelve months.</p>
          )}
          {view.pipeline.later ? <p className="m-0 mt-2 text-[13px] text-muted">{view.pipeline.later}</p> : null}
        </Card>

        <Card title="Against your goals" description="Campaigns with a goal of their own">
          {view.goals.length === 0 ? (
            <p className="m-0 text-[13px] text-muted">No campaign in this year has a goal, so there is no target to show.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {view.goals.map((g) => (
                <li key={g.label} className="text-[13px]">
                  <p className="m-0 font-bold text-ink">{g.label}</p>
                  <div className="mt-1 h-2 rounded-full bg-line" aria-hidden>
                    <div className="h-2 rounded-full bg-success" style={{ width: `${g.raisedPercent}%` }} />
                  </div>
                  <p className="m-0 mt-1 text-ink">{g.line}</p>
                  {g.paceText ? <p className="m-0 text-muted">{g.paceText}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {view.recurring || view.fees ? (
        <Card title="Also">
          {view.recurring ? <p className="m-0 text-[13px] text-ink">{view.recurring}</p> : null}
          {view.fees ? <p className="m-0 mt-1 text-[13px] text-muted">{view.fees}</p> : null}
        </Card>
      ) : null}
    </div>
  );
}

function Count({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-[12px] border border-line bg-white px-3 py-2">
      <dt className="text-[12px] font-bold text-muted">{label}</dt>
      <dd className="m-0 font-display text-[24px] font-semibold text-ink">{value.toLocaleString("en-US")}</dd>
      <dd className="m-0 text-[11.5px] text-muted">{hint}</dd>
    </div>
  );
}

function CategoryCard({ block }: { block: CategoryBlock }) {
  return (
    <Card title={block.title} description="This year against the same point last year">
      {block.lines.length === 0 ? <p className="m-0 text-[13px] text-muted">{block.empty}</p> : <Lines lines={block.lines} />}
    </Card>
  );
}

function Lines({ lines }: { lines: CategoryLine[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {lines.map((l) => (
        <li key={l.label} className="text-[13px]">
          <div className="flex justify-between gap-2">
            <span className="min-w-0 truncate text-ink">{l.label}</span>
            <span className="flex-none tabular-nums text-ink">
              {l.now}
              {l.change ? <span className="ml-1.5 text-muted">{l.change}</span> : null}
            </span>
          </div>
          {l.bar > 0 ? (
            <div className="mt-1 h-1.5 rounded-full bg-line" aria-hidden>
              <div className="h-1.5 rounded-full bg-navy" style={{ width: `${l.bar}%` }} />
            </div>
          ) : null}
          <p className="m-0 text-[11.5px] text-muted">Last year {l.before}</p>
        </li>
      ))}
    </ul>
  );
}
