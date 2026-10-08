import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";

import { Icon, type IconName } from "@/components/site/icons";
import { DashboardMock, EventMock, FloatChip, GivingMock, HouseholdMock, LearningMock, PhoneMock } from "@/components/site/mockups";
import { ProductTour } from "@/components/site/product-tour";
import { FaqList, IconTile, SectionHeading, SiteLink, Ticks, buttonStyles, container } from "@/components/site/ui";
import { WEAVERS, WEAVER_NAMES } from "@/components/site/weavers";
import { SITE_NAME, TIP_YEARLY_CAP_CENTS, portalUrl, usd } from "@/lib/site";

export const metadata: Metadata = {
  // Absolute: the portal's root layout would otherwise add " · Weaver".
  title: { absolute: `${SITE_NAME}: free membership software for communities` },
  alternates: { canonical: "/" },
};

type Tone = "navy" | "saffron" | "success" | "purple" | "maroon" | "store";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Integrations />
      <Tour />
      <Bento />
      <Weavers />
      <HowItWorks />
      <FreeBand />
      <MemberApp />
      <Security />
      <Faq />
      <FinalCta />
    </>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────

const HERO_GLOW: CSSProperties = {
  backgroundImage:
    "radial-gradient(60% 55% at 12% 0%, rgba(242,182,50,0.32), transparent 70%), radial-gradient(55% 50% at 96% 10%, rgba(27,44,92,0.17), transparent 70%), radial-gradient(40% 40% at 60% 100%, rgba(201,115,28,0.12), transparent 70%)",
};
const DOT_GRID: CSSProperties = {
  backgroundImage: "radial-gradient(rgba(27,44,92,0.18) 1px, transparent 1px)",
  backgroundSize: "24px 24px",
  maskImage: "linear-gradient(to bottom, black, transparent 80%)",
  WebkitMaskImage: "linear-gradient(to bottom, black, transparent 80%)",
};

function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <div aria-hidden className="absolute inset-0 -z-20" style={HERO_GLOW} />
      <div aria-hidden className="absolute inset-0 -z-10 opacity-70" style={DOT_GRID} />
      <div className={`${container} grid grid-cols-1 items-center gap-16 pb-24 pt-12 lg:grid-cols-[1.02fr_1fr] lg:gap-8 lg:pb-32 lg:pt-20`}>
        <div className="flex min-w-0 flex-col items-start gap-7">
          <span className="inline-flex items-center gap-2.5 rounded-full border border-white/70 bg-white/80 py-1.5 pl-2 pr-4 text-[14px] font-bold text-navy shadow-sm backdrop-blur">
            <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-success">
              <span aria-hidden className="absolute inset-0 rounded-full bg-success opacity-40 motion-safe:animate-ping" />
              <Icon name="check" className="relative h-3.5 w-3.5 text-white" strokeWidth={3.5} />
            </span>
            100% free for your organization
          </span>
          <h1 className="font-display text-[42px] font-semibold leading-[1] tracking-[-0.03em] text-navy sm:text-[68px] lg:text-[80px]">
            Run your community.{" "}
            <span className="relative isolate inline-block sm:whitespace-nowrap">
              <span aria-hidden className="absolute inset-x-[-6px] bottom-[0.06em] -z-10 h-[0.34em] -skew-x-6 rounded-md bg-gold/80" />
              Free, forever.
            </span>
          </h1>
          <p className="max-w-[580px] text-lg leading-relaxed text-muted sm:text-[21px] sm:leading-[1.55]">
            {SITE_NAME} brings your members, households, events, giving, classes and accounting into one trusted place, and never sends your organization a bill.
          </p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <a href={portalUrl("/request-access")} className={`${buttonStyles.primary} !min-h-[58px] !px-8 !text-[17px] shadow-[0_12px_28px_-8px_rgba(27,44,92,0.6)]`}>
              Get started free
              <Icon name="arrow" className="h-5 w-5" />
            </a>
            <SiteLink to="/#product" className={`${buttonStyles.ghost} !min-h-[58px] !px-8 !text-[17px]`}>
              Take the tour
            </SiteLink>
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[15px] font-semibold text-ink-2">
            {["No credit card", "No setup fee", "No contract"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Icon name="check" className="h-4 w-4 text-success" strokeWidth={3} />
                {t}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[14px] font-semibold text-muted">Choose yours:</span>
            {WEAVERS.map((w) => (
              <SiteLink
                key={w.id}
                to={`/#${w.id}`}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-white/80 px-4 text-[14px] font-bold text-navy backdrop-blur transition-colors hover:border-navy"
              >
                <Icon name={w.icon} className="h-4 w-4" />
                {w.name}
              </SiteLink>
            ))}
          </div>
        </div>

        <div className="relative mx-auto w-full min-w-0 max-w-[580px] pb-4 lg:mx-0 lg:pb-14">
          <div
            aria-hidden
            className="absolute -top-8 right-2 z-30 flex h-[108px] w-[108px] rotate-[10deg] flex-col items-center justify-center rounded-full bg-gold text-navy shadow-xl sm:-right-3 sm:h-[124px] sm:w-[124px]"
          >
            <span className="font-display text-[38px] font-semibold leading-none">$0</span>
            <span className="text-[12px] font-bold uppercase tracking-wide">forever</span>
          </div>
          <DashboardMock />
          <div className="absolute -bottom-2 -right-3 z-10 hidden scale-[0.82] sm:block lg:-right-12 lg:bottom-0 lg:scale-90">
            <PhoneMock />
          </div>
          <FloatChip icon="check" tone="success" title="Zelle $251 matched" body="Shah family · queued for QuickBooks" className="-left-6 top-[42%] lg:-left-14" />
          <FloatChip icon="ticket" tone="saffron" title="186 checked in" body="Annual dinner · 77% of tickets" className="bottom-6 left-4 lg:bottom-2 lg:left-2" delay="-3s" />
        </div>
      </div>
    </section>
  );
}

