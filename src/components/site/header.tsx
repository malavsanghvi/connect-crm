import { Icon, type IconName } from "@/components/site/icons";
import { MobileMenu } from "@/components/site/mobile-menu";
import { NavDropdown } from "@/components/site/nav-dropdown";
import { SiteLink, buttonStyles, container } from "@/components/site/ui";
import { WEAVERS } from "@/components/site/weavers";
import { SITE_NAME, TIP_YEARLY_CAP_CENTS, portalUrl, usd } from "@/lib/site";

const CAP = usd(TIP_YEARLY_CAP_CENTS);

type MenuEntry = { to: string; icon: IconName; title: string; body: string };

export const PRODUCT_MENU: MenuEntry[] = [
  { to: "/#households", icon: "users", title: "Members and households", body: "Families, memberships and every ID in one record" },
  { to: "/#giving", icon: "heart", title: "Giving and accounting", body: "Pledges, bank matching and QuickBooks" },
  { to: "/#events", icon: "calendar", title: "Events and event day", body: "Tickets, lunch slots and check-in" },
  { to: "/#learning", icon: "book", title: "Classes and learning", body: "Terms, attendance and homework" },
  { to: "/#member-app", icon: "phone", title: "The member app", body: "One sign-in for the whole family" },
  { to: "/#messages", icon: "mail", title: "Messages and volunteers", body: "Email, WhatsApp and sign-ups" },
];

/** The three Weavers: each links to its card on the home page. */
export const SOLUTIONS_MENU: MenuEntry[] = WEAVERS.map((w) => ({ to: `/#${w.id}`, icon: w.icon, title: w.name, body: w.menu }));

export const RESOURCES_MENU: MenuEntry[] = [
  { to: "/#how", icon: "check", title: "How it works", body: "From request to going live" },
  { to: "/pricing#how-we-stay-free", icon: "heart", title: "How we stay free", body: `Optional tips, capped at ${CAP} a year` },
  { to: "/#security", icon: "shield", title: "Security and privacy", body: "How your community's data is protected" },
  { to: "/#faq", icon: "smile", title: "Questions and answers", body: "The things people ask first" },
];

/** The mark: two linked rings on navy (the same drawing as the app icon). */
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <svg aria-hidden viewBox="0 0 64 64" className="h-10 w-10 flex-none">
        <rect width="64" height="64" rx="15" fill={light ? "#FBF7F0" : "#1B2C5C"} />
        <circle cx="24" cy="32" r="12" fill="none" stroke={light ? "#1B2C5C" : "#FBF7F0"} strokeWidth="5" />
        <circle cx="40" cy="32" r="12" fill="none" stroke="#C9731C" strokeWidth="5" />
      </svg>
      <span className={`font-display text-[22px] font-semibold tracking-[-0.01em] ${light ? "text-white" : "text-navy"}`}>{SITE_NAME}</span>
    </span>
  );
}

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
          <SiteLink key={item.to} to={item.to} className="flex min-h-[48px] items-center gap-3 rounded-xl px-2 text-[15px] font-semibold text-ink-2">
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
        <span className="text-navy-100">No fees for your organization. Members may add an optional tip, capped at {CAP} a year.</span>
        <SiteLink to="/pricing#how-we-stay-free" className="inline-flex items-center gap-1 whitespace-nowrap font-bold text-gold underline-offset-4 hover:underline">
          See how
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
      <header className="sticky top-0 z-40 border-b border-line/80 bg-canvas/85 backdrop-blur-md">
        <div className={`${container} relative flex h-[72px] items-center justify-between gap-4`}>
          <SiteLink to="/" className="rounded-xl">
            <span className="sr-only">{SITE_NAME} home</span>
            <Logo />
          </SiteLink>

          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            <NavDropdown label="Product" width={640}>
              <div className="grid grid-cols-2 gap-1">
                {PRODUCT_MENU.map((item) => (
                  <PanelLink key={item.to} item={item} />
                ))}
              </div>
              <PanelFooter />
            </NavDropdown>
            <NavDropdown label="Solutions" width={440}>
              <div className="flex flex-col gap-1">
                {SOLUTIONS_MENU.map((item) => (
                  <PanelLink key={item.to} item={item} />
                ))}
              </div>
            </NavDropdown>
            <SiteLink to="/pricing" className={plain}>
              Pricing
            </SiteLink>
            <NavDropdown label="Resources" width={440}>
              <div className="flex flex-col gap-1">
                {RESOURCES_MENU.map((item) => (
                  <PanelLink key={item.to} item={item} />
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
