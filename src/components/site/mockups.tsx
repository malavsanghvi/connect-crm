import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/site/icons";
import { TIP_YEARLY_CAP_CENTS, usd } from "@/lib/site";

// Illustrative screens drawn in HTML and CSS (no screenshots, no real people). Every figure and name here is sample data.

function WindowFrame({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-[20px] border border-line bg-white shadow-[0_30px_60px_-20px_rgba(27,44,92,0.35)] ${className}`}>
      <div className="flex items-center gap-2 border-b border-line-soft bg-ground px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#e5836f]" />
        <span className="h-2.5 w-2.5 rounded-full bg-gold" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#7dbb97]" />
        <span className="ml-3 truncate text-[12px] font-semibold text-muted">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Pill({ children, tone }: { children: ReactNode; tone: "navy" | "saffron" | "success" | "purple" | "maroon" }) {
  const tones = {
    navy: "bg-navy-50 text-navy",
    saffron: "bg-saffron-50 text-brown",
    success: "bg-success-50 text-success-900",
    purple: "bg-purple-50 text-purple-900",
    maroon: "bg-danger-50 text-maroon",
  } as const;
  return <span className={`rounded-lg px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${tones[tone]}`}>{children}</span>;
}

/** The admin portal's home: tasks and numbers at a glance. */
export function DashboardMock({ className = "" }: { className?: string }) {
  const tasks: { tag: string; tone: "navy" | "saffron" | "success" | "purple" | "maroon"; title: string; meta: string }[] = [
    { tag: "Membership", tone: "navy", title: "3 new family applications", meta: "Waiting for a reference to approve" },
    { tag: "Deposit", tone: "saffron", title: "Match this week's Zelle payments", meta: "11 exact matches ready to confirm" },
    { tag: "Event", tone: "maroon", title: "Annual dinner: lunch slots are 90% full", meta: "Open 2 more tables?" },
  ];
  return (
    <WindowFrame title="Sample Community · Home" className={className}>
      <div className="bg-canvas p-5">
        <p className="font-display text-[22px] font-semibold text-navy">Good morning, Priya</p>
        <p className="text-[13px] text-muted">My tasks across every module you can act on</p>
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          {[
            ["Households", "412"],
            ["Pledged this year", "$38,250"],
            ["Events this month", "6"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-ground p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
              <p className="mt-0.5 font-display text-[20px] font-semibold text-navy">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-xl border border-line bg-white">
          {tasks.map((t) => (
            <div key={t.title} className="flex items-center gap-3 border-b border-line-soft px-3.5 py-3 last:border-b-0">
              <Pill tone={t.tone}>{t.tag}</Pill>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-ink">{t.title}</p>
                <p className="truncate text-[12px] text-muted">{t.meta}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </WindowFrame>
  );
}

/** The member app on a phone: an event and a pledge. */
export function PhoneMock({ className = "" }: { className?: string }) {
  const nav: [IconName, string, boolean][] = [
    ["home", "Home", true],
    ["calendar", "Events", false],
    ["heart", "Give", false],
    ["book", "Learn", false],
    ["users", "Family", false],
  ];
  return (
    <div className={`mx-auto w-[270px] rounded-[38px] border-[7px] border-navy bg-navy shadow-[0_30px_60px_-20px_rgba(27,44,92,0.5)] ${className}`}>
      <div className="overflow-hidden rounded-[30px] bg-canvas">
        <div className="bg-navy px-4 pb-4 pt-5 text-white">
          <p className="text-[11px] font-semibold text-navy-200">Sample Community</p>
          <p className="font-display text-[19px] font-semibold">Welcome, the Shah family</p>
        </div>
        <div className="flex flex-col gap-2.5 p-3.5">
          <div className="rounded-2xl bg-white p-3.5 shadow-sm">
            <Pill tone="maroon">Event</Pill>
            <p className="mt-1.5 text-[14px] font-bold text-ink">Diwali celebration</p>
            <p className="text-[12px] text-muted">Saturday, 6:30 PM · Main hall</p>
            <div className="mt-2.5 flex gap-2">
              <span className="flex-1 rounded-full bg-navy py-2 text-center text-[12px] font-bold text-white">RSVP</span>
              <span className="flex-1 rounded-full border border-line-input py-2 text-center text-[12px] font-bold text-navy">Lunch slot</span>
            </div>
          </div>
          <div className="rounded-2xl bg-white p-3.5 shadow-sm">
            <Pill tone="saffron">Giving</Pill>
            <p className="mt-1.5 text-[14px] font-bold text-ink">Annual pledge</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-track">
              <div className="h-full w-[62%] rounded-full bg-saffron" />
            </div>
            <p className="mt-1.5 text-[12px] text-muted">$310 of $501 paid</p>
          </div>
          <div className="rounded-2xl bg-white p-3.5 shadow-sm">
            <Pill tone="purple">Learning</Pill>
            <p className="mt-1.5 text-[14px] font-bold text-ink">Level 2 · this week&apos;s lesson</p>
          </div>
        </div>
        <div className="flex justify-between border-t border-line bg-white px-3 py-2.5">
          {nav.map(([icon, label, active]) => (
            <span key={label} className={`flex flex-col items-center gap-0.5 text-[10px] font-semibold ${active ? "text-navy" : "text-faint"}`}>
              <Icon name={icon} className="h-[18px] w-[18px]" />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A household card: the ids, not just a name. */
export function HouseholdMock({ className = "" }: { className?: string }) {
  const rows: [string, string][] = [
    ["Connect number", "H-2041"],
    ["Your old member ID", "0417"],
    ["Your old household ID", "0212"],
    ["Bank payer name", "RAHUL SHAH"],
  ];
  return (
    <WindowFrame title="Sample Community · Households" className={className}>
      <div className="flex flex-col gap-4 bg-canvas p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-[20px] font-semibold text-navy">Shah family</p>
            <p className="text-[12px] text-muted">Rahul &amp; Mira · 4 members · Zone West</p>
          </div>
          <Pill tone="success">Yearly member</Pill>
        </div>
        <dl className="grid grid-cols-2 gap-2">
          {rows.map(([k, v]) => (
            <div key={k} className="rounded-xl bg-ground p-2.5">
              <dt className="text-[10px] font-bold uppercase tracking-wide text-muted">{k}</dt>
              <dd className="mt-0.5 font-mono text-[13px] font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="rounded-xl border border-line bg-white p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Two households with a similar name?</p>
          <p className="mt-1 text-[13px] text-ink-2">Every search shows the ID, the members and the last gift, so the right family is never a guess.</p>
        </div>
      </div>
    </WindowFrame>
  );
}

/** Giving and accounting: a bank line matched to a household. */
export function GivingMock({ className = "" }: { className?: string }) {
  return (
    <WindowFrame title="Sample Community · Giving · Bank matching" className={className}>
      <div className="flex flex-col gap-3 bg-canvas p-5">
        <div className="rounded-xl border border-line bg-white p-3.5">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[12px] font-semibold text-ink">ZELLE FROM RAHUL SHAH</p>
            <p className="font-display text-[18px] font-semibold text-navy">$251.00</p>
          </div>
          <p className="mt-1 text-[12px] text-muted">Posted Tuesday · matched by a name used before</p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-success-200 bg-success-50 p-3.5">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-success text-white">
            <Icon name="check" className="h-5 w-5" strokeWidth={3} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-success-900">Shah family · household H-2041</p>
            <p className="text-[12px] text-success-900/80">Applied to the Annual pledge. Queued for QuickBooks.</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {["Card via Stripe", "Zelle", "Checks & cash"].map((m) => (
            <span key={m} className="rounded-xl bg-ground px-2 py-2.5 text-center text-[11px] font-bold text-navy">
              {m}
            </span>
          ))}
        </div>
      </div>
    </WindowFrame>
  );
}

/** Event day: tickets and check-in. */
export function EventMock({ className = "" }: { className?: string }) {
  return (
    <WindowFrame title="Sample Community · Event day" className={className}>
      <div className="flex flex-col gap-3 bg-canvas p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display text-[20px] font-semibold text-navy">Annual dinner</p>
            <p className="text-[12px] text-muted">Checked in so far</p>
          </div>
          <p className="font-display text-[30px] font-semibold text-success">186 / 240</p>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-track">
          <div className="h-full w-[77%] rounded-full bg-success" />
        </div>
        <div className="rounded-xl border border-line bg-white">
          {[
            ["Mehta family", "4 guests", "Checked in"],
            ["Desai family", "2 guests", "Checked in"],
            ["Patel family", "5 guests", "Expected"],
          ].map(([name, guests, state]) => (
            <div key={name} className="flex items-center justify-between gap-3 border-b border-line-soft px-3.5 py-2.5 last:border-b-0">
              <div>
                <p className="text-[13px] font-bold text-ink">{name}</p>
                <p className="text-[12px] text-muted">{guests}</p>
              </div>
              <Pill tone={state === "Checked in" ? "success" : "navy"}>{state}</Pill>
            </div>
          ))}
        </div>
      </div>
    </WindowFrame>
  );
}

/** Classes: attendance and homework. */
export function LearningMock({ className = "" }: { className?: string }) {
  return (
    <WindowFrame title="Sample Community · Classes" className={className}>
      <div className="flex flex-col gap-3 bg-canvas p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-[20px] font-semibold text-navy">Level 2 · Fall term</p>
            <p className="text-[12px] text-muted">Sunday 10:00 AM · Room 4</p>
          </div>
          <Pill tone="purple">Class</Pill>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-xl bg-ground p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Present today</p>
            <p className="mt-0.5 font-display text-[22px] font-semibold text-navy">18 of 21</p>
          </div>
          <div className="rounded-xl bg-ground p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Homework handed in</p>
            <p className="mt-0.5 font-display text-[22px] font-semibold text-navy">14 of 21</p>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-white p-3.5">
          <div className="flex items-center justify-between text-[12px] font-bold text-ink">
            <span>This week&apos;s lesson</span>
            <span className="text-success">67%</span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-track">
            <div className="h-full w-[67%] rounded-full bg-success" />
          </div>
          <p className="mt-2 text-[12px] text-muted">Parents see their child&apos;s progress in the member app.</p>
        </div>
      </div>
    </WindowFrame>
  );
}

/** A small floating note beside the hero screens. */
export function FloatChip({ icon, tone, title, body, className = "", delay = "0s" }: { icon: IconName; tone: "success" | "saffron" | "navy"; title: string; body: string; className?: string; delay?: string }) {
  const tones = { success: "bg-success text-white", saffron: "bg-gold text-navy", navy: "bg-navy text-white" } as const;
  return (
    <div
      aria-hidden
      style={{ animationDelay: delay }}
      className={`absolute z-20 hidden items-center gap-3 rounded-2xl border border-line bg-white/95 py-2.5 pl-2.5 pr-4 shadow-[0_18px_40px_-12px_rgba(27,44,92,0.4)] backdrop-blur motion-safe:animate-site-float sm:flex ${className}`}
    >
      <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl ${tones[tone]}`}>
        <Icon name={icon} className="h-[18px] w-[18px]" />
      </span>
      <span>
        <span className="block text-[13px] font-bold leading-tight text-ink">{title}</span>
        <span className="block text-[12px] leading-tight text-muted">{body}</span>
      </span>
    </div>
  );
}