// ── Works alongside ──────────────────────────────────────────────────────────

function Integrations() {
  const tools = ["Stripe", "QuickBooks Online", "WhatsApp", "Zelle", "Excel and CSV"];
  return (
    <section aria-label="Works alongside the tools you already use" className="border-y border-line bg-white/70">
      <div className={`${container} flex flex-col items-center justify-between gap-5 py-8 lg:flex-row`}>
        <p className="text-center text-[15px] font-semibold text-muted lg:text-left">Works alongside the tools your community already uses</p>
        <ul className="flex flex-wrap items-center justify-center gap-x-9 gap-y-3">
          {tools.map((t) => (
            <li key={t} className="font-display text-[20px] font-semibold tracking-[-0.01em] text-navy/70">
              {t}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── Product tour ─────────────────────────────────────────────────────────────

function TourPanel({ title, lead, points, visual }: { title: string; lead: string; points: string[]; visual: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-center gap-10 rounded-[32px] border border-line bg-white p-6 shadow-[0_30px_60px_-30px_rgba(27,44,92,0.3)] sm:p-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
      <div className="flex flex-col items-start gap-5">
        <h3 className="font-display text-[30px] font-semibold leading-[1.1] tracking-[-0.01em] text-navy sm:text-[36px]">{title}</h3>
        <p className="text-[17px] leading-relaxed text-muted">{lead}</p>
        <Ticks items={points} />
      </div>
      <div className="relative rounded-[24px] bg-gradient-to-br from-saffron-50 via-canvas to-navy-50 p-5 sm:p-8">{visual}</div>
    </div>
  );
}

function Tour() {
  return (
    <section id="product" className="scroll-mt-24 py-20 sm:py-28">
      <div className={`${container} flex flex-col gap-12`}>
        <SectionHeading
          eyebrow="Product tour"
          title="One platform, every part of community life"
          lead="Replace the spreadsheets, the group chats and the five different tools. Your people, your money and your calendar finally agree with each other."
        />
        <ProductTour
          tabs={[
            {
              id: "people",
              label: "People",
              icon: "users",
              panel: (
                <TourPanel
                  title="Know every family, and never mix two up"
                  lead="Households, memberships and renewals live in one record. The IDs you already use are kept alongside, so a search for a common name finds the right family."
                  points={[
                    "A household card with IDs, members and last gift, not just a name",
                    "Applications, references and approvals for new members",
                    "Import people and past giving from your spreadsheets",
                    "Roles that show each volunteer only the area they run",
                  ]}
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
                  lead="Members give by card, Zelle, check or cash. Every payment lands on the right household and flows into your accounting without retyping."
                  points={[
                    "Pledge drives and recurring gifts, tracked per household",
                    "Bank statements matched to households, with a treasurer's final click",
                    "Posts to QuickBooks Online, with a clear queue for anything that fails",
                    "Giving statements members can open themselves",
                  ]}
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
                  points={[
                    "RSVPs, tickets and lunch slots in the member app",
                    "Check-in at the door and a kitchen display for the team",
                    "Flyers made for you, with a QR code that opens the event",
                    "Volunteer opportunities and sign-ups",
                  ]}
                  visual={<EventMock />}
                />
              ),
            },
            {
              id: "learning",
              label: "Learning",
              icon: "book",
              panel: (
                <TourPanel
                  title="A classroom that keeps itself organized"
                  lead="Run your community school with terms, levels, attendance and homework, and let parents follow their children's progress."
                  points={[
                    "Terms, levels and class lists",
                    "Attendance taken on a phone",
                    "Homework handed in and reviewed",
                    "A gamified learning path children enjoy",
                  ]}
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
                  title="An app your members will actually open"
                  lead="One sign-in for the whole family. Members see what is on, give, learn and stay in touch, on a phone or in any web browser."
                  points={[
                    "Family accounts, with money handled by adults only",
                    "Events, tickets, lunch slots and reminders",
                    "Giving, pledges and statements in one place",
                    "English, ગુજરાતી and हिन्दी, with large-text mode",
                  ]}
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

// ── Bento: everything included ───────────────────────────────────────────────

function BentoCard({ id, icon, tone, title, body, span, children }: { id: string; icon: IconName; tone: Tone; title: string; body: string; span: string; children?: ReactNode }) {
  return (
    <li
      id={id}
      className={`group flex scroll-mt-28 flex-col gap-4 rounded-[28px] border border-line bg-white p-7 transition duration-200 hover:-translate-y-1 hover:shadow-[0_24px_48px_-20px_rgba(27,44,92,0.3)] target:ring-2 target:ring-saffron ${span}`}
    >
      <IconTile name={icon} tone={tone} />
      <h3 className="font-display text-[24px] font-semibold leading-tight text-navy">{title}</h3>
      <p className="text-[16px] leading-relaxed text-muted">{body}</p>
      {children}
    </li>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <div className="mt-auto flex flex-wrap gap-2 pt-2">
      {items.map((t) => (
        <span key={t} className="rounded-full bg-ground px-3 py-1.5 text-[13px] font-bold text-navy">
          {t}
        </span>
      ))}
    </div>
  );
}

function Bento() {
  return (
    <section id="features" className="scroll-mt-24 bg-white py-20 sm:py-28">
      <div className={`${container} flex flex-col gap-12`}>
        <SectionHeading eyebrow="Everything included" title="All of this, and not one paid tier" lead="Every feature is included for every organization. There is nothing to unlock and nothing to upgrade to." />
        <ul className="grid grid-cols-1 gap-5 md:grid-cols-6">
          <BentoCard id="households" icon="users" tone="navy" span="md:col-span-3" title="Members and households" body="Families, memberships and renewals in one record, with the IDs your community already uses kept alongside.">
            <Chips items={["Household cards", "Memberships", "Family accounts", "Imports"]} />
          </BentoCard>
          <BentoCard id="giving" icon="heart" tone="saffron" span="md:col-span-3" title="Giving and accounting" body="Pledges, recurring gifts and bank matching for Zelle, ACH and checks, posted to QuickBooks Online.">
            <Chips items={["Pledge drives", "Card, Zelle, checks", "QuickBooks", "Statements"]} />
          </BentoCard>
          <BentoCard id="events" icon="calendar" tone="maroon" span="md:col-span-2" title="Events and event day" body="Tickets, lunch slots, flyers and check-in at the door from any phone." />
          <BentoCard id="learning" icon="book" tone="purple" span="md:col-span-2" title="Classes and learning" body="Terms, levels, attendance, homework and a gamified learning path for children." />
          <BentoCard id="messages" icon="mail" tone="navy" span="md:col-span-2" title="Messages and volunteers" body="Email, WhatsApp and app notifications to the right group, and sign-ups that fill themselves." />
          <BentoCard id="store" icon="bag" tone="store" span="md:col-span-2" title="A community store" body="Sell what your community sells, with checkout in the member app and every order in one place." />
          <BentoCard id="reports" icon="chart" tone="success" span="md:col-span-2" title="Reports that answer questions" body="See giving, attendance and membership at a glance, and export what your board asks for." />
          <BentoCard id="languages" icon="globe" tone="saffron" span="md:col-span-2" title="In your language" body="English, ગુજરાતી and हिन्दी built in, with large-text mode and generous touch targets." />
        </ul>
      </div>
    </section>
  );
}

// ── The three Weavers ────────────────────────────────────────────────────────

function Weavers() {
  return (
    <section id="weavers" className="scroll-mt-24 py-20 sm:py-28">
      <div className={`${container} flex flex-col gap-12`}>
        <SectionHeading
          eyebrow="One platform, three Weavers"
          title="Pick the Weaver that sounds like home"
          lead="Faith Weaver, Community Weaver and Org Weaver are the same free platform, named for who they serve. Every feature, every time."
        />
        <ul className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {WEAVERS.map((w) => (
            <li
              key={w.id}
              id={w.id}
              className="flex scroll-mt-28 flex-col gap-5 rounded-[32px] border border-line bg-white p-8 transition duration-200 hover:-translate-y-1 hover:shadow-[0_24px_48px_-20px_rgba(27,44,92,0.3)] target:ring-2 target:ring-saffron"
            >
              <IconTile name={w.icon} tone={w.tone} />
              <h3 className="font-display text-[30px] font-semibold leading-tight tracking-[-0.01em] text-navy">{w.name}</h3>
              <p className="text-[16.5px] leading-relaxed text-muted">{w.body}</p>
              <div className="mt-auto pt-2">
                <Ticks items={w.points} />
              </div>
              <a href={portalUrl("/request-access")} className={`${buttonStyles.ghost} mt-3 w-full !min-h-[48px] !text-[15px]`}>
                Get started free
                <Icon name="arrow" className="h-4 w-4" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── How it works ─────────────────────────────────────────────────────────────

function HowItWorks() {
  const steps = [
    { n: "1", icon: "mail" as const, title: "Request access", body: "Tell us about your organization. We send a private code by email." },
    { n: "2", icon: "shield" as const, title: "Practice in your sandbox", body: "A private copy where payments run in test mode and messages reach only test recipients. A guided checklist walks you through people, roles and payments." },
    { n: "3", icon: "smile" as const, title: "Go live and invite members", body: "Switch on real payments and share your member app link or join code. Your community signs in with their own email." },
  ];
  return (
    <section id="how" className="scroll-mt-24 bg-white py-20 sm:py-28">
      <div className={`${container} flex flex-col gap-14`}>
        <SectionHeading eyebrow="How it works" title="Up and running at your own pace" lead="No sales call and no contract. Start in a safe practice space and go live when your team is ready." />
        <ol className="relative grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div aria-hidden className="absolute left-[16%] right-[16%] top-[54px] hidden border-t-2 border-dashed border-line-input lg:block" />
          {steps.map((s) => (
            <li key={s.n} className="relative flex flex-col items-start gap-4 rounded-[28px] border border-line bg-canvas p-7">
              <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-navy text-white shadow-[0_10px_20px_-8px_rgba(27,44,92,0.6)]">
                <Icon name={s.icon} className="h-6 w-6" />
                <span className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-gold text-[13px] font-bold text-navy">{s.n}</span>
              </span>
              <h3 className="font-display text-[24px] font-semibold text-navy">{s.title}</h3>
              <p className="text-[16px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="flex justify-center">
          <a href={portalUrl("/request-access")} className={buttonStyles.primary}>
            Request access
            <Icon name="arrow" className="h-5 w-5" />
          </a>
        </div>
      </div>
    </section>
  );
}

// ── Free band ────────────────────────────────────────────────────────────────

function FreeBand() {
  return (
    <section aria-labelledby="free-title" className="relative isolate overflow-hidden bg-navy py-20 text-white sm:py-28">
      <div aria-hidden className="absolute -right-32 -top-32 -z-10 h-[460px] w-[460px] rounded-full bg-white/5" />
      <div aria-hidden className="absolute -bottom-40 -left-24 -z-10 h-[420px] w-[420px] rounded-full bg-saffron/20" />
      <div className={`${container} grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-16`}>
        <div className="flex flex-col items-start gap-5">
          <span className="rounded-full bg-white/10 px-3.5 py-1.5 text-[13px] font-bold uppercase tracking-[0.08em] text-gold">Pricing</span>
          <h2 id="free-title" className="font-display text-[38px] font-semibold leading-[1.04] tracking-[-0.02em] sm:text-[56px]">
            Free means free.
          </h2>
          <p className="max-w-[580px] text-[18px] leading-relaxed text-navy-200">
            No subscription, no setup fee, no per-member charge and no percentage of what your members give. We keep the platform going through small, optional tips from members, capped at {usd(TIP_YEARLY_CAP_CENTS)} a year per account, so your organization never has to pay.
          </p>
          <ol className="grid w-full max-w-[580px] grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              ["A member pays", "dues, a gift or a ticket"],
              ["An optional tip", "one tap to skip it"],
              [`Capped at ${usd(TIP_YEARLY_CAP_CENTS)}`, "a year, per account"],
            ].map(([a, b], i) => (
              <li key={a} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <span className="text-[12px] font-bold text-gold">0{i + 1}</span>
                <p className="mt-1 text-[15px] font-bold">{a}</p>
                <p className="text-[13.5px] text-navy-200">{b}</p>
              </li>
            ))}
          </ol>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <SiteLink to="/pricing" className={buttonStyles.gold}>
              See pricing
              <Icon name="arrow" className="h-5 w-5" />
            </SiteLink>
            <SiteLink to="/pricing#how-we-stay-free" className={buttonStyles.ghostOnNavy}>
              How we stay free
            </SiteLink>
          </div>
        </div>
        <div className="rounded-[32px] bg-white p-8 text-navy shadow-2xl sm:p-10">
          <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-brown">Your organization pays</p>
          <p className="mt-2 font-display text-[104px] font-semibold leading-none tracking-[-0.03em]">$0</p>
          <p className="mt-1 text-lg font-semibold text-muted">today, next year, and every year after</p>
          <div className="mt-6">
            <Ticks items={["Every feature included", "No contract, leave any time", "Your data stays yours"]} />
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Member app ───────────────────────────────────────────────────────────────

function MemberApp() {
  return (
    <section id="member-app" className="scroll-mt-24 overflow-hidden py-20 sm:py-28">
      <div className={`${container} grid grid-cols-1 items-center gap-14 lg:grid-cols-2 lg:gap-20`}>
        <div className="relative order-2 lg:order-1">
          <div aria-hidden className="absolute left-1/2 top-1/2 -z-10 h-[440px] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-saffron-50 to-navy-50" />
          <PhoneMock />
        </div>
        <div className="order-1 flex flex-col items-start gap-5 lg:order-2">
          <span className="text-[13px] font-bold uppercase tracking-[0.08em] text-brown">The member app</span>
          <h2 className="font-display text-[34px] font-semibold leading-[1.08] tracking-[-0.02em] text-navy sm:text-[46px]">Your members get an app of their own</h2>
          <p className="text-[17px] leading-relaxed text-muted">
            One sign-in for the whole family. Members see what is on, give, learn and stay in touch, on a phone or in any web browser.
          </p>
          <Ticks
            items={[
              "Family accounts that link parents and children, with money handled by adults only",
              "Events, tickets, lunch slots and reminders",
              "Giving, pledges and statements in one place",
              "Learning paths for children and adults",
              "Large-text mode and three languages",
            ]}
          />
          <a href={portalUrl("/request-access")} className={`${buttonStyles.primary} mt-2`}>
            Get started free
            <Icon name="arrow" className="h-5 w-5" />
          </a>
        </div>
      </div>
    </section>
  );
}

// ── Security ─────────────────────────────────────────────────────────────────

function Security() {
  const items: { icon: IconName; title: string; body: string }[] = [
    { icon: "shield", title: "Walled off in the database", body: "Each organization's data is separated by rules inside the database itself, not only by the app on top." },
    { icon: "card", title: "Card numbers never reach us", body: "Card payments go straight to Stripe through your own account. We never see or store a card number." },
    { icon: "history", title: "Every change on record", body: "A tamper-evident history shows who changed what, when and why. It cannot be quietly rewritten." },
    { icon: "lock", title: "The right access for each role", body: "People see only what their role allows. Sensitive actions, such as refunds, need a second approver and a fresh two-step check." },
  ];
  return (
    <section id="security" className="relative isolate scroll-mt-24 overflow-hidden bg-gradient-to-b from-[#16244d] to-navy py-20 text-white sm:py-28">
      <div aria-hidden className="absolute -left-40 top-1/3 -z-10 h-[420px] w-[420px] rounded-full bg-white/5" />
      <div className={`${container} flex flex-col gap-12`}>
        <SectionHeading tone="light" eyebrow="Security and privacy" title="Built to be trusted with your community" lead="Members share their families, their giving and their children's names. We treat that with the care it deserves." />
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.title} className="flex gap-5 rounded-[28px] border border-white/10 bg-white/[0.06] p-7 backdrop-blur">
              <span className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-gold text-navy">
                <Icon name={item.icon} className="h-6 w-6" />
              </span>
              <div>
                <h3 className="font-display text-[22px] font-semibold">{item.title}</h3>
                <p className="mt-1.5 text-[16px] leading-relaxed text-navy-200">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── FAQ ──────────────────────────────────────────────────────────────────────

function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 py-20 sm:py-28">
      <div className={`${container} flex flex-col gap-12`}>
        <SectionHeading eyebrow="Questions" title="Good questions, straight answers" />
        <FaqList
          items={[
            {
              q: "Is Weaver AMS really free?",
              a: (
                <>
                  Yes. Your organization never pays us: no subscription, no setup fee, no per-member charge. Members may add a small optional tip when they pay, capped at {usd(TIP_YEARLY_CAP_CENTS)} a year per account.{" "}
                  <SiteLink to="/pricing#how-we-stay-free" className="font-bold text-navy underline">
                    Here is how it works.
                  </SiteLink>
                </>
              ),
            },
            {
              q: "Who is it for?",
              a: `Communities built around families. ${WEAVER_NAMES} are the same free platform, named for who they serve: places of worship, cultural associations and community centers, and nonprofits and societies. Households, not just individuals, are at the center.`,
            },
            {
              q: "Can we bring our existing member and giving records?",
              a: "Yes. Setup guides you through importing people and past giving from your spreadsheets, and it keeps the IDs your community already uses, so nobody has to learn new numbers.",
            },
            {
              q: "How do payments work?",
              a: "Cards are processed by Stripe through your organization's own account. Zelle, ACH, checks and cash are recorded and matched to the right household, and everything flows to QuickBooks.",
            },
            {
              q: "Can we try it before we go live?",
              a: "Yes. Every organization starts in a private sandbox where payments run in test mode and messages reach only test recipients. Go live when you are ready.",
            },
            {
              q: "What do members need to join?",
              a: "An email address. Members sign in to the app or the web version, link their family, and see only their own household.",
            },
          ]}
        />
      </div>
    </section>
  );
}

// ── Final call to action ─────────────────────────────────────────────────────

function FinalCta() {
  return (
    <section className="pb-20 sm:pb-28">
      <div className={container}>
        <div className="relative isolate overflow-hidden rounded-[40px] bg-navy px-6 py-16 text-center text-white sm:px-12 sm:py-24">
          <div aria-hidden className="absolute -right-24 -top-24 -z-10 h-[340px] w-[340px] rounded-full bg-white/5" />
          <div aria-hidden className="absolute -bottom-32 -left-20 -z-10 h-[380px] w-[380px] rounded-full bg-saffron/25" />
          <h2 className="mx-auto max-w-[760px] font-display text-[36px] font-semibold leading-[1.05] tracking-[-0.02em] sm:text-[56px]">Give your community a home that costs nothing to keep.</h2>
          <p className="mx-auto mt-5 max-w-[560px] text-lg text-navy-200">Request access today and start in a private sandbox. No credit card needed.</p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href={portalUrl("/request-access")} className={`${buttonStyles.gold} !min-h-[58px] !px-8 !text-[17px]`}>
              Get started free
              <Icon name="arrow" className="h-5 w-5" />
            </a>
            <a href={portalUrl("/login")} className={`${buttonStyles.ghostOnNavy} !min-h-[58px] !px-8 !text-[17px]`}>
              Sign in
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
