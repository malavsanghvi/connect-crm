import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";

import { Icon, type IconName } from "@/components/site/icons";
import { DashboardMock, EventMock, FloatChip, GivingMock, HouseholdMock, LearningMock, PhoneMock } from "@/components/site/mockups";
import { ProductTour } from "@/components/site/product-tour";
import { FaqList, IconTile, SectionHeading, SiteLink, Ticks, buttonStyles, container } from "@/components/site/ui";
import { WEAVERS, WEAVER_NAMES } from "@/components/site/weavers";
import { GENEROSITY_LINE } from "@/lib/brand";
import { CHECKLIST_AREAS } from "@/lib/onboarding-checklist";
import { SITE_NAME, SITE_TAGLINE, TIP_YEARLY_CAP_CENTS, portalUrl, usd } from "@/lib/site";

export const metadata: Metadata = {
  // Absolute: the portal's root layout would otherwise add " · Weaver".
  title: { absolute: SITE_TAGLINE },
  alternates: { canonical: "/" },
};

/**
 * The home page, in the order a visitor asks the questions: what is it, who is it for, what does it do, how do we raise
 * more, how do we start, what does it cost, can we trust it, and what else. The in-page anchors are #weavers (and one id
 * per Weaver), #product (with #messages, #store, #reports and #languages in its "Also included" row), #raise,
 * #get-ready, #free, #security and #faq. The header, footer and pricing page link to these.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <Integrations />
      <Weavers />
      <Product />
      <Raise />
      <GetStarted />
      <Free />
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
      <div className={`${container} grid grid-cols-1 items-center gap-8 pb-10 pt-8 sm:gap-12 sm:pb-14 lg:grid-cols-[1.02fr_1fr] lg:gap-8 lg:pb-16 lg:pt-12`}>
        <div className="flex min-w-0 flex-col items-start gap-5 sm:gap-6">
          <span className="inline-flex items-center gap-2.5 rounded-full border border-white/70 bg-white/80 py-1.5 pl-2 pr-4 text-[14px] font-bold text-navy shadow-sm backdrop-blur">
            <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-success">
              <span aria-hidden className="absolute inset-0 rounded-full bg-success opacity-40 motion-safe:animate-ping" />
              <Icon name="check" className="relative h-3.5 w-3.5 text-white" strokeWidth={3.5} />
            </span>
            {GENEROSITY_LINE}
          </span>
          <h1 className="font-display text-[34px] font-semibold leading-[1.04] tracking-[-0.03em] text-navy sm:text-[52px] lg:text-[50px]">
            AI Native Community Weaver Platform.{" "}
            <span className="relative isolate inline-block">
              <span aria-hidden className="absolute inset-x-[-6px] bottom-[0.06em] -z-10 h-[0.34em] -skew-x-6 rounded-md bg-gold/80" />
              Paid Forward Already.
            </span>
          </h1>
          <p className="max-w-[580px] text-[17px] leading-relaxed text-muted sm:text-[20px] sm:leading-[1.5]">
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

        <div className="relative mx-auto hidden w-full min-w-0 max-w-[580px] pb-4 sm:block lg:mx-0 lg:pb-14">
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
          <FloatChip icon="check" tone="success" title="Zelle $251 matched" body="Rivera family · queued for QuickBooks" className="-left-6 top-[42%] lg:-left-14" />
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
      <div className={`${container} flex flex-col items-center justify-between gap-4 py-6 lg:flex-row`}>
        <p className="text-center text-[15px] font-semibold text-muted lg:text-left">Works alongside the tools your community already uses</p>
        <ul className="flex flex-wrap items-center justify-center gap-x-9 gap-y-2">
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

// ── The three Weavers ────────────────────────────────────────────────────────

function Weavers() {
  return (
    <section id="weavers" className="scroll-mt-24 py-10 sm:py-14 lg:py-16">
      <div className={`${container} flex flex-col gap-6 sm:gap-8`}>
        <SectionHeading
          eyebrow="One platform, three Weavers"
          title="Pick the Weaver that sounds like home"
          lead="Faith Weaver, Community Weaver and Org Weaver are the same free platform, named for who they serve. Every feature, every time."
        />
        <ul className="grid grid-cols-1 gap-3 sm:gap-5 lg:grid-cols-3">
          {WEAVERS.map((w) => (
            <li
              key={w.id}
              id={w.id}
              className="flex scroll-mt-28 flex-col gap-2 rounded-[20px] border border-line bg-white p-4 transition duration-200 target:ring-2 target:ring-saffron sm:gap-4 sm:rounded-[28px] sm:p-6 sm:hover:-translate-y-1 sm:hover:shadow-[0_24px_48px_-20px_rgba(27,44,92,0.3)]"
            >
              <div className="flex items-center gap-3 sm:gap-4">
                <IconTile name={w.icon} tone={w.tone} />
                <h3 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.01em] text-navy sm:text-[26px]">{w.name}</h3>
              </div>
              <p className="text-[15px] leading-snug text-muted sm:text-[16px] sm:leading-relaxed">{w.body}</p>
              <div className="mt-auto hidden pt-1 sm:block">
                <Ticks items={w.points} compact />
              </div>
              <div className="hidden sm:block">
                <a href={portalUrl("/request-access")} className={`${buttonStyles.ghost} mt-1 w-full !min-h-[48px] !text-[15px]`}>
                  Get started free
                  <Icon name="arrow" className="h-4 w-4" />
                </a>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── Product: the tour, and what else is included ─────────────────────────────

function TourPanel({ title, lead, points, visual }: { title: string; lead: string; points: string[]; visual: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-center gap-5 rounded-[24px] border border-line bg-white p-4 shadow-[0_30px_60px_-30px_rgba(27,44,92,0.3)] sm:gap-8 sm:rounded-[32px] sm:p-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
      <div className="flex flex-col items-start gap-3 sm:gap-4">
        <h3 className="font-display text-[24px] font-semibold leading-[1.1] tracking-[-0.01em] text-navy sm:text-[34px]">{title}</h3>
        <p className="text-[16px] leading-relaxed text-muted sm:text-[17px]">{lead}</p>
        <Ticks items={points} compact />
      </div>
      {/* On a phone only the top of the picture shows (it fades out), so a tab stays about a screen and a half. */}
      <div className="relative max-h-[230px] overflow-hidden rounded-[20px] bg-gradient-to-br from-saffron-50 via-canvas to-navy-50 p-3 sm:max-h-none sm:overflow-visible sm:rounded-[24px] sm:p-6">
        {visual}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-canvas to-transparent sm:hidden" />
      </div>
    </div>
  );
}

