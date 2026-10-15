import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Icon } from "@/components/brand/icons";
import { TipCheckoutMock } from "@/components/site/mockups";
import { Eyebrow, FaqList, SectionHeading, SiteLink, Ticks, buttonStyles, container } from "@/components/site/ui";
import { WEAVERS } from "@/components/site/weavers";
import { SITE_NAME, portalUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `Pricing: totally free, forever · ${SITE_NAME}` },
  description: `${SITE_NAME} is free for your organization, forever: no subscription, no setup fee, no per-member charge. Members will be able to add an optional Chip In, with a yearly limit on each account.`,
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
        <div className="mx-auto grid max-w-[980px] grid-cols-1 overflow-hidden rounded-hero border-2 border-navy bg-white shadow-hero lg:grid-cols-[0.9fr_1.1fr]">
          <div className="flex flex-col items-start gap-4 bg-navy p-8 text-white sm:p-12">
            <span className="rounded-full bg-white/10 px-3.5 py-1.5 text-[13px] font-bold uppercase tracking-[0.08em] text-gold">One plan for everyone</span>
            <h2 id="plan-title" className="font-display text-[26px] font-semibold">
              {SITE_NAME}
            </h2>
            <p className="font-display text-[104px] font-semibold leading-[0.9] sm:text-[120px]">$0</p>
            <p className="text-lg font-semibold text-navy-200">for your organization, always</p>
            <p className="text-[15px] leading-relaxed text-navy-300">No credit card to start. Start in a private sandbox and go live when you are ready.</p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {WEAVERS.map((w) => (
                <span key={w.id} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-bold text-white">
                  <Icon name={w.icon} className="h-3.5 w-3.5 text-gold" />
                  {w.name}
                </span>
              ))}
              <span className="text-[13px] text-navy-300">The same plan, free for all three.</span>
            </div>
            <div className="mt-2 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <a href={portalUrl("/request-access")} className={`${buttonStyles.gold} w-full sm:w-auto`}>
                Get started free
                <Icon name="arrow" className="h-5 w-5" />
              </a>
              <a href={portalUrl("/demo")} className={`${buttonStyles.ghostOnNavy} w-full sm:w-auto`}>
                Try the demo
              </a>
            </div>
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
    <li className="flex flex-col gap-3 rounded-card border border-line bg-white p-6">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-saffron-50 font-display text-[20px] font-semibold text-brown">{n}</span>
      <h3 className="font-display text-[22px] font-semibold text-navy">{title}</h3>
      <p className="text-[16px] leading-relaxed text-muted">{body}</p>
    </li>
  );
}

/**
 * The three things that can happen at checkout. No amounts on purpose: the yearly limit is a per-organization setting (owner
 * decision 2026-10-15), so the page states no number, and in every case the organization pays us nothing.
 */
const CHECKOUT_CASES: { when: string; pays: string; you: string }[] = [
  { when: "Leaves “No Chip In” selected", pays: "Exactly what you charged", you: "Nothing" },
  { when: "Adds a Chip In", pays: "What you charged, plus their Chip In", you: "Nothing: the Chip In is added on top" },
  { when: "Has reached their yearly limit", pays: "Exactly what you charged; we do not ask", you: "Nothing" },
];

