import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Badge, Card, ChipLinks, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { ApproachSettingsForm, EnableApproach, QuietPeriods, UsesAndDoesNotUse } from "@/components/care/approach-controls";
import { holdLine, listLine, rangeLine, signalLines, type ApproachRow } from "@/lib/care/approach";
import { NO_ACCESS, formatDay, householdLine } from "@/lib/care/model";
import { communityFormat, moneyExample } from "@/lib/community-format";
import { loadApproach, loadApproachSettings, seesCare } from "@/lib/data/care";
import { kindName } from "@/lib/kind";
import { hrefWith, isUuid, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Who to approach" };

// Who to approach (DonorDelight slice 7): the households an organization could ask, ranked with the reasons, HELD behind the touch balance. A household is
// ready only when nothing holds it: enough touches with no ask since the last ask, not resting after an ask, nothing unthanked, no pledge far behind, no
// quiet period. A household that asked not to be asked is counted, never named or explained. A range comes only from the household's own gifts and only
// for someone who may see amounts. It is off until a care manager has read what it uses and never uses, and it asks nobody: it orders a list for a person
// to read. A relationship owner sees only their own households. The database decides (app.care_approach, 0895: no platform-admin branch) and logs the read.

function Row({ r, money, today }: { r: ApproachRow; money: (c: number) => string; today: string }) {
  const range = rangeLine(r.range, money);
  const reasons = r.state === "ready" ? signalLines(r.signals) : r.holds.map(holdLine);
  return (
    <li className="flex flex-col gap-1.5 border-b border-line-soft px-4 py-3 last:border-b-0 md:flex-row md:items-start md:justify-between md:gap-6" data-household={r.household.id}>
      <div className="min-w-0">
        <Link href={`/households/${r.household.id}`} className="crm-link font-semibold">
          {r.household.name}
        </Link>
        <div className="text-[12px] text-muted">{householdLine(r.household)}</div>
        <ul className="m-0 mt-1.5 list-disc pl-5 text-[13.5px] text-ink-2">
          {reasons.map((l) => (
            <li key={l}>{l}</li>
          ))}
          {r.state === "ready" && r.holds.length === 0 ? <li>{r.noAskSince} {r.noAskSince === 1 ? "touch" : "touches"} with no ask since the last ask</li> : null}
        </ul>
        {r.state === "held" && r.score > 0 ? <div className="mt-1 text-[12.5px] text-muted">Score {r.score}, once nothing holds them.</div> : null}
        {range ? <div className="mt-1 text-[13px] text-ink">If you do ask: {range}</div> : null}
      </div>
      <div className="flex flex-col items-start gap-1 md:items-end">
        {r.state === "ready" ? <Badge tone="success">Score {r.score}</Badge> : <Badge tone="warning">Held</Badge>}
        <span className="text-[12.5px] text-muted">{r.lastGiftOn ? `Last gift ${formatDay(r.lastGiftOn)}` : ""}</span>
        <span className="text-[12.5px] text-muted">{r.lastAskOn ? `Last ask ${formatDay(r.lastAskOn)}` : "Never asked"}</span>
        <span className="text-[12.5px] text-muted">{r.owner ? `Owner: ${r.owner}` : "Needs an owner"}</span>
        <Link href={`/households/${r.household.id}`} className={buttonClass("ghost", "xs")}>
          Open the Care card
        </Link>
      </div>
      <span className="sr-only">{today}</span>
    </li>
  );
}

export default async function ApproachPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const sp = await searchParams;
  const label = kindName(session.kind, "care", "DonorDelight");
  const header = <PageHeader title={`${label}: who to approach`} description="Households you could ask, ranked with the reasons, and held until the relationship is ready. It orders a list for you to read; it asks nobody." />;
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

  const fundParam = param(sp, "fund");
  const fund = fundParam && isUuid(fundParam) ? fundParam : null;
  const [read, settingsRead] = await Promise.all([loadApproach(session, fund), loadApproachSettings(session)]);
  if (read.status === "no_access") return card(NO_ACCESS);
  if (read.status === "off") return card(read.message);
  if (read.status === "error") {
    return (
      <>
        {header}
        <Alert
          tone="danger"
          title="Could not load who to approach"
          action={
            <a href={hrefWith("/care/approach", sp, {})} className={buttonClass("bad", "xs")}>
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
  const settings = settingsRead.status === "ok" ? settingsRead.data : null;
  const fmt = communityFormat(session.center);
  const money = (c: number) => moneyExample(c, fmt);

  if (data.state === "giving_off") return card("Giving is off, so there are no gifts to rank.", "Turn Giving on in Settings › Modules to use this list.");
  if (data.state === "off") {
    return (
      <>
        {header}
        <Card title="Who to approach is off" description="It stays off until someone who manages this area has read what it uses and never uses.">
          <div className="flex flex-col gap-4">
            <UsesAndDoesNotUse />
            {data.canManage ? <EnableApproach enabled={false} /> : <p className="m-0 text-[13.5px] text-muted">Someone who manages this area turns it on.</p>}
          </div>
        </Card>
      </>
    );
  }

  const chips = [
    { key: "all", label: "All funds", href: hrefWith("/care/approach", sp, { fund: null }) },
    ...data.funds.map((f) => ({ key: f.id, label: f.name, href: hrefWith("/care/approach", sp, { fund: f.id }) })),
  ];
  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        <p className="m-0 text-[15px] font-semibold text-ink" role="status">
          {listLine(data)}
        </p>
        {!data.all ? <p className="m-0 text-[13px] text-muted">You see only the households you own or back up.</p> : null}
        {data.funds.length > 0 ? <ChipLinks label="Fund" items={chips} active={data.fund ?? "all"} /> : null}
        <Card title="Ready" description={`Enough touches with no ask since the last ask (${data.touchBalance} needed), not resting, nothing unthanked.`} padded={false}>
          {data.ready.length === 0 ? (
            <EmptyState title="Nobody is ready for an ask right now.">Keep caring: the households below become ready as the touches with no ask add up.</EmptyState>
          ) : (
            <ul className="m-0 list-none p-0">
              {data.ready.map((r) => (
                <Row key={r.household.id} r={r} money={money} today={data.today} />
              ))}
            </ul>
          )}
        </Card>
        <Card title="Held" description="Not yet, and why. Each reason is something to do first." padded={false}>
          {data.held.length === 0 ? (
            <EmptyState title="Nobody is held." />
          ) : (
            <ul className="m-0 list-none p-0">
              {data.held.map((r) => (
                <Row key={r.household.id} r={r} money={money} today={data.today} />
              ))}
            </ul>
          )}
        </Card>
        {data.notShown > 0 ? (
          <p className="m-0 text-[13px] text-muted">
            {data.notShown} {data.notShown === 1 ? "household is" : "households are"} not shown.
          </p>
        ) : null}
        {settings ? (
          <details className="cc-card px-[18px] py-4">
            <summary className="cursor-pointer text-[15px] font-bold text-ink">How it works and what you can change</summary>
            <div className="mt-4 flex flex-col gap-5">
              <UsesAndDoesNotUse />
              <ApproachSettingsForm initial={settings} />
              <div>
                <h3 className="m-0 mb-1 text-[13px] font-bold uppercase tracking-wide text-muted">Quiet periods</h3>
                <QuietPeriods initial={settings} />
              </div>
              {settings.canManage ? (
                <div>
                  <h3 className="m-0 mb-1 text-[13px] font-bold uppercase tracking-wide text-muted">Turn it off</h3>
                  <EnableApproach enabled />
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </>
  );
}
