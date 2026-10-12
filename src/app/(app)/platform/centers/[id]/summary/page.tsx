import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AskNiva } from "@/components/niva/ask-niva";
import { BlockGrid, Card, DefinitionList, EmptyState, PageHeader, QueryError, StatusText } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { experienceLabel } from "@/lib/experiences";
import { loadExperiences } from "@/lib/experiences-db";
import { reportReads } from "@/lib/reports/load";
import { communityStatusWords, goLiveWords, NONPROFIT_WORDS, recordingWords, summaryWords } from "@/lib/reports/platform-words";
import { isUuid } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { PlatformNoAccess } from "../../../platform-no-access";

export const metadata: Metadata = { title: "Community summary · Platform" };

/** Platform › one community › Summary: the one page the team reads to know where a community stands (migration 0673). */
export default async function PlatformCommunitySummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const session = await getSession();
  if (!session.isPlatformAdmin) {
    return (
      <>
        <PageHeader title="Platform" />
        <PlatformNoAccess />
      </>
    );
  }
  const { db } = session;
  const tz = session.center.time_zone;
  const res = await reportReads.communitySummary(db, id);
  if (!res.ok) {
    console.error("[platform] could not read the community summary:", res.error);
    return (
      <>
        <PageHeader title="Platform" />
        <QueryError what="the community summary" error={res.error} retryHref={`/platform/centers/${id}/summary`} />
      </>
    );
  }
  if (!res.value) notFound();
  const s = res.value;
  const kinds = await loadExperiences(db);
  const kind = kinds.status === "ok" ? experienceLabel(kinds.experiences, s.community.kind) : s.community.kind;
  const words = summaryWords(s, kind);
  const failing = s.readiness?.failing ?? [];

  return (
    <>
      <PageHeader
        title={s.community.name}
        eyebrow={
          <Link href="/platform" className="crm-link">
            ← Platform
          </Link>
        }
        description={`${s.community.environment === "sandbox" ? "Sandbox" : "Community"} · ${kind} · ${communityStatusWords(s.community.status)}`}
        actions={
          <>
            <AskNiva prompt={`Summarise the community with address ${s.community.slug}.`} label="Summarise with Niva" />
            <Link href={`/platform/centers/${id}`} className="crm-link text-[13px] font-semibold">
              Limits &amp; addresses
            </Link>
          </>
        }
      />
      <Card title="In short" className="mb-4">
        <ul className="list-disc pl-5 text-sm">
          {words.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </Card>
      <BlockGrid className="mb-4">
        <Card span={6} title="Size">
          <DefinitionList
            items={[
              { label: "Households", value: s.size.households.toLocaleString() },
              { label: "People", value: s.size.people.toLocaleString() },
              { label: "Signed-in accounts", value: s.size.signedInAccounts.toLocaleString() },
              { label: "Active memberships", value: s.size.activeMemberships.toLocaleString() },
              { label: "Portal addresses", value: s.portalAddresses.toLocaleString() },
              { label: "Last staff activity", value: s.lastStaffActivityAt ? formatDateTime(s.lastStaffActivityAt, tz) : "—" },
            ]}
          />
        </Card>
        <Card span={6} title="Where it stands">
          <DefinitionList
            items={[
              { label: "Setup", value: s.setup ? `${s.setup.done} of ${s.setup.total} required steps` : "Could not be read" },
              { label: "Go-live checks", value: s.readiness ? `${s.readiness.passing} of ${s.readiness.total} pass` : "Could not be run" },
              { label: "Go-live request", value: s.goLive ? goLiveWords(s.goLive) : "None yet" },
              { label: "Nonprofit papers", value: s.verification ? (NONPROFIT_WORDS[s.verification.status] ?? s.verification.status) : "—" },
              { label: "Owner", value: s.community.owner ?? "—" },
              { label: "Created", value: s.community.createdAt ? formatDate(s.community.createdAt, tz) : "—" },
            ]}
          />
        </Card>
      </BlockGrid>
      <BlockGrid className="mb-4">
        <Card span={6} title="Go-live checks that do not pass">
          {failing.length === 0 ? (
            <EmptyState title={s.readiness ? "Every go-live check passes" : "The checks could not be run"} />
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {failing.map((f) => (
                <li key={f.check}>
                  <StatusText tone="warn">{f.check}</StatusText>
                  <p className="text-[13px] text-muted">{f.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card span={6} title="Consent states">
          <DefinitionList
            items={[
              { label: "Recording how the portal is used", value: recordingWords(s.consent.activityRecording) },
              { label: "Shared with Weaver", value: s.consent.sharesWithWeaver ? "Yes" : "No" },
              { label: "Support access", value: s.consent.supportAccessUntil ? `Open until ${formatDate(s.consent.supportAccessUntil, tz)}` : "None open" },
              { label: "Niva actions switched on", value: s.consent.nivaActionsSwitchedOn.toLocaleString() },
              { label: "Modules switched off", value: s.modulesOff.length > 0 ? s.modulesOff.join(", ") : "None" },
              { label: "Ways to pay", value: s.waysToPay.length > 0 ? s.waysToPay.join(", ") : "None accepted" },
            ]}
          />
        </Card>
      </BlockGrid>
    </>
  );
}
