import type { Metadata } from "next";
import Link from "next/link";

import { Alert, KpiGrid, PageHeader, Stat, buttonClass } from "@/components/ui";
import { NOT_ENOUGH, canCompareYears, compareNote, percent, perAskLine, retentionLine } from "@/lib/care/health";
import { NO_ACCESS } from "@/lib/care/model";
import { medianLine, onTimeLine } from "@/lib/care/thanks";
import { loadCareDashboard } from "@/lib/data/care";
import { kindName } from "@/lib/kind";
import { careCan } from "@/lib/permissions";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard" };

// The organization's own numbers (DonorDelight slice 4): how many households it keeps, how fast it says thank you, and how its personal
// touches balance with its asks. Counts only: no household, no name and no amount. For care.view and care.manage; a relationship owner
// (care.own) sees households, not the totals. The database decides (app.care_dashboard, 0885: no platform-admin branch) and logs the read.
// A number that compares two years says "Not enough yet" until Weaver holds about two years of records, instead of a figure that misleads.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6" aria-label={title}>
      <h2 className="m-0 mb-2 font-display text-[18px] font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default async function CareDashboardPage() {
  const session = await getSession();
  const label = kindName(session.kind, "care", "DonorDelight");
  const header = (
    <PageHeader
      title={`${label}: dashboard`}
      description="How well the organization keeps, thanks and cares for its households. Counts only: no names and no amounts."
    />
  );
  const card = (title: string, body?: string) => (
    <>
      {header}
      <div className="cc-card px-6 py-10 text-center">
        <p className="font-display text-[22px] font-semibold text-ink">{title}</p>
        {body ? <p className="mx-auto mt-2 max-w-lg text-[13px] text-muted">{body}</p> : null}
      </div>
    </>
  );

  if (!careCan(session, "view")) {
    return card(NO_ACCESS, `The organization's numbers are open to roles that see every household in ${label}. Ask your organization's owner or care lead.`);
  }

  const res = await loadCareDashboard(session);
  if (res.status === "no_access") return card(NO_ACCESS);
  if (res.status === "off") return card(res.message);
  if (res.status === "error") {
    return (
      <>
        {header}
        <Alert
          tone="danger"
          title="Could not load the dashboard"
          action={
            <a href="/care/dashboard" className={buttonClass("bad", "xs")}>
              Try again
            </a>
          }
        >
          {res.error.charAt(0).toUpperCase() + res.error.slice(1).replace(/\.?$/, ".")}
        </Alert>
      </>
    );
  }

  const d = res.data;
  const compare = canCompareYears(d.historyMonths);
  const note = compare ? null : compareNote(d.historyMonths);
  const canManage = careCan(session, "manage");

  return (
    <>
      {header}

      <Section title="Keeping households">
        {d.giving ? (
          <KpiGrid cols={4}>
            <Stat
              label="Households that gave"
              value={d.giving.donorsLast}
              hint={compare ? `${d.giving.donorsPrev} in the 12 months before` : "In the last 12 months"}
            />
            <Stat
              label="Kept from last year"
              value={retentionLine(d.giving.retention, d.historyMonths)}
              hint={note ?? `${d.giving.kept} of ${d.giving.donorsPrev} households that gave the year before`}
              tone={compare && d.giving.retention !== null && d.giving.retention < 0.5 ? "brown" : "navy"}
            />
            <Stat
              label="Gave last year, not this"
              value={compare ? d.giving.lybunt : NOT_ENOUGH}
              hint={note ?? `${d.giving.sybunt} gave in some earlier year and not in the last 12 months`}
              tone={compare && d.giving.lybunt > 0 ? "brown" : "navy"}
            />
            <Stat
              label="New last year, giving again"
              value={compare ? (percent(d.giving.firstYear.rate) ?? "No new households") : NOT_ENOUGH}
              hint={note ?? `${d.giving.firstYear.kept} of ${d.giving.firstYear.cohort} households whose first gift was the year before`}
            />
          </KpiGrid>
        ) : (
          <p className="m-0 text-[13.5px] text-muted">Giving is off, so there are no gift numbers here. Turn Giving on in Settings › Modules to see them.</p>
        )}
      </Section>

      <Section title="Saying thank you">
        {d.thanks ? (
          <KpiGrid cols={4}>
            <Stat label="Thanked on time" value={onTimeLine(d.thanks.onTimeShare) ?? NOT_ENOUGH} hint="Gifts of the last 90 days" />
            <Stat label="Time to thank" value={medianLine(d.thanks.medianHours) ?? NOT_ENOUGH} hint="Typical, from the gift" />
            <Stat
              label="To thank now"
              value={d.thanks.open}
              hint={d.thanks.overdue > 0 ? `${d.thanks.overdue} overdue` : "None overdue"}
              tone={d.thanks.overdue > 0 ? "brown" : "navy"}
              href="/care/thanks"
            />
            <Stat label="Gifts thanked" value={`${d.thanks.thanked} of ${d.thanks.gifts}`} hint="Gifts of the last 90 days" />
          </KpiGrid>
        ) : d.giving ? (
          <p className="m-0 text-[13.5px] text-muted">
            Thank-you speed shows once the thank-you rules are chosen.{" "}
            {canManage ? (
              <Link href="/care/settings" className="crm-link font-semibold">
                Choose how gifts are thanked
              </Link>
            ) : (
              "Someone who manages care chooses them."
            )}
          </p>
        ) : (
          <p className="m-0 text-[13.5px] text-muted">Giving is off, so there are no gifts to thank.</p>
        )}
      </Section>

      <Section title="Caring beyond the ask">
        <KpiGrid cols={4}>
          <Stat
            label="Care for each ask"
            value={d.touches.perAsk === null ? NOT_ENOUGH : d.touches.perAsk.toFixed(1)}
            hint={d.touches.perAsk === null ? "No ask recorded in the last 12 months" : perAskLine(d.touches.perAsk)}
            tone={d.touches.perAsk !== null && d.touches.perAsk < 3 ? "brown" : "navy"}
          />
          <Stat label="No-ask touches" value={d.touches.noAsk} hint="Personal touches in the last 12 months" />
          <Stat label="Asks" value={d.touches.asks} hint="Personal touches that asked, in the last 12 months" />
          <Stat
            label="Key households with an owner"
            value={percent(d.key.share) ?? "No key households yet"}
            hint={`${d.key.withOwner} of ${d.key.households} have a relationship owner`}
            tone={d.key.share !== null && d.key.share < 1 ? "brown" : "navy"}
            href={d.key.share !== null && d.key.share < 1 ? "/care?show=needs_owner" : undefined}
          />
        </KpiGrid>
        <p className="m-0 mt-2 text-[12.5px] text-muted">
          A key household gave in the last 24 months or has a care profile. Aim for three or more no-ask touches for every ask. Each household&apos;s own sign
          and the reasons behind it are on its card and in the{" "}
          <Link href="/care" className="crm-link font-semibold">
            Households list
          </Link>
          .
        </p>
      </Section>
    </>
  );
}
