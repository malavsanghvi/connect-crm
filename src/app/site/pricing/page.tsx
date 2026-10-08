import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Icon } from "@/components/site/icons";
import { TipCheckoutMock } from "@/components/site/mockups";
import { Eyebrow, FaqList, SectionHeading, SiteLink, Ticks, buttonStyles, container } from "@/components/site/ui";
import { SITE_NAME, TIP_YEARLY_CAP_CENTS, portalUrl, usd } from "@/lib/site";

const CAP = usd(TIP_YEARLY_CAP_CENTS);

export const metadata: Metadata = {
  title: { absolute: `Pricing: totally free, forever · ${SITE_NAME}` },
  description: `${SITE_NAME} is free for your organization, forever: no subscription, no setup fee, no per-member charge. Members may add a small optional tip, capped at ${CAP} a year per account.`,
  alternates: { canonical: "/pricing" },
  openGraph: { url: "/pricing" },
};

export default function PricingPage() {
  return (
    <>
      <Hero />
      <PlanCard />
      <HowWeStayFree />
      <Compare />
      <Faq />
      <FinalCta />
    </>
  );
}

function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <div aria-hidden className="absolute -left-32 -top-32 -z-10 h-[460px] w-[460px] rounded-full bg-saffron-50" />
      <div aria-hidden className="absolute -right-40 top-0 -z-10 h-[520px] w-[520px] rounded-full bg-navy-50" />
      <div className={`${container} flex flex-col items-center gap-6 pb-10 pt-14 text-center sm:pt-20`}>
        <Eyebrow>Pricing</Eyebrow>
        <h1 className="font-display text-[48px] font-semibold leading-[1.02] tracking-[-0.025em] text-navy sm:text-[72px] lg:text-[84px]">
          Totally free.{" "}
          <span className="relative isolate inline-block">
            <span aria-hidden className="absolute inset-x-[-4px] bottom-[6px] -z-10 h-[0.3em] rounded-md bg-gold/80" />
            Forever.
          </span>
        </h1>
        <p className="max-w-[640px] text-lg leading-relaxed text-muted sm:text-xl">
          {SITE_NAME} costs your organization nothing: no subscription, no setup fee, no per-member charge and no contract. Not for the first member, and not for the ten-thousandth.
        </p>
      </div>
    </section>
  );
}

function PlanCard() {
  return (
    <section aria-labelledby="plan-title" className="pb-20 sm:pb-28">
      <div className={container}>
        <div className="mx-auto grid max-w-[980px] grid-cols-1 overflow-hidden rounded-[32px] border-2 border-navy bg-white shadow-[0_30px_60px_-24px_rgba(27,44,92,0.4)] lg:grid-cols-[0.9fr_1.1fr]">
          <div className="flex flex-col items-start gap-4 bg-navy p-8 text-white sm:p-12">
            <span className="rounded-full bg-white/10 px-3.5 py-1.5 text-[13px] font-bold uppercase tracking-[0.08em] text-gold">One plan for everyone</span>
            <h2 id="plan-title" className="font-display text-[26px] font-semibold">
              {SITE_NAME}
            </h2>
            <p className="font-display text-[104px] font-semibold leading-[0.9] sm:text-[120px]">$0</p>
            <p className="text-lg font-semibold text-navy-200">for your organization, always</p>
            <p className="text-[15px] leading-relaxed text-navy-300">No credit card to start. Start in a private sandbox and go live when you are ready.</p>
            <a href={portalUrl("/request-access")} className={`${buttonStyles.gold} mt-2 w-full sm:w-auto`}>
              Get started free
              <Icon name="arrow" className="h-5 w-5" />
            </a>
          </div>
          <div className="p-8 sm:p-12">
            <p className="mb-5 text-[13px] font-bold uppercase tracking-[0.08em] text-brown">Every feature is included</p>
            <Ticks
              items={[
                "Members, households and memberships",
                "Events, tickets, lunch and event-day check-in",
                "Giving, pledges, recurring gifts and bank matching",
                "QuickBooks accounting",
                "Classes, attendance, homework and learning paths",
                "Community store, messages and volunteers",
                "The member app for phones and web browsers",
                "English, ગુજરાતી and हिन्दी",
                "Roles, approvals and a full history of changes",
                "A private sandbox to practice in first",
              ]}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 rounded-[24px] border border-line bg-white p-6">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-saffron-50 font-display text-[20px] font-semibold text-brown">{n}</span>
      <h3 className="font-display text-[22px] font-semibold text-navy">{title}</h3>
      <p className="text-[16px] leading-relaxed text-muted">{body}</p>
    </li>
  );
}