/** The optional tip at checkout, with the yearly cap. A sketch of the promise on the pricing page, not a screenshot. */
export function TipCheckoutMock({ className = "" }: { className?: string }) {
  const cap = usd(TIP_YEARLY_CAP_CENTS);
  return (
    <div className={`overflow-hidden rounded-[24px] border border-line bg-white shadow-[0_30px_60px_-20px_rgba(27,44,92,0.35)] ${className}`}>
      <div className="border-b border-line-soft bg-ground px-5 py-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Checkout · example</p>
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <p className="text-[15px] font-bold text-ink">Family membership, one year</p>
          <p className="font-display text-[20px] font-semibold text-navy">$150.00</p>
        </div>
      </div>
      <div className="flex flex-col gap-4 p-5">
        <div>
          <p className="text-[15px] font-bold text-navy">Add an optional tip to keep Weaver AMS free?</p>
          <p className="mt-1 text-[13px] leading-snug text-muted">Your community pays nothing for this platform. Members like you keep it going.</p>
        </div>
        <div className="grid grid-cols-4 gap-2" role="presentation">
          {[
            { label: "No tip", on: false },
            { label: "$2", on: false },
            { label: "$5", on: true },
            { label: "$10", on: false },
          ].map(({ label, on }) => (
            <span
              key={label}
              className={`flex min-h-[44px] items-center justify-center rounded-xl border-2 text-[14px] font-bold ${on ? "border-navy bg-navy text-white" : "border-line-input bg-white text-navy"}`}
            >
              {label}
            </span>
          ))}
        </div>
        <div className="rounded-xl bg-saffron-50 p-3.5">
          <div className="flex items-center justify-between text-[12px] font-bold text-brown">
            <span>Your tips this year</span>
            <span>$15 of {cap}</span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white">
            <div className="h-full w-[60%] rounded-full bg-saffron" />
          </div>
          <p className="mt-2 text-[12px] leading-snug text-brown">We never ask for more than {cap} a year from one account, across every payment.</p>
        </div>
        <div className="flex items-center justify-between border-t border-line-soft pt-4">
          <span className="text-[14px] font-bold text-ink">Total today</span>
          <span className="font-display text-[22px] font-semibold text-navy">$155.00</span>
        </div>
      </div>
    </div>
  );
}
