import { Icon } from "@/components/brand/icons";
import { SectionHeading, buttonStyles, container } from "@/components/site/ui";
import { portalUrl } from "@/lib/site";

/**
 * "Experience Weaver in less than a minute": the home page's way into the demo (the portal's /demo page, docs/DEMO_SIGNIN.md). It says
 * only what the demo does today: three choices and a button, invented people, nothing real is ever sent, payments are only for
 * practice, and the demo starts over every night. In-page anchor: #experience.
 */
const STEPS = [
  { n: "1", title: "Choose a community", text: "A faith-based one, or one that is not." },
  { n: "2", title: "Choose who to be", text: "The treasurer, a teacher, an event lead, a parent: each one sees only what their role allows." },
  { n: "3", title: "Press Start", text: "Explore it with sample data. No sign-up and no email." },
] as const;

export function ExperienceBand() {
  return (
    <section id="experience" aria-labelledby="experience-title" className="scroll-mt-28 py-6 sm:py-10" data-testid="experience-band">
      <div className={container}>
        <div className="flex flex-col items-center gap-8 rounded-[28px] bg-navy px-5 py-10 text-white sm:gap-10 sm:px-10 sm:py-14">
          <SectionHeading
            tone="light"
            titleId="experience-title"
            eyebrow="Try it, no sign-up"
            title="Experience Weaver in less than a minute"
            lead="See what your treasurer, your teachers and a family would see. Everything in the demo is invented: nothing real is ever sent, payments are only for practice, and it starts over every night."
          />
          <ol className="grid w-full max-w-[920px] grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            {STEPS.map((s) => (
              <li key={s.n} className="flex items-start gap-3.5 rounded-2xl border border-white/15 bg-white/5 p-4 sm:flex-col sm:gap-3">
                <span aria-hidden className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gold font-display text-[18px] font-bold text-navy">
                  {s.n}
                </span>
                <div className="min-w-0">
                  <p className="font-display text-[18px] font-semibold leading-tight">{s.title}</p>
                  <p className="mt-1 text-[14.5px] leading-snug text-navy-200">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="flex w-full flex-col items-center gap-3">
            <a href={portalUrl("/demo")} className={`${buttonStyles.gold} !min-h-[56px] !px-8 !text-[17px]`} data-testid="experience-start">
              Start the demo
              <Icon name="arrow" className="h-5 w-5" />
            </a>
            <p className="text-[14px] text-navy-200">Takes about a minute. Nothing to install.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