/** What the tour tabs do not show. The ids keep the header's "Messages and volunteers" link working. */
const ALSO_INCLUDED: { id: string; icon: IconName; tone: "navy" | "success" | "saffron" | "store"; title: string; body: string }[] = [
  { id: "messages", icon: "mail", tone: "navy", title: "Messages and volunteers", body: "Email, WhatsApp and app notifications to the right group, and sign-ups that fill themselves." },
  { id: "store", icon: "bag", tone: "store", title: "A community store", body: "Sell what your community sells, with checkout in the member app and every order in one place." },
  { id: "reports", icon: "chart", tone: "success", title: "Reports that answer questions", body: "See giving, attendance and membership at a glance, and export what your board asks for." },
  { id: "languages", icon: "globe", tone: "saffron", title: "In your language", body: "English, ગુજરાતી and हिन्दी built in, with large-text mode and generous touch targets." },
];

function Product() {
  return (
    <section id="product" className="scroll-mt-24 py-10 sm:py-14 lg:py-16">
      <div className={`${container} flex flex-col gap-6 sm:gap-8`}>
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
                    "Family accounts that link parents and children, with money handled by adults only",
                    "Events, tickets, lunch slots and reminders",
                    "Giving, pledges and statements in one place",
                    "Learning paths for children and adults",
                    "English, ગુજરાતી and हिन्दी, with large-text mode and easy-to-tap buttons",
                  ]}
                  visual={<PhoneMock />}
                />
              ),
            },
          ]}
        />
        <div className="flex flex-col gap-3 sm:gap-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
            <h3 className="font-display text-[22px] font-semibold text-navy">Also included</h3>
            <p className="text-[15px] text-muted">Every feature is included for every organization. There is nothing to unlock and nothing to upgrade to.</p>
          </div>
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
            {ALSO_INCLUDED.map((item) => (
              <li key={item.id} id={item.id} className="flex scroll-mt-28 items-start gap-3.5 rounded-2xl border border-line bg-white p-3.5 target:ring-2 target:ring-saffron sm:p-4">
                <span className="hidden sm:block">
                  <IconTile name={item.icon} tone={item.tone} />
                </span>
                <div>
                  <h4 className="font-display text-[17px] font-semibold leading-snug text-navy sm:text-[18px]">{item.title}</h4>
                  <p className="mt-0.5 text-[14px] leading-snug text-muted sm:mt-1 sm:text-[14.5px] sm:leading-relaxed">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ── Raise more ───────────────────────────────────────────────────────────────

const RAISE: { title: string; body: string; live: boolean }[] = [
  {
    title: "Double donations with employer matching",
    body: "Members find out if their employer matches, and Weaver guides each claim: a $100 gift can become $200.",
    live: false,
  },
  {
    title: "Your own digital store front",
    body: "Sell approved products with online payment and pickup windows inside Weaver. Custom products are on the way.",
    live: true,
  },
  {
    title: "Special days, remembered for you",
    body: "Prompts the right person on special days, and will use social signals members choose to share.",
    live: false,
  },
  {
    title: "Donor management that nudges for you",
    body: "Automated playbooks guide admins and volunteers to nudge the right people and deepen every relationship.",
    live: false,
  },
  {
    title: "Your website and social media, built in",
    body: "Build your organization's website inside Weaver, and share events and updates to Facebook and Instagram from one place.",
    live: false,
  },
];

function Raise() {
  return (
    <section id="raise" aria-labelledby="raise-title" className="scroll-mt-24 bg-white py-10 sm:py-14 lg:py-16">
      <div className={`${container} flex flex-col gap-6 sm:gap-8`}>
        <div className="flex max-w-[720px] flex-col items-start gap-3 sm:gap-4">
          <span className="rounded-full bg-gold/30 px-3.5 py-1.5 text-[13px] font-bold uppercase tracking-[0.08em] text-brown">Raise more, together</span>
          <h2 id="raise-title" className="font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-navy sm:text-[46px]">
            Help your community give more.
          </h2>
          <p className="text-[16px] leading-relaxed text-muted sm:text-[20px]">Ways Weaver helps your organization raise more and reach more people, inside the same free platform.</p>
        </div>
        <ul className="grid grid-cols-1 gap-3 sm:gap-5 md:grid-cols-2">
          {RAISE.map((item, i) => (
            <li key={item.title} className={`flex flex-col items-start gap-2 rounded-[22px] border border-line bg-[#FBF7F0] p-4 sm:gap-3 sm:rounded-[28px] sm:p-6${i === RAISE.length - 1 && RAISE.length % 2 === 1 ? " md:col-span-2" : ""}`}>
              <span
                className={`rounded-full px-3 py-1 text-[12px] font-bold uppercase tracking-[0.06em] ${item.live ? "bg-success-50 text-success-900" : "bg-saffron-50 text-brown-900"}`}
              >
                {item.live ? "Live" : "Coming soon"}
              </span>
              <h3 className="font-display text-[20px] font-semibold leading-[1.2] text-navy sm:text-[24px]">{item.title}</h3>
              <p className="text-[15px] leading-snug text-muted sm:text-[16.5px] sm:leading-relaxed">{item.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── Get started: the three steps and the 60-minute promise ───────────────────

const STEPS: { n: string; title: string; body: string }[] = [
  { n: "1", title: "Request access", body: "Tell us about your organization. We send a private code by email." },
  {
    n: "2",
    title: "Practice in your sandbox",
    body: "A private copy where payments run in test mode and messages reach only test recipients. A guided checklist walks you through people, roles and payments.",
  },
  { n: "3", title: "Go live and invite members", body: "Switch on real payments and share your member app link or join code. Your community signs in with their own email." },
];

function GetStarted() {
  return (
    <section id="get-ready" aria-labelledby="get-ready-title" className="scroll-mt-24 py-10 sm:py-14 lg:py-16">
      <div className={`${container} flex flex-col gap-6 sm:gap-8`}>
        <SectionHeading eyebrow="Get started" title="Up and running at your own pace" lead="No sales call and no contract. Start in a safe practice space and go live when your team is ready." titleId="get-ready-title" />
        <ol className="grid grid-cols-1 gap-2.5 sm:gap-4 lg:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="flex items-start gap-3 rounded-[18px] border border-line bg-white p-3.5 sm:gap-4 sm:rounded-[24px] sm:p-5">
              <span aria-hidden className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-navy text-[15px] font-bold text-white sm:h-11 sm:w-11 sm:text-[17px]">
                {s.n}
              </span>
              <div>
                <h3 className="font-display text-[18px] font-semibold leading-snug text-navy sm:text-[20px]">{s.title}</h3>
                <p className="mt-0.5 text-[14px] leading-snug text-muted sm:mt-1 sm:text-[15px] sm:leading-relaxed">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="grid grid-cols-1 items-center gap-5 rounded-[24px] border border-line bg-white p-4 shadow-[0_30px_60px_-30px_rgba(27,44,92,0.3)] sm:gap-8 sm:rounded-[32px] sm:p-8 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
          <div className="flex flex-col items-start gap-3 sm:gap-4">
            <h3 className="font-display text-[24px] font-semibold leading-[1.12] tracking-[-0.02em] text-navy sm:text-[34px]">Onboarded in 60 minutes, or we plant 100 trees for your organization.</h3>
            <p className="max-w-[560px] text-[15px] leading-relaxed text-muted sm:text-[17px]">
              From your first request to a working community: your people, your giving, your events and your accounts. Get everything ready with our checklist of connections, data, forms, calendars and legal documents.
            </p>
            <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:gap-3">
              <a href="/get-ready/checklist.csv" download className={buttonStyles.primary}>
                Download the checklist
                <Icon name="arrow" className="h-5 w-5" />
              </a>
              <a href={portalUrl("/request-access")} className={buttonStyles.ghost}>
                Request access
              </a>
            </div>
            <p className="text-[14px] text-muted">The checklist is ready to download today. The 60-minute promise launches soon.</p>
          </div>
          <ul className="grid grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-1">
            {CHECKLIST_AREAS.map((a, i) => (
              <li key={a.area} className="flex items-center gap-2.5 rounded-xl border border-line bg-canvas p-2.5 sm:items-start sm:gap-3.5 sm:rounded-2xl sm:p-3">
                <span aria-hidden className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-navy text-[12px] font-bold text-white sm:h-8 sm:w-8 sm:text-[13px]">
                  {i + 1}
                </span>
                <div>
                  <p className="text-[14.5px] font-bold leading-tight text-navy sm:text-[16px] sm:leading-snug">{a.area}</p>
                  <p className="hidden text-[14px] leading-snug text-muted sm:block">{a.line}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ── Free: generosity, and what free means ────────────────────────────────────

function Free() {
  return (
    <section id="free" aria-labelledby="free-title" className="relative isolate scroll-mt-24 overflow-hidden bg-navy py-10 text-white sm:py-14 lg:py-16">
      <div aria-hidden className="absolute -right-32 -top-32 -z-10 h-[460px] w-[460px] rounded-full bg-white/5" />
      <div aria-hidden className="absolute -bottom-40 -left-24 -z-10 h-[420px] w-[420px] rounded-full bg-saffron/20" />
      <div className={`${container} grid grid-cols-1 items-center gap-6 sm:gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-14`}>
        <div className="flex flex-col items-start gap-3 sm:gap-4">
          <span className="rounded-full bg-white/10 px-3.5 py-1.5 text-[13px] font-bold uppercase tracking-[0.08em] text-gold">Pricing</span>
          <h2 id="free-title" className="font-display text-[28px] font-semibold leading-[1.06] tracking-[-0.02em] sm:text-[44px]">
            {GENEROSITY_LINE}
          </h2>
          <p className="max-w-[600px] text-[16.5px] leading-relaxed text-navy-200 sm:text-[20px]">
            <span className="font-semibold text-white">We believe in people.</span> We want to do good for each other.{" "}
            <span className="font-semibold text-white">So Weaver is made free, for everyone, forever.</span>
          </p>
          <h3 className="mt-1 font-display text-[22px] font-semibold leading-tight tracking-[-0.01em] sm:mt-2 sm:text-[28px]">Free means free.</h3>
          <p className="max-w-[580px] text-[15px] leading-relaxed text-navy-200 sm:text-[17px]">
            No subscription, no setup fee, no per-member charge and no percentage of what your members give. We keep the platform going through small, optional Chip Ins from members, capped at {usd(TIP_YEARLY_CAP_CENTS)} a year per account, so your organization never has to pay.
          </p>
          <ol className="grid w-full max-w-[580px] grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
            {[
              ["A member pays", "dues, a gift or a ticket"],
              ["An optional Chip In", "one tap to skip it"],
              [`Capped at ${usd(TIP_YEARLY_CAP_CENTS)}`, "a year, per account"],
            ].map(([a, b], i) => (
              <li key={a} className="flex items-baseline gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 sm:block sm:rounded-2xl sm:p-4">
                <span className="text-[12px] font-bold text-gold">0{i + 1}</span>
                <p className="text-[15px] font-bold sm:mt-1">
                  {a}
                  <span className="ml-2 text-[13.5px] font-normal text-navy-200 sm:hidden">{b}</span>
                </p>
                <p className="hidden text-[13.5px] text-navy-200 sm:block">{b}</p>
              </li>
            ))}
          </ol>
          <div className="mt-1 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:gap-3">
            <SiteLink to="/pricing" className={buttonStyles.gold}>
              See pricing
              <Icon name="arrow" className="h-5 w-5" />
            </SiteLink>
            <SiteLink to="/pricing#how-we-stay-free" className={buttonStyles.ghostOnNavy}>
              How we stay free
            </SiteLink>
          </div>
        </div>
        <div className="rounded-[24px] bg-white p-5 text-navy shadow-2xl sm:rounded-[32px] sm:p-10">
          <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-brown">Your organization pays</p>
          <p className="mt-1 font-display text-[64px] font-semibold leading-none tracking-[-0.03em] sm:mt-2 sm:text-[104px]">$0</p>
          <p className="mt-1 text-[16px] font-semibold text-muted sm:text-lg">today, next year, and every year after</p>
          <div className="mt-4 sm:mt-6">
            <Ticks items={["Every feature included", "No contract, leave any time", "Your data stays yours"]} />
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Security ─────────────────────────────────────────────────────────────────

function Security() {
  const items: { icon: IconName; title: string; body: string }[] = [
    { icon: "shield", title: "Walled off in the database", body: "Each organization's data is separated by rules inside the database itself, not only by the app." },
    { icon: "card", title: "Card numbers never reach us", body: "Card payments go straight to Stripe through your own account. We never see or store a card number." },
    { icon: "history", title: "Every change on record", body: "A tamper-evident history shows who changed what, when and why. It cannot be quietly rewritten." },
    { icon: "lock", title: "The right access for each role", body: "People see only what their role allows. Refunds and other sensitive actions need a second approver and a fresh two-step check." },
  ];
  return (
    <section id="security" className="scroll-mt-24 border-b border-line bg-white py-10 sm:py-12 lg:py-14">
      <div className={`${container} grid grid-cols-1 items-center gap-5 sm:gap-8 lg:grid-cols-[0.8fr_1.4fr] lg:gap-12`}>
        <SectionHeading align="left" eyebrow="Security and privacy" title="Built to be trusted with your community" lead="Members share their families, their giving and their children's names. We treat that with care." />
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-4">
          {items.map((item) => (
            <li key={item.title} className="flex gap-3 rounded-[18px] border border-line bg-canvas p-3.5 sm:gap-4 sm:rounded-[24px] sm:p-5">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-navy text-white sm:h-11 sm:w-11 sm:rounded-2xl">
                <Icon name={item.icon} className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
              </span>
              <div>
                <h3 className="font-display text-[17px] font-semibold leading-snug text-navy sm:text-[19px]">{item.title}</h3>
                <p className="mt-0.5 text-[14px] leading-snug text-muted sm:mt-1 sm:text-[15px] sm:leading-relaxed">{item.body}</p>
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
    <section id="faq" className="scroll-mt-24 py-10 sm:py-14 lg:py-16">
      <div className={`${container} grid grid-cols-1 items-start gap-5 sm:gap-8 lg:grid-cols-[0.8fr_1.4fr] lg:gap-12`}>
        <div className="flex flex-col items-start gap-3 sm:gap-5">
          <SectionHeading align="left" eyebrow="Questions" title="Good questions, straight answers" />
          <p className="text-[15px] text-muted">
            More questions?{" "}
            <SiteLink to="/pricing#faq" className="font-bold text-navy underline">
              The pricing page answers many more.
            </SiteLink>
          </p>
        </div>
        <FaqList
          items={[
            {
              q: "Is Weaver really free?",
              a: (
                <>
                  Yes. Your organization never pays us: no subscription, no setup fee, no per-member charge. Members may add a small optional Chip In when they pay, capped at {usd(TIP_YEARLY_CAP_CENTS)} a year per account.{" "}
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
    <section className="pb-10 sm:pb-14 lg:pb-16">
      <div className={container}>
        <div className="relative isolate overflow-hidden rounded-[28px] bg-navy px-5 py-9 text-center text-white sm:rounded-[40px] sm:px-12 sm:py-14">
          <div aria-hidden className="absolute -right-24 -top-24 -z-10 h-[340px] w-[340px] rounded-full bg-white/5" />
          <div aria-hidden className="absolute -bottom-32 -left-20 -z-10 h-[380px] w-[380px] rounded-full bg-saffron/25" />
          <h2 className="mx-auto max-w-[760px] font-display text-[28px] font-semibold leading-[1.08] tracking-[-0.02em] sm:text-[48px]">Give your community a home that costs nothing to keep.</h2>
          <p className="mx-auto mt-3 max-w-[560px] text-[16px] text-navy-200 sm:mt-5 sm:text-lg">Request access today and start in a private sandbox. No credit card needed.</p>
          <div className="mt-6 flex flex-col items-center justify-center gap-2.5 sm:mt-8 sm:flex-row sm:gap-3">
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
