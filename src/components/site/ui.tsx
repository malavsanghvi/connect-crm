import { headers } from "next/headers";
import Link from "next/link";
import { cache, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/site/icons";
import { isPublicSiteHost } from "@/lib/site";

/** "" on the website's own hosts (it is served at /), "/site" on any other host (the preview address). */
const siteBase = cache(async (): Promise<string> => (isPublicSiteHost((await headers()).get("host")) ? "" : "/site"));

/** A link to another page of the website that works on the website's hosts and on the preview address. */
export async function SiteLink({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const base = await siteBase();
  const href = to === "/" ? base || "/" : `${base}${to}`;
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export const container = "mx-auto w-full max-w-[1160px] px-5 sm:px-8";

const BUTTON_BASE =
  "inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full px-7 text-base font-bold transition-colors duration-150 focus-visible:outline-offset-4";
export const buttonStyles = {
  primary: `${BUTTON_BASE} bg-navy text-white hover:bg-navy-hover`,
  gold: `${BUTTON_BASE} bg-gold text-navy hover:bg-[#ffc84a]`,
  ghost: `${BUTTON_BASE} border-2 border-navy/20 bg-white text-navy hover:border-navy`,
  ghostOnNavy: `${BUTTON_BASE} border-2 border-white/30 bg-transparent text-white hover:border-white`,
} as const;

/** The chip above a section heading. */
export function Eyebrow({ children, tone = "saffron" }: { children: ReactNode; tone?: "saffron" | "navy" | "light" }) {
  const tones = {
    saffron: "bg-saffron-50 text-brown",
    navy: "bg-navy-50 text-navy",
    light: "bg-white/10 text-gold",
  } as const;
  return <span className={`inline-flex rounded-full px-3.5 py-1.5 text-[13px] font-bold uppercase tracking-[0.08em] ${tones[tone]}`}>{children}</span>;
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = "center",
  tone = "dark",
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  align?: "center" | "left";
  tone?: "dark" | "light";
}) {
  return (
    <div className={`flex flex-col gap-4 ${align === "center" ? "mx-auto max-w-[760px] items-center text-center" : "max-w-[640px] items-start text-left"}`}>
      {eyebrow ? <Eyebrow tone={tone === "light" ? "light" : "saffron"}>{eyebrow}</Eyebrow> : null}
      <h2 className={`font-display text-[32px] font-semibold leading-[1.1] tracking-[-0.015em] sm:text-[44px] ${tone === "light" ? "text-white" : "text-navy"}`}>{title}</h2>
      {lead ? <p className={`text-[17px] leading-relaxed sm:text-lg ${tone === "light" ? "text-navy-200" : "text-muted"}`}>{lead}</p> : null}
    </div>
  );
}

/** A tick list. */
export function Ticks({ items, tone = "dark" }: { items: ReactNode[]; tone?: "dark" | "light" }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3 text-base leading-snug">
          <span aria-hidden className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full ${tone === "light" ? "bg-gold text-navy" : "bg-success text-white"}`}>
            <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
          <span className={tone === "light" ? "text-navy-100" : "text-ink-2"}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** A round icon on a tinted tile. */
export function IconTile({ name, tone = "navy" }: { name: IconName; tone?: "navy" | "saffron" | "success" | "purple" | "maroon" | "store" }) {
  const tones = {
    navy: "bg-navy-50 text-navy",
    saffron: "bg-saffron-50 text-brown",
    success: "bg-success-50 text-success",
    purple: "bg-purple-50 text-purple",
    maroon: "bg-danger-50 text-maroon",
    store: "bg-store-50 text-store",
  } as const;
  return (
    <span className={`flex h-12 w-12 flex-none items-center justify-center rounded-2xl ${tones[tone]}`}>
      <Icon name={name} className="h-6 w-6" />
    </span>
  );
}

/** Questions and answers that open and close without script. */
export function FaqList({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-3">
      {items.map((item) => (
        <details key={item.q} className="group rounded-2xl border border-line bg-white open:border-navy/30 open:shadow-sm">
          <summary className="flex min-h-[64px] cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-4 text-left text-[17px] font-bold leading-snug text-navy marker:hidden [&::-webkit-details-marker]:hidden">
            {item.q}
            <span aria-hidden className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-navy-50 text-navy transition-transform duration-200 group-open:rotate-180">
              <Icon name="chevron" className="h-4 w-4" strokeWidth={2.5} />
            </span>
          </summary>
          <div className="px-5 pb-5 text-base leading-relaxed text-muted">{item.a}</div>
        </details>
      ))}
    </div>
  );
}
