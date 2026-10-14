import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AiTag } from "@/components/brand/ai-tag";
import { OWNER_FACTS } from "@/components/site/facts";
import { Icon, type IconName } from "@/components/brand/icons";
import { ExperienceBand } from "@/components/site/experience-band";
import { EventMock, GivingMock, HandoverMock, HouseholdMock, LearningMock, PhoneMock } from "@/components/site/mockups";
import { ProductTour } from "@/components/site/product-tour";
import { FaqList, IconTile, SectionHeading, SiteLink, Ticks, buttonStyles, container } from "@/components/site/ui";
import { WEAVERS } from "@/components/site/weavers";
import { SITE_TAGLINE, TIP_YEARLY_CAP_CENTS, portalUrl, usd } from "@/lib/site";

export const metadata: Metadata = {
  // Absolute: the portal's root layout would otherwise add " · Weaver".
  title: { absolute: SITE_TAGLINE },
  alternates: { canonical: "/" },
};

const CAP = usd(TIP_YEARLY_CAP_CENTS);

/**
 * The home page, kept short (owner review 2026-10-13): the promise, who it is for, the pains Weaver takes away (each with
 * the AI that helps), how AI is used, the product, what a mission partner promises, how to start, and questions. Every
 * claim is something built today; what the owner has not decided yet lives in OWNER_FACTS and is left out while null.
 * In-page anchors: one id per Weaver, #pains, #ai, #product, #partner (with #free, #own and #security), #get-ready, #faq.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <ExperienceBand />
      <WhoWeServe />
      <Pains />
      <HowWeUseAi />
      <Product />
      <Partner />
      <GetStarted />
      <Faq />
    </>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="bg-[linear-gradient(180deg,var(--color-saffron)_0,var(--color-saffron)_58%,var(--color-canvas)_58%)] pb-8 pt-6 sm:pb-12 sm:pt-10">
      <div className={container}>
        <div className="grid grid-cols-1 items-center gap-10 rounded-hero bg-white p-6 shadow-hero sm:p-10 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:p-14">
          <div className="flex min-w-0 flex-col items-start gap-5 sm:gap-6">
            <span className="inline-flex rounded-full bg-saffron-50 px-3.5 py-1.5 text-[13px] font-bold uppercase tracking-[0.08em] text-brown">Your mission partner</span>
            <h1 className="font-display text-[36px] font-bold leading-[1.04] tracking-[-0.03em] text-navy sm:text-[52px] lg:text-[56px]">
              Do more good. Weaver handles the operations.{" "}
              <span className="site-underline text-brown [box-decoration-break:clone]">
                For free. Forever.
              </span>
            </h1>
            <p className="max-w-[580px] text-[17px] leading-relaxed text-ink-2 sm:text-[19px]">
              We take members, giving, events, classes and the books off your volunteers&apos; plates. AI does the busywork. People make the final decisions.{" "}
              <strong className="font-semibold text-navy">This is our way of paying it forward.</strong>
            </p>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <a href={portalUrl("/request-access")} className={`${buttonStyles.primary} !min-h-[56px] !px-8 !text-[17px]`}>
                Get started free
                <Icon name="arrow" className="h-5 w-5" />
              </a>
              <a href={portalUrl("/demo")} className={`${buttonStyles.ghost} !min-h-[56px] !px-8 !text-[17px]`}>
                Try the demo
              </a>
            </div>
            <p className="text-[15px] text-ink-2" data-testid="hero-demo-line">
              Under a minute, no sign-up:{" "}
              <a href="#experience" className="font-semibold text-navy underline underline-offset-4">
                see Weaver as a treasurer, a teacher or a parent
              </a>
              .
            </p>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[15px] font-semibold text-ink-2">
              {["No subscription", "No setup fee", "No cut of your gifts", "No lock-in"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Icon name="check" className="h-4 w-4 text-success" strokeWidth={3} />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative mx-auto hidden w-full min-w-0 max-w-[500px] sm:block">
            <div
              aria-hidden
              className="absolute -right-2 -top-8 z-10 flex h-[116px] w-[116px] rotate-[10deg] flex-col items-center justify-center rounded-full bg-gold text-center text-navy-hover shadow-xl sm:-right-5"
            >
              <span className="font-display text-[36px] font-bold leading-none">$0</span>
              <span className="mt-1 text-[10.5px] font-bold uppercase leading-tight tracking-wide">
                cost to your
                <br />
                organization
              </span>
            </div>
            <HandoverMock />
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Who we serve ─────────────────────────────────────────────────────────────

function WhoWeServe() {
  return (
    <section aria-labelledby="serve-title" className="pb-4">
      <div className={`${container} flex flex-col gap-4`}>
        <p id="serve-title" className="text-center text-[15px] font-semibold text-muted">
          Made for mission-driven organizations built around families
        </p>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {WEAVERS.map((w) => (
            <li key={w.id} id={w.id} className="flex scroll-mt-28 items-center gap-3.5 rounded-2xl border border-line bg-white p-3.5 target:ring-2 target:ring-saffron">
              <IconTile name={w.icon} tone={w.tone} />
              <div className="min-w-0">
                <p className="font-display text-[18px] font-semibold leading-tight text-navy">{w.name}</p>
                <p className="mt-0.5 text-[13.5px] leading-snug text-muted">{w.menu}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── The pains we take away, each with the AI that helps ──────────────────────

/** Every AI line names something built: Niva actions for staff, the import column mapping, QuickBooks match suggestions and Niva's answers for members. */
const PAINS: { icon: IconName; pain: string; fix: string; ai: ReactNode }[] = [
  {
    icon: "card",
    pain: "Matching Zelle payments and checks to pledges by hand",
    fix: "Bank statements match to the right household and pledge, then post to QuickBooks after the treasurer's final click.",
    ai: "Ask Niva to match a deposit to the checks you recorded. AI suggests QuickBooks matches for the treasurer to approve.",
  },
  {
    icon: "users",
    pain: "Five spreadsheets, and nobody knows which is right",
    fix: "One record for every family, keeping the IDs your community already uses.",
    ai: "AI maps your spreadsheet columns without seeing any names, and Niva finds likely duplicate families to merge.",
  },
  {
    icon: "history",
    pain: "The treasurer leaves, and what they knew leaves too",
    fix: "Clean handovers, a required second administrator, and a history of every change.",
    ai: (
      <>
        A new volunteer asks Niva <q className="font-semibold text-ink">what&apos;s waiting on me?</q> and gets the list for their role.
      </>
    ),
  },
  {
    icon: "ticket",
    pain: "Event day: headcounts, lunch lines and missing volunteers",
    fix: "RSVPs, tickets and lunch slots in the member app, with check-in and a kitchen display on any phone.",
    ai: "Ask Niva what's still blocking the event, or assign a volunteer to a shift in one sentence.",
  },
  {
    icon: "mail",
    pain: "The same member questions, again and again",
    fix: "Members open their own statements, tickets and class updates in the app.",
    ai: "Niva answers from the answers you approved, in English, ગુજરાતી or हिन्दी, and drafts inbox replies for a person to send.",
  },
  {
    icon: "chart",
    pain: "Board numbers the night before the meeting",
    fix: "Giving, attendance and membership at a glance, ready to export.",
    ai: "Ask Niva to compare this month with last month and get the answer in plain words.",
  },
];