const EXAMPLE: { what: string; cents: number; tip: number; total: number }[] = [
  { what: "Family membership for the year", cents: 15_000, tip: 500, total: 500 },
  { what: "Event tickets", cents: 6_000, tip: 300, total: 800 },
  { what: "Pledge payment", cents: 50_100, tip: 1_000, total: 1_800 },
  { what: "Donation", cents: 25_000, tip: 700, total: TIP_YEARLY_CAP_CENTS },
  { what: "Any payment after that, this year", cents: 10_000, tip: 0, total: TIP_YEARLY_CAP_CENTS },
];

function HowWeStayFree() {
  return (
    <section id="how-we-stay-free" className="scroll-mt-24 bg-ground py-20 sm:py-28">
      <div className={`${container} flex flex-col gap-16`}>
        <SectionHeading
          eyebrow="How we stay free"
          title="We run on the generosity of your members"
          lead={`${SITE_NAME} is free for your organization because the people it serves chip in. When a member pays dues, buys a ticket or gives, we suggest a small optional tip to help keep the platform free and the experience great. That is the whole model.`}
        />

        <ol className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Step n="1" title="A member pays" body="Dues, a donation, a pledge payment, a ticket or a purchase, in the member app or on the web." />
          <Step
            n="2"
            title="They see an optional tip"
            body="A small suggested tip appears at checkout. They can change it or choose no tip in one tap. Paying never requires a tip."
          />
          <Step
            n="3"
            title="Your organization pays nothing"
            body="The tip is added on top. The price, dues or pledge you set does not change, and you never receive a bill from us."
          />
        </ol>

        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_0.9fr] lg:gap-16">
          <div className="flex flex-col items-start gap-6">
            <span className="text-[13px] font-bold uppercase tracking-[0.08em] text-brown">Our promise to your members</span>
            <h3 className="font-display text-[32px] font-semibold leading-[1.1] tracking-[-0.01em] text-navy sm:text-[42px]">
              Never more than {CAP} a year, per account
            </h3>
            <p className="text-[17px] leading-relaxed text-muted">
              We cap tips at {CAP} per account per year, in total across every transaction. Once an account reaches {CAP}, we stop asking until the next year. A member who gives all year long is never asked for more, and your organization never has to pay.
            </p>
            <Ticks
              items={[
                "Always optional: one tap on “No tip” and they pay exactly what you charged",
                `Capped at ${CAP} per account per year, however often they pay`,
                "Added on top of the amount you set, never taken out of it",
                "We take no percentage of what your members pay you",
              ]}
            />
          </div>
          <TipCheckoutMock className="mx-auto w-full max-w-[420px]" />
        </div>

        <div className="mx-auto w-full max-w-[860px]">
          <h3 className="text-center font-display text-[26px] font-semibold text-navy">What the cap looks like over a year</h3>
          <p className="mt-2 text-center text-[15px] text-muted">An example for one account. The amounts are illustrative.</p>
          <div className="mt-6 overflow-x-auto rounded-[20px] border border-line bg-white">
            <table className="w-full min-w-[560px] border-collapse text-left text-[15px]">
              <caption className="sr-only">Example of one account&apos;s optional tips over a year, ending at the {CAP} cap</caption>
              <thead>
                <tr className="bg-canvas text-[12px] font-bold uppercase tracking-wide text-muted">
                  <th scope="col" className="px-5 py-3">Payment</th>
                  <th scope="col" className="px-5 py-3 text-right">Amount</th>
                  <th scope="col" className="px-5 py-3 text-right">Optional tip</th>
                  <th scope="col" className="px-5 py-3 text-right">Tips so far</th>
                </tr>
              </thead>
              <tbody>
                {EXAMPLE.map((row) => (
                  <tr key={row.what} className="border-t border-line-soft">
                    <th scope="row" className="px-5 py-3.5 font-semibold text-ink">{row.what}</th>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-2">{usd(row.cents)}</td>
                    <td className="px-5 py-3.5 text-right font-bold tabular-nums text-navy">{row.tip === 0 ? "None asked" : usd(row.tip)}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-2">
                      {usd(row.total)} of {CAP}
                      {row.total === TIP_YEARLY_CAP_CENTS ? <span className="ml-2 rounded-lg bg-success-50 px-2 py-0.5 text-[11px] font-bold uppercase text-success-900">Cap reached</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function Compare() {
  const rows: [string, string][] = [
    ["A monthly or yearly subscription", "Often charged"],
    ["A setup or onboarding fee", "Often charged"],
    ["A charge per member or per contact", "Often charged"],
    ["A percentage of every payment", "Often taken"],
    ["A long-term contract", "Often required"],
    ["Features held back for higher tiers", "Often"],
  ];
  return (
    <section className="py-20 sm:py-28">
      <div className={`${container} flex flex-col gap-10`}>
        <SectionHeading title="What you will not pay for" lead="Many membership systems charge for each of these. We charge for none of them." />
        <div className="mx-auto w-full max-w-[860px] overflow-x-auto rounded-[24px] border border-line bg-white">
          <table className="w-full min-w-[520px] border-collapse text-left text-[16px]">
            <caption className="sr-only">What many membership systems charge for, compared with {SITE_NAME}</caption>
            <thead>
              <tr className="bg-canvas text-[12px] font-bold uppercase tracking-wide text-muted">
                <th scope="col" className="px-5 py-3.5"><span className="sr-only">Charge</span></th>
                <th scope="col" className="px-5 py-3.5">Many other systems</th>
                <th scope="col" className="bg-success-50 px-5 py-3.5 text-success-900">{SITE_NAME}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([what, other]) => (
                <tr key={what} className="border-t border-line-soft">
                  <th scope="row" className="px-5 py-4 font-semibold text-ink">{what}</th>
                  <td className="px-5 py-4 text-muted">{other}</td>
                  <td className="bg-success-50/50 px-5 py-4 font-bold text-success-900">
                    <span className="inline-flex items-center gap-2">
                      <Icon name="check" className="h-4 w-4" strokeWidth={3} />
                      Never
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 bg-white py-20 sm:py-28">
      <div className={`${container} flex flex-col gap-12`}>
        <SectionHeading eyebrow="Pricing questions" title="Everything you might ask about the price" />
        <FaqList
          items={[
            {
              q: "Is it really free? What is the catch?",
              a: `There is no catch. Your organization never pays us. ${SITE_NAME} is supported by small, optional tips from members, capped at ${CAP} a year per account.`,
            },
            {
              q: "What if a member does not want to tip?",
              a: "They choose “No tip” and pay exactly what you charged. Their payment is not slower, and nothing about their membership changes.",
            },
            {
              q: `Why is there a ${CAP} cap?`,
              a: "We never want generosity to feel like a bill. The cap guarantees that no account is asked for more than the limit in a year, however many times it pays.",
            },
            {
              q: "Do you take a percentage of payments?",
              a: "No. We do not take a cut of what your members pay your organization. A tip, when a member chooses one, is a separate amount added on top.",
            },
            {
              q: "Are there payment processing fees?",
              a: `${SITE_NAME} adds no fees of its own. Card payments are processed by Stripe through your organization's own Stripe account at Stripe's rates, and nonprofits can apply to Stripe for reduced pricing. Zelle, checks and cash are recorded and matched in ${SITE_NAME} at no charge.`,
            },
            {
              q: "Will it stay free?",
              a: `Yes. Free for organizations is the promise ${SITE_NAME} is built on.`,
            },
            {
              q: "What do tips pay for?",
              a: "Hosting, security, support and the continued development of the platform.",
            },
          ]}
        />
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="py-20 sm:py-28">
      <div className={container}>
        <div className="relative isolate overflow-hidden rounded-[36px] bg-navy px-6 py-16 text-center text-white sm:px-12 sm:py-20">
          <div aria-hidden className="absolute -right-24 -top-24 -z-10 h-[320px] w-[320px] rounded-full bg-white/5" />
          <div aria-hidden className="absolute -bottom-32 -left-20 -z-10 h-[360px] w-[360px] rounded-full bg-saffron/20" />
          <h2 className="mx-auto max-w-[720px] font-display text-[34px] font-semibold leading-[1.08] tracking-[-0.015em] sm:text-[50px]">Start free today. Stay free forever.</h2>
          <p className="mx-auto mt-5 max-w-[560px] text-lg text-navy-200">Request access and practice in a private sandbox. No credit card needed.</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href={portalUrl("/request-access")} className={buttonStyles.gold}>
              Get started free
              <Icon name="arrow" className="h-5 w-5" />
            </a>
            <SiteLink to="/" className={buttonStyles.ghostOnNavy}>
              Explore the features
            </SiteLink>
          </div>
        </div>
      </div>
    </section>
  );
}
