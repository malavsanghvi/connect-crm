import { Logo } from "@/components/brand/logo";
import { Icon, type IconName } from "@/components/site/icons";
import { MobileMenu } from "@/components/site/mobile-menu";
import { NavDropdown } from "@/components/site/nav-dropdown";
import { SiteLink, buttonStyles, container } from "@/components/site/ui";
import { WEAVERS } from "@/components/site/weavers";
import { SITE_NAME, TIP_YEARLY_CAP_CENTS, portalUrl, usd } from "@/lib/site";

const CAP = usd(TIP_YEARLY_CAP_CENTS);

type MenuEntry = { to: string; icon: IconName; title: string; body: string };

export const PRODUCT_MENU: MenuEntry[] = [
  { to: "/#product", icon: "users", title: "Members and households", body: "Families, memberships and every ID in one record" },
  { to: "/#product", icon: "heart", title: "Giving and accounting", body: "Pledges, bank matching and QuickBooks" },
  { to: "/#product", icon: "calendar", title: "Events and event day", body: "Tickets, lunch slots and check-in" },
  { to: "/#product", icon: "book", title: "Classes and learning", body: "Terms, attendance and homework" },
  { to: "/#product", icon: "phone", title: "The member app", body: "One sign-in for the whole family" },
  { to: "/#ai", icon: "smile", title: "Niva, the AI assistant", body: "AI does the busywork. People make the final decisions." },
];

/** The three Weavers: each links to its card on the home page. */
export const SOLUTIONS_MENU: MenuEntry[] = WEAVERS.map((w) => ({ to: `/#${w.id}`, icon: w.icon, title: w.name, body: w.menu }));

export const RESOURCES_MENU: MenuEntry[] = [
  { to: "/#get-ready", icon: "check", title: "How it works", body: "From request to going live" },
  { to: "/pricing#how-we-stay-free", icon: "heart", title: "How we stay free", body: `Optional Chip Ins, capped at ${CAP} a year` },
  { to: "/#security", icon: "shield", title: "Security and privacy", body: "How your community's data is protected" },
  { to: "/#own", icon: "lock", title: "No vendor lock-in", body: "Your data is yours, and leaving is easy" },
  { to: "/brand", icon: "globe", title: "Brand and logos", body: "Our logo, colours and words to download" },
  { to: "/#faq", icon: "smile", title: "Questions and answers", body: "The things people ask first" },
];