function Pains() {
  return (
    <section id="pains" className="scroll-mt-24 py-12 sm:py-16 lg:py-20">
      <div className={`${container} flex flex-col gap-8 sm:gap-10`}>
        <SectionHeading
          eyebrow="What we take off your plate"
          title="Every hour a volunteer spends on admin is an hour taken from the mission."
          lead="Weaver carries the operations so your people can do more good."
        />
        <ul className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PAINS.map((p) => (
            <li key={p.pain} className="flex flex-col gap-3 rounded-card border border-line bg-white p-5 sm:p-6">
              <IconTile name={p.icon} tone="saffron" />
              <h3 className="font-display text-[20px] font-semibold leading-snug text-navy">{p.pain}</h3>
              <p className="text-[15.5px] leading-relaxed text-muted">{p.fix}</p>
              <p className="mt-auto flex items-start gap-2.5 rounded-2xl border border-saffron-200 bg-saffron-50 p-3 text-[14.5px] leading-snug text-ink-2">
                <AiTag />
                <span>{p.ai}</span>
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── How Weaver uses AI ───────────────────────────────────────────────────────

/** Each rule is enforced in the code today (confirm before saving, role-scoped commands, masked imports, children left out, a per-organization switch). */
const AI_RULES: { title: string; body: string }[] = [
  { title: "A person decides", body: "Nothing is saved, sent or approved until someone confirms it." },
  { title: "Only what your role allows", body: "Niva prepares only the tasks a person's role permits." },
  { title: "The least data possible", body: "Imports send no names, and Niva leaves children's conversations alone." },
  { title: "Your choice", body: "Switch AI on or off for your organization. Everything works without it." },
];

function HowWeUseAi() {
  return (
    <section id="ai" aria-labelledby="ai-title" className="scroll-mt-24 bg-navy py-12 sm:py-16">
      <div className={`${container} grid grid-cols-1 gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-12`}>
        <SectionHeading
          align="left"
          tone="light"
          eyebrow="How Weaver uses AI"
          title="AI does the busywork. People make the final decisions."
          lead="Niva, Weaver's assistant, can prepare more than 100 tasks across giving, people, events and classes. Every one waits for a person."
          titleId="ai-title"
        />
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {AI_RULES.map((r) => (
            <li key={r.title} className="rounded-2xl border border-white/15 bg-white/5 p-4 sm:p-5">
              <p className="font-display text-[18px] font-semibold text-white">{r.title}</p>
              <p className="mt-1 text-[14.5px] leading-snug text-navy-200">{r.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── Product ──────────────────────────────────────────────────────────────────

function TourPanel({ title, lead, points, ask, visual }: { title: string; lead: string; points: string[]; ask: string; visual: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-center gap-5 rounded-card border border-line bg-white p-4 shadow-panel sm:gap-8 sm:rounded-hero sm:p-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
      <div className="flex flex-col items-start gap-3 sm:gap-4">
        <h3 className="font-display text-[24px] font-semibold leading-[1.1] tracking-[-0.01em] text-navy sm:text-[32px]">{title}</h3>
        <p className="text-[16px] leading-relaxed text-muted sm:text-[17px]">{lead}</p>
        <Ticks items={points} compact />
        <p className="flex items-start gap-2.5 rounded-2xl border border-saffron-200 bg-saffron-50 p-3 text-[14.5px] leading-snug text-ink-2">
          <AiTag label="Niva" />
          <span>{ask}</span>
        </p>
      </div>
      {/* On a phone only the top of the picture shows (it fades out), so a tab stays about a screen and a half. */}
      <div className="relative max-h-[230px] overflow-hidden rounded-window bg-gradient-to-br from-saffron-50 via-canvas to-navy-50 p-3 sm:max-h-none sm:overflow-visible sm:rounded-card sm:p-6">
        {visual}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-canvas to-transparent sm:hidden" />
      </div>
    </div>
  );
}

function Product() {
  return (
    <section id="product" className="scroll-mt-24 py-12 sm:py-16 lg:py-20">
      <div className={`${container} flex flex-col gap-8`}>
        <SectionHeading eyebrow="Everything in one place" title="One home for every part of community life" lead="Your people, your money and your calendar finally agree with each other." />
        <ProductTour
          tabs={[
            {
              id: "people",
              label: "People",
              icon: "users",
              panel: (
                <TourPanel
                  title="Know every family, and never mix two up"
                  lead="Households, memberships and renewals in one record, with the IDs you already use kept alongside."
                  points={["A household card with IDs and members, not just a name", "Applications and approvals for new members", "Import people and past giving from spreadsheets"]}
                  ask="“Find the Patel household that joined in 2022”"
                  visual={<HouseholdMock />}
                />
              ),
            },
            {
              id: "giving",
              label: "Giving",
              icon: "heart",
              panel: (
                <TourPanel
                  title="Pledges, payments and books that agree"
                  lead="Members give by card, Zelle, check or cash. Every payment lands on the right household and flows to your accounting."
                  points={["Pledge drives and recurring gifts per household", "Bank statements matched, with a treasurer's final click", "Posts to QuickBooks Online"]}
                  ask="“Which pledges are behind?”"
                  visual={<GivingMock />}
                />
              ),
            },
            {
              id: "events",
              label: "Events",
              icon: "calendar",
              panel: (
                <TourPanel
                  title="From the first RSVP to the last plate"
                  lead="Sell tickets, plan lunch slots and fill volunteer shifts. On the day, check-in and the kitchen display run from any phone."
                  points={["RSVPs, tickets and lunch slots in the member app", "Check-in at the door and a kitchen display", "A flyer with a QR code that opens the event"]}
                  ask="“What's blocking the dinner from going live?”"
                  visual={<EventMock />}
                />
              ),
            },
            {
              id: "learning",
              label: "Classes",
              icon: "book",
              panel: (
                <TourPanel
                  title="A school that keeps itself organized"
                  lead="Terms, levels, attendance and homework, with parents following their children's progress."
                  points={["Terms, levels and class lists", "Attendance taken on a phone", "Homework handed in and reviewed"]}
                  ask="“How many children are waiting for Level 3?”"
                  visual={<LearningMock />}
                />
              ),
            },
            {
              id: "members",
              label: "Member app",
              icon: "phone",
              panel: (
                <TourPanel
                  title="An app your members will open"
                  lead="One sign-in for the whole family, on a phone or in any browser."
                  points={["Family accounts, with money handled by adults only", "Events, tickets, giving and statements", "Large text and easy-to-tap buttons"]}
                  ask="Members ask in English, ગુજરાતી or हिन्दी"
                  visual={<PhoneMock />}
                />
              ),
            },
          ]}
        />
      </div>
    </section>
  );
}

// ── What a mission partner promises ──────────────────────────────────────────

function Partner() {
  const link = "font-bold text-navy underline underline-offset-4";
  const promises: { id?: string; icon: IconName; title: string; body: ReactNode }[] = [
    {
      id: "free",
      icon: "heart",
      title: "Free for your organization, forever",
      body: (
        <>
          No subscription, no setup fee and no cut of what members give.{" "}
          <SiteLink to="/pricing#how-we-stay-free" className={link}>
            How we stay free
          </SiteLink>
        </>
      ),
    },
    {
      id: "own",
      icon: "lock",
      title: "No vendor lock-in",
      body: "Your data is yours. Export your people lists today; a one-click download of everything comes next. If you ever leave, we'll help you move to the platform you choose.",
    },
    {
      id: "security",
      icon: "shield",
      title: "Encrypted and walled off",
      body: "Encrypted in transit and at rest, each organization separated inside the database, and card numbers never reach us.",
    },
    {
      icon: "history",
      title: "Every change on record",
      body: "A tamper-evident history shows who changed what, when and why, so a handover keeps what people knew.",
    },
  ];
  if (OWNER_FACTS.contactEmail) {
    promises.push({ icon: "mail", title: "A person you can reach", body: `Write to ${OWNER_FACTS.founder ?? "the team"} at ${OWNER_FACTS.contactEmail}.` });
  }
  if (OWNER_FACTS.shutdownCommitment) {
    promises.push({ icon: "globe", title: "If Weaver ever closes", body: OWNER_FACTS.shutdownCommitment });
  }
  const cols = promises.length % 3 === 0 ? "lg:grid-cols-3" : "lg:grid-cols-2";

  return (
    <section id="partner" className="scroll-mt-24 border-y border-line bg-ground py-12 sm:py-16 lg:py-20">
      <div className={`${container} flex flex-col gap-8 sm:gap-10`}>
        <SectionHeading eyebrow="Your mission partner" title="Partner is a promise. Here is ours." />
        <ul className={`mx-auto grid w-full max-w-[960px] grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 ${cols}`}>
          {promises.map((p) => (
            <li key={p.title} id={p.id} className="flex scroll-mt-28 gap-4 rounded-card border border-line bg-white p-5 target:ring-2 target:ring-saffron sm:p-6">
              <IconTile name={p.icon} tone="navy" />
              <div className="min-w-0">
                <h3 className="font-display text-[19px] font-semibold leading-snug text-navy">{p.title}</h3>
                <p className="mt-1 text-[15px] leading-relaxed text-muted">{p.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mx-auto max-w-[760px] text-balance text-center font-display text-[24px] font-semibold leading-tight tracking-[-0.02em] text-navy sm:text-[32px]">
          If you ever want to leave, we&apos;ll help you go. <span className="text-brown">We&apos;re confident you&apos;ll stay.</span>
        </p>
      </div>
    </section>
  );
}

// ── Get started (the closing call to action) ─────────────────────────────────

const STEPS: { title: string; body: string }[] = [
  { title: "Request access", body: "Tell us about your organization. We send a private code by email." },
  { title: "Practice in a sandbox", body: "Test payments, test messages, a guided checklist, and AI that maps your spreadsheets." },
  { title: "Go live", body: "Switch on real payments and invite members. They sign in with their own email." },
];

function GetStarted() {
  return (
    <section id="get-ready" aria-labelledby="get-ready-title" className="scroll-mt-24 py-12 sm:py-16 lg:py-20">
      <div className={container}>
        <div className="relative isolate overflow-hidden rounded-[28px] bg-navy px-5 py-10 text-white sm:rounded-band sm:px-12 sm:py-14">
          <div aria-hidden className="absolute -right-24 -top-24 -z-10 h-[340px] w-[340px] rounded-full bg-white/5" />
          <div aria-hidden className="absolute -bottom-32 -left-20 -z-10 h-[380px] w-[380px] rounded-full bg-saffron/25" />
          <div className="flex flex-col items-center gap-6 text-center sm:gap-8">
            <h2 id="get-ready-title" className="max-w-[760px] text-balance font-display text-[30px] font-semibold leading-[1.08] tracking-[-0.02em] sm:text-[48px]">
              Give your volunteers their time back.
            </h2>
            <ol className="grid w-full max-w-[900px] grid-cols-1 gap-2.5 text-left sm:grid-cols-3 sm:gap-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex items-start gap-3 rounded-2xl border border-white/15 bg-white/5 p-4">
                  <span aria-hidden className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-gold text-[15px] font-bold text-navy-hover">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-[16px] font-bold">{s.title}</p>
                    <p className="mt-0.5 text-[14px] leading-snug text-navy-200">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="flex w-full flex-col items-center justify-center gap-2.5 sm:w-auto sm:flex-row sm:gap-3">
              <a href={portalUrl("/request-access")} className={`${buttonStyles.gold} !min-h-[56px] !px-8 !text-[17px]`}>
                Get started free
                <Icon name="arrow" className="h-5 w-5" />
              </a>
              <a href={portalUrl("/demo")} className={`${buttonStyles.ghostOnNavy} !min-h-[56px] !px-8 !text-[17px]`}>
                Try the demo
              </a>
            </div>
            <a href="/get-ready/checklist.csv" download className="text-[15px] font-semibold text-navy-200 underline underline-offset-4 hover:text-white">
              Download the setup checklist
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── FAQ ──────────────────────────────────────────────────────────────────────

function Faq() {
  const { legalEntity, contactEmail, fundedBy, chipInStarts, shutdownCommitment } = OWNER_FACTS;
  const items: { q: string; a: ReactNode }[] = [
    {
      q: "Is Weaver really free?",
      a: [
        "Yes. Your organization never pays us: no subscription, no setup fee and no cut of what members give. Card payments carry Stripe's processing fee, which goes to Stripe.",
        fundedBy ? `Today Weaver is funded by ${fundedBy}.` : null,
        `${chipInStarts ? `From ${chipInStarts}, members` : "Members"} will be able to add an optional Chip In, capped at ${CAP} a year per account.`,
      ]
        .filter(Boolean)
        .join(" "),
    },
    {
      q: "What does the AI see?",
      a: "Only what a task needs. Spreadsheet imports send column headings and masked samples, never names. QuickBooks matching never sends full emails, phone numbers, amounts or notes. Niva answers members only from content your team approved. Weaver uses Anthropic's Claude models.",
    },
    {
      q: "Can AI change our records by itself?",
      a: "No. Niva prepares a task and shows it to you. Nothing is saved, sent or approved until a person confirms, and Niva can only prepare tasks your role allows.",
    },
    {
      q: "Can we take our data with us?",
      a: "Yes. Your data belongs to your organization. Export your people lists today; a one-click download of everything comes next. If you ever leave, we'll help you move to the platform you choose.",
    },
    {
      q: "Has Weaver had a security audit?",
      a: "Not yet. Data is encrypted in transit and at rest, each organization is separated inside the database, and card numbers go straight to Stripe. We'll say so here when a SOC 2 audit starts.",
    },
  ];
  if (legalEntity) items.push({ q: "Who runs Weaver?", a: `${legalEntity}.${contactEmail ? ` Write to us at ${contactEmail}.` : ""}` });
  if (shutdownCommitment) items.push({ q: "What happens to our data if Weaver closes?", a: shutdownCommitment });

  return (
    <section id="faq" className="scroll-mt-24 pb-12 sm:pb-16 lg:pb-20">
      <div className={`${container} flex flex-col gap-8`}>
        <SectionHeading eyebrow="Questions" title="Straight answers" />
        <FaqList items={items} />
      </div>
    </section>
  );
}
