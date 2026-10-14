import type { Metadata } from "next";
import Link from "next/link";

import { Card, EmptyState, QueryError, buttonClass } from "@/components/ui";
import { param, type RawSearchParams } from "@/lib/search-params";
import { loadCommunityLocale } from "@/lib/community-locale";
import { getSession } from "@/lib/session";

import { SetupHeader, setupGate } from "../../_components/setup-ui";
import { loadStoredDraft } from "../draft-load";
import { ApprovePage } from "./approve-page";
import { SitePreview } from "./site-preview";

// A private page: it is for the people who manage settings, it sits in the portal (never on the public website's address), and
// search engines are told to stay away from it.
export const metadata: Metadata = { title: "Website draft preview · Setup", robots: { index: false, follow: false, nocache: true } };

const SUB = "a private preview of your first website draft · nothing here is published";
const BASE = "/setup/website/preview";

export default async function WebsiteDraftPreviewPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const gate = setupGate(session, SUB, "The website draft preview");
  if (gate) return gate;
  const sp = await searchParams;
  const loaded = await loadStoredDraft(session.db, session.center.id, true, "load your website draft");
  const community = await loadCommunityLocale(session.db, session.center);
  const back = (
    <Link href="/setup/website" className={buttonClass("ghost")}>
      Back to Your website
    </Link>
  );
  if (!loaded.ok) {
    return (
      <>
        <SetupHeader session={session} sub={SUB} actions={back} />
        <QueryError what="your website draft" error={loaded.cause} retryHref={BASE} />
      </>
    );
  }
  const draft = loaded.draft;
  if (!draft || draft.pages.length === 0) {
    return (
      <>
        <SetupHeader session={session} sub={SUB} actions={back} />
        <EmptyState title="There is no website draft yet">
          Look at your website first, then press Build my first draft on <Link href="/setup/website" className="font-semibold underline">Your website</Link>.
        </EmptyState>
      </>
    );
  }

  const wanted = param(sp, "page");
  const page = draft.pages.find((p) => p.slug === wanted) ?? draft.pages[0]!;
  const standIns = page.blocks.filter((b) => b.needs_text).length;

  return (
    <>
      <SetupHeader session={session} sub={SUB} actions={back} />
      <div className="flex flex-col gap-4">
        <Card title="Private preview" description="This is how your first draft looks. Only people who manage settings can see it, and search engines are told to stay away. Nothing has been published.">
          <div className="flex flex-col gap-3 text-[13px] text-muted">
            <ul className="flex flex-wrap gap-2" aria-label="Pages of the draft">
              {draft.pages.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`${BASE}?page=${encodeURIComponent(p.slug)}`}
                    aria-current={p.slug === page.slug ? "page" : undefined}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-semibold ${p.slug === page.slug ? "border-navy bg-navy-50 text-navy" : "border-line bg-card text-ink-2"}`}
                  >
                    {p.title}
                    <span className={p.status === "approved" ? "text-success-900" : "text-faint"}>{p.status === "approved" ? "· approved" : "· draft"}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p>
              Each part says where its words came from: <strong className="text-navy">your old website</strong> (with the old page),{" "}
              <strong className="text-success-900">Weaver&apos;s records</strong>, or <strong className="text-brown">a short stand-in Weaver wrote</strong> for you to replace.
            </p>
          </div>
        </Card>
        <SitePreview draft={draft} page={page} basePath={BASE} locale={community.locale} />
        <Card title="Approve this page">
          <ApprovePage key={page.id} pageId={page.id} title={page.title} initial={page.status} standIns={standIns} />
        </Card>
      </div>
    </>
  );
}
