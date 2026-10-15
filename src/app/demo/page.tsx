import type { Metadata } from "next";
import Link from "next/link";

import { LogoTile } from "@/components/brand/logo";
import { DemoLeaveButton } from "@/components/demo-leave";
import { SetupScreen } from "@/components/setup-screen";
import { Alert } from "@/components/ui";
import { GENEROSITY_LINE, PRODUCT_NAME } from "@/lib/brand";
import {
  DEMO_KINDS,
  DEMO_SESSION_HOURS,
  KIND_BLURB,
  KIND_LABEL,
  endedNotice,
  isDemoClaims,
  peopleByArea,
  type DemoCommunity,
  type DemoKind,
} from "@/lib/demo-signin/rules";
import { loadDemoBanner, loadDemoChoices } from "@/lib/demo-signin/server";
import { readPublicEnv } from "@/lib/env";
import { memberAppDemoUrl } from "@/lib/site";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { PersonaCard } from "./persona-card";

export const metadata: Metadata = { title: "Try the demo" };
// The people to choose from and the switch come from the database, so this page is never built ahead of time.
export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Public: choose a kind of community, then a demo person, and explore as them. No code, no e-mail, nothing real. */
export default async function DemoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const check = readPublicEnv();
  if (!check.ok) return <SetupScreen problems={check.problems} />;
  const sp = await searchParams;
  const notice = endedNotice(first(sp.ended));

  // Who is looking: nobody, a person who works in a real community, or someone already in a demo.
  let signedInAs: string | null = null;
  let inDemoAs: string | null = null;
  try {
    const db = await createSupabaseServerClient();
    const { data } = await db.auth.getClaims();
    const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
    if (isDemoClaims(data?.claims)) {
      const info = await loadDemoBanner(db);
      inDemoAs = info ? (info.role ? `${info.name}, ${info.role}` : info.name) : null;
    } else if (email) {
      signedInAs = email;
    }
  } catch (error) {
    console.error("[demo] could not read who is signed in (showing the page as for a visitor):", error);
  }

  const loaded = await loadDemoChoices();
  const choices = loaded.ok ? loaded.choices : null;
  const wanted = first(sp.kind);
  const available = (choices?.communities ?? []).map((c) => c.kind);
  const kind: DemoKind | null = (DEMO_KINDS as readonly string[]).includes(wanted ?? "") && available.includes(wanted as DemoKind)
    ? (wanted as DemoKind)
    : (available[0] ?? null);
  const community: DemoCommunity | undefined = choices?.communities.find((c) => c.kind === kind);

  return (
    <main className="min-h-screen bg-canvas">
      <header className="bg-navy px-6 py-8 text-white sm:px-12">
        <div className="mx-auto flex max-w-[1040px] flex-col gap-3">
          <div className="flex items-center gap-3">
            <LogoTile size={48} />
            <p className="text-[13px] font-semibold uppercase tracking-wide text-navy-200">
              {PRODUCT_NAME} · {GENEROSITY_LINE}
            </p>
          </div>
          <h1 className="font-display text-[32px] font-semibold leading-[1.15] sm:text-[38px]">Try the demo</h1>
          <p className="max-w-[640px] text-base leading-normal text-navy-200">
            Experience {PRODUCT_NAME} in less than a minute, as the people who use it every day: choose a community, choose who to be, press Start. Everything in it is invented: no
            message is ever sent, payments are only for practice, and the demo starts over every night.
          </p>
          <p className="max-w-[640px] text-[14px] leading-normal text-navy-200">
            Want to see the app members use on their phones instead?{" "}
            <a href={memberAppDemoUrl()} className="font-bold text-white underline underline-offset-2" data-testid="demo-member-app">
              Try the member app in your browser
            </a>
            , with nothing to install.
          </p>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1040px] flex-col gap-5 px-6 py-8 sm:px-12">
        {notice ? <Alert tone="info">{notice}</Alert> : null}
        {inDemoAs ? (
          <Alert tone="info" title={`You are in the demo as ${inDemoAs}`}>
            Pick another person below to switch, or <DemoLeaveButton />.{" "}
            <Link href="/" className="font-bold underline underline-offset-2">
              Back to the demo
            </Link>
          </Alert>
        ) : null}
        {signedInAs ? (
          <Alert tone="warning" title={`You are signed in as ${signedInAs}`}>
            Starting the demo signs you out in this browser first. Afterwards, sign in again with your own email.
          </Alert>
        ) : null}

        {!loaded.ok ? (
          <Alert
            tone="danger"
            title="Could not load the demo"
            action={
              <a href="/demo" className="font-bold underline underline-offset-2">
                Try again
              </a>
            }
          >
            {loaded.error}
          </Alert>
        ) : !choices?.enabled ? (
          <Alert tone="info" title="The demo is switched off right now">
            Please try again later. If you were given a link to try {PRODUCT_NAME}, ask the person who sent it.
          </Alert>
        ) : choices.communities.length === 0 || !community || !kind ? (
          <Alert tone="info" title="The demo is not ready yet">
            It has not been set up. Please try again later.
          </Alert>
        ) : (
          <>
            <section aria-labelledby="demo-kind">
              <h2 id="demo-kind" className="font-display text-[22px] font-semibold text-ink">
                1 · Choose a community
              </h2>
              <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {choices.communities.map((c) => {
                  const selected = c.kind === kind;
                  return (
                    <li key={c.kind}>
                      <Link
                        href={`/demo?kind=${c.kind}`}
                        scroll={false}
                        aria-current={selected ? "true" : undefined}
                        className={`block rounded-2xl border-2 p-4 no-underline ${selected ? "border-navy bg-navy-50" : "border-line bg-white hover:border-navy/50"}`}
                      >
                        <span className="block text-[12px] font-bold uppercase tracking-wide text-navy">{KIND_LABEL[c.kind]}</span>
                        <span className="mt-1 block font-display text-[20px] font-semibold text-ink">{c.name}</span>
                        <span className="mt-1 block text-[14px] text-muted">{KIND_BLURB[c.kind]}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section aria-labelledby="demo-person">
              <h2 id="demo-person" className="font-display text-[22px] font-semibold text-ink">
                2 · Choose who to be in {community.name}
              </h2>
              <p className="mt-1 text-[14px] text-muted">
                Choose one person and press Start to open {PRODUCT_NAME} as them; your demo lasts {DEMO_SESSION_HOURS} hours.
              </p>
              {peopleByArea(community).map((group) => (
                <div key={group.area} className="mt-5" role="group" aria-labelledby={`demo-area-${group.area}`} data-testid={`demo-area-${group.area}`}>
                  <h3 id={`demo-area-${group.area}`} className="font-display text-[18px] font-semibold text-ink">
                    {group.label}
                  </h3>
                  <p className="mt-0.5 text-[13px] text-muted">{group.blurb}</p>
                  <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {group.people.map((p) => (
                      <PersonaCard key={p.id} person={p} />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          </>
        )}

        <p className="text-[13px] text-muted">
          Want your own community instead?{" "}
          <Link href="/request-access" className="crm-link font-semibold">
            Request access
          </Link>
          . Already have an account?{" "}
          <Link href="/login" className="crm-link font-semibold">
            Sign in
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