function HowWeStayFree() {
  return (
    <section id="how-we-stay-free" className="scroll-mt-24 bg-ground py-20 sm:py-28">
      <div className={`${container} flex flex-col gap-16`}>
        <SectionHeading
          eyebrow="How we stay free"
          title="We run on the generosity of your members"
          lead={`${SITE_NAME} is free for your organization because the people it serves can chip in. When a member pays dues, buys a ticket or gives, we will offer an optional Chip In to help keep the platform free and the experience great. That is the whole model.`}
        />

        <ol className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Step n="1" title="A member pays" body="Dues, a donation, a pledge payment, a ticket or a purchase, in the member app or on the web." />
          <Step
            n="2"
            title="They see an optional Chip In"
            body="Suggested amounts will appear at checkout. “No Chip In” is selected unless the member picks an amount, and going back to it is one tap. Paying never requires a Chip In."
          />
          <Step
            n="3"
            title="Your organization pays nothing"
            body="The Chip In is added on top. The price, dues or pledge you set does not change, and you never receive a bill from us."
          />
        </ol>

        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_0.9fr] lg:gap-16">
          <div className="flex flex-col items-start gap-6">
            <span className="text-[13px] font-bold uppercase tracking-[0.08em] text-brown">Our promise to your members</span>
            <h3 className="font-display text-[32px] font-semibold leading-[1.1] tracking-[-0.01em] text-navy sm:text-[42px]">
              Always optional, with a yearly limit on every account
            </h3>
            <p className="text-[17px] leading-relaxed text-muted">
              Every account has a yearly limit on Chip Ins, counted per calendar year across every transaction and set separately for each organization. Once an account reaches it, we stop asking until the next year. A member who gives all year long is never asked for more, and your organization never has to pay.
            </p>
            <Ticks
              items={[
                "Always optional: one tap on “No Chip In” and they pay exactly what you charged",
                "A yearly limit on every account, however often they pay",
                "Added on top of the amount you set, never taken out of it",
                "Your organization never pays us, and we take no percentage of what your members pay you",
              ]}
            />
          </div>
          <TipCheckoutMock className="mx-auto w-full max-w-[420px]" />
        </div>

        <div className="mx-auto w-full max-w-[860px]">
          <h3 className="text-center font-display text-[26px] font-semibold text-navy">What happens at checkout</h3>
          <p className="mt-2 text-center text-[15px] text-muted">Three cases. Whatever a member chooses, the price your organization set does not change.</p>
          <div className="mt-6 overflow-x-auto rounded-window border border-line bg-white">
            <table className="w-full min-w-[560px] border-collapse text-left text-[15px]">
              <caption className="sr-only">What a member pays, and what your organization pays us, in each of the three cases at checkout</caption>
              <thead>
                <tr className="bg-canvas text-[12px] font-bold uppercase tracking-wide text-muted">
                  <th scope="col" className="px-5 py-3">When a member</th>
                  <th scope="col" className="px-5 py-3">They pay</th>
                  <th scope="col" className="px-5 py-3">Your organization pays us</th>
                </tr>
              </thead>
              <tbody>
                {CHECKOUT_CASES.map((row) => (
                  <tr key={row.when} className="border-t border-line-soft">
                    <th scope="row" className="px-5 py-3.5 font-semibold text-ink">{row.when}</th>
                    <td className="px-5 py-3.5 text-ink-2">{row.pays}</td>
                    <td className="px-5 py-3.5 font-bold text-success-900">
                      <span className="inline-flex items-center gap-2">
                        <Icon name="check" className="h-4 w-4 flex-none" strokeWidth={3} />
                        {row.you}
                      </span>
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
        <div className="mx-auto w-full max-w-[860px] overflow-x-auto rounded-card border border-line bg-white">
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
              a: `There is no catch. Your organization never pays us. ${SITE_NAME} is supported by optional Chip Ins that members will be able to add, with a yearly limit on each account.`,
            },
            {
              q: "What if a member does not want to Chip In?",
              a: "“No Chip In” is selected unless they pick an amount, so they pay exactly what you charged. Their payment is not slower, and nothing about their membership changes.",
            },
            {
              q: "Why is there a yearly limit?",
              a: "We never want generosity to feel like a bill. Each account has a limit on Chip Ins, counted per calendar year across every payment and set separately for each organization. Once an account reaches it, we stop asking until the next year, however many times it pays. Until a limit is set for an organization, its members are not asked for a Chip In at all.",
            },
            {
              q: "Do you take a percentage of payments?",
              a: "No. We do not take a cut of what your members pay your organization. A Chip In, when a member chooses one, is a separate amount added on top.",
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
              q: "What do Chip Ins pay for?",
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
