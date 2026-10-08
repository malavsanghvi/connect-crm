import { Logo, PRODUCT_MENU, RESOURCES_MENU, SOLUTIONS_MENU } from "@/components/site/header";
import { SiteLink, container } from "@/components/site/ui";
import { GENEROSITY_LINE } from "@/lib/brand";
import { SITE_NAME, SITE_TAGLINE, portalUrl } from "@/lib/site";

export function SiteFooter() {
  const link = "flex min-h-[44px] items-center text-[15px] text-navy-200 transition-colors hover:text-white";
  const heading = "text-[13px] font-bold uppercase tracking-[0.08em] text-gold";
  return (
    <footer className="bg-navy text-white">
      <div className={`${container} grid grid-cols-1 gap-10 py-16 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr]`}>
        <div className="flex max-w-[320px] flex-col gap-5 sm:col-span-2 lg:col-span-1">
          <Logo light />
          <p className="text-[15px] font-bold text-gold">{GENEROSITY_LINE}</p>
          <p className="text-[15px] leading-relaxed text-navy-200">{SITE_TAGLINE}. Members, households, events, giving, learning and accounting in one trusted place.</p>
          <a href={portalUrl("/request-access")} className="inline-flex min-h-[48px] w-fit items-center rounded-full bg-gold px-6 text-[15px] font-bold text-navy hover:bg-[#ffc84a]">
            Get started free
          </a>
        </div>
        <nav aria-label="Product" className="flex flex-col">
          <h2 className={heading}>Product</h2>
          {PRODUCT_MENU.map((item) => (
            <SiteLink key={item.to} to={item.to} className={link}>
              {item.title}
            </SiteLink>
          ))}
        </nav>
        <nav aria-label="Solutions" className="flex flex-col">
          <h2 className={heading}>Solutions</h2>
          {SOLUTIONS_MENU.map((item) => (
            <SiteLink key={item.to} to={item.to} className={link}>
              {item.title}
            </SiteLink>
          ))}
        </nav>
        <nav aria-label="Resources" className="flex flex-col">
          <h2 className={heading}>Resources</h2>
          <SiteLink to="/pricing" className={link}>
            Pricing
          </SiteLink>
          {RESOURCES_MENU.map((item) => (
            <SiteLink key={item.to} to={item.to} className={link}>
              {item.title}
            </SiteLink>
          ))}
        </nav>
        <nav aria-label="Get started" className="flex flex-col">
          <h2 className={heading}>Get started</h2>
          <a href={portalUrl("/request-access")} className={link}>
            Request access
          </a>
          <a href={portalUrl("/start")} className={link}>
            I have a code
          </a>
          <a href={portalUrl("/login")} className={link}>
            Sign in
          </a>
        </nav>
      </div>
      <div className="border-t border-white/10">
        <div className={`${container} flex flex-col gap-2 py-6 text-[13px] text-navy-300 sm:flex-row sm:items-center sm:justify-between`}>
          <p>
            © {new Date().getFullYear()} {SITE_NAME}. All rights reserved.
          </p>
          <p>Screens on this site show sample data, not real members.</p>
        </div>
      </div>
    </footer>
  );
}