/** A card in a drop-down panel. */
function PanelLink({ item }: { item: MenuEntry }) {
  return (
    <SiteLink to={item.to} className="group flex items-start gap-3.5 rounded-2xl p-3.5 transition-colors hover:bg-canvas focus-visible:bg-canvas">
      <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-navy-50 text-navy transition-colors group-hover:bg-navy group-hover:text-white">
        <Icon name={item.icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-bold leading-snug text-navy">{item.title}</span>
        <span className="mt-0.5 block text-[13.5px] leading-snug text-muted">{item.body}</span>
      </span>
    </SiteLink>
  );
}

function PanelFooter() {
  return (
    <SiteLink to="/pricing" className="mt-2 flex items-center justify-between gap-3 rounded-2xl bg-saffron-50 px-4 py-3.5 text-[14px] font-bold text-brown transition-colors hover:bg-saffron-200/60">
      <span>Every feature is included. Free for your organization, forever.</span>
      <Icon name="arrow" className="h-4 w-4 flex-none" strokeWidth={2.5} />
    </SiteLink>
  );
}

function MobileGroup({ label, items }: { label: string; items: MenuEntry[] }) {
  return (
    <details className="group border-b border-line-soft">
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between text-[17px] font-bold text-navy marker:hidden [&::-webkit-details-marker]:hidden">
        {label}
        <Icon name="chevron" className="h-5 w-5 transition-transform group-open:rotate-180" strokeWidth={2.5} />
      </summary>
      <div className="flex flex-col pb-3">
        {items.map((item) => (
          <SiteLink key={item.title} to={item.to} className="flex min-h-[48px] items-center gap-3 rounded-xl px-2 text-[15px] font-semibold text-ink-2">
            <Icon name={item.icon} className="h-5 w-5 text-navy" />
            {item.title}
          </SiteLink>
        ))}
      </div>
    </details>
  );
}

/** The thin bar above the header. */
function Announcement() {
  return (
    <div className="bg-navy text-white">
      <div className={`${container} flex min-h-[44px] items-center justify-center gap-2 py-2 text-center text-[14px] font-semibold`}>
        <span className="hidden rounded-full bg-gold px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-navy sm:inline">Free forever</span>
        <span className="text-navy-100">Free for your organization: no subscription, no setup fee and no lock-in.</span>
        <SiteLink to="/pricing#how-we-stay-free" className="inline-flex items-center gap-1 whitespace-nowrap font-bold text-gold underline-offset-4 hover:underline">
          Why it&apos;s free
          <Icon name="arrow" className="h-3.5 w-3.5" strokeWidth={2.5} />
        </SiteLink>
      </div>
    </div>
  );
}

export function SiteHeader() {
  const signIn = portalUrl("/login");
  const start = portalUrl("/request-access");
  const plain = "flex min-h-[48px] items-center rounded-full px-4 text-[15px] font-semibold text-ink-2 transition-colors hover:bg-navy-50 hover:text-navy";
  return (
    <>
      <Announcement />
      {/* Orange, with the darker ink for text so it stays readable on it. */}
      <header className="sticky top-0 z-40 bg-saffron [--color-ink-2:var(--color-ink)]">
        <div className={`${container} relative flex h-[72px] items-center justify-between gap-4`}>
          <SiteLink to="/" className="rounded-xl">
            <span className="sr-only">{SITE_NAME} home</span>
            <Logo onAccent />
          </SiteLink>

          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            <NavDropdown label="Product" width={640}>
              <div className="grid grid-cols-2 gap-1">
                {PRODUCT_MENU.map((item) => (
                  <PanelLink key={item.title} item={item} />
                ))}
              </div>
              <PanelFooter />
            </NavDropdown>
            <NavDropdown label="Solutions" width={440}>
              <div className="flex flex-col gap-1">
                {SOLUTIONS_MENU.map((item) => (
                  <PanelLink key={item.title} item={item} />
                ))}
              </div>
            </NavDropdown>
            <SiteLink to="/pricing" className={plain}>
              Pricing
            </SiteLink>
            <NavDropdown label="Resources" width={440}>
              <div className="flex flex-col gap-1">
                {RESOURCES_MENU.map((item) => (
                  <PanelLink key={item.title} item={item} />
                ))}
              </div>
            </NavDropdown>
          </nav>

          <div className="hidden items-center gap-2 lg:flex">
            <a href={signIn} className={plain}>
              Sign in
            </a>
            <a href={start} className={`${buttonStyles.primary} !min-h-[48px] !px-6 !text-[15px]`}>
              Get started free
            </a>
          </div>

          <MobileMenu>
            <nav aria-label="Main" className="flex flex-col">
              <MobileGroup label="Product" items={PRODUCT_MENU} />
              <MobileGroup label="Solutions" items={SOLUTIONS_MENU} />
              <SiteLink to="/pricing" className="flex min-h-[56px] items-center border-b border-line-soft text-[17px] font-bold text-navy">
                Pricing
              </SiteLink>
              <MobileGroup label="Resources" items={RESOURCES_MENU} />
            </nav>
            <div className="mt-4 flex flex-col gap-3">
              <a href={start} className={buttonStyles.primary}>
                Get started free
              </a>
              <a href={signIn} className={buttonStyles.ghost}>
                Sign in
              </a>
            </div>
          </MobileMenu>
        </div>
      </header>
    </>
  );
}
