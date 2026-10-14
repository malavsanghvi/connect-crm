// The private preview of the website draft (B92 W3): the page's blocks drawn with the draft's theme, each with a badge saying
// where its words came from. Nothing here is the public website: it is shown only to people who manage settings, inside the
// portal, and every link goes to another page of the preview. Plain server components; the draft was read field by field
// (src/lib/site-draft/parse.ts) before it got here, so colours, fonts and web addresses are already safe to use.

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";

import { formatDateTime } from "@/lib/events/format";
import { contrast } from "@/lib/site-draft/theme";
import type {
  ContactContent,
  EventsContent,
  FooterContent,
  GalleryContent,
  GivingContent,
  HeroContent,
  LeadersContent,
  MapContent,
  FaqContent,
  StoredBlock,
  StoredDraft,
  StoredPage,
  TextContent,
} from "@/lib/site-draft/types";

const SOURCE_BADGE: Record<StoredBlock["source"], { label: string; className: string }> = {
  own_site: { label: "From your old website", className: "bg-navy-50 text-navy" },
  weaver_data: { label: "From Weaver's records", className: "bg-success-50 text-success-900" },
  written: { label: "Written by Weaver: replace this text", className: "bg-saffron-50 text-brown" },
};

/** The path of an old page, for the badge ("/about-us"); the whole address when it cannot be read. */
function oldPagePath(address: string): string {
  try {
    const u = new URL(address);
    return u.pathname === "/" ? u.host : u.pathname;
  } catch {
    return address;
  }
}

/** The badge that says where a block's words came from (words as well as colour, never colour alone). */
export function SourceBadge({ block }: { block: Pick<StoredBlock, "source" | "source_page"> }) {
  const b = SOURCE_BADGE[block.source];
  return (
    <p className={`inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${b.className}`} data-source={block.source}>
      <span>{b.label}</span>
      {block.source === "own_site" && block.source_page ? (
        <a href={block.source_page} target="_blank" rel="noopener noreferrer" className="break-all font-mono font-medium underline">
          {oldPagePath(block.source_page)}
        </a>
      ) : null}
    </p>
  );
}

/** An event's day and time in the community's time zone and locale (English, US when no locale is given). */
function when(value: string, tz: string | null, locale: string): string {
  if (locale === "en-US") {
    try {
      return formatDateTime(value, tz ?? "UTC");
    } catch {
      return formatDateTime(value, "UTC");
    }
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const at = (zone: string) => new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: zone }).format(d);
  try {
    return at(tz ?? "UTC");
  } catch {
    return at("UTC");
  }
}

const ink = { color: "var(--sd-text)" } satisfies CSSProperties;
const heading = (extra: CSSProperties = {}): CSSProperties => ({ fontFamily: "var(--sd-heading-font)", color: "var(--sd-link)", ...extra });
const button: CSSProperties = { background: "var(--sd-primary)", color: "var(--sd-on-primary)" };

function Button({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-full px-5 py-2.5 text-[15px] font-semibold" style={button} aria-disabled="true">
      {children}
    </span>
  );
}

function Hero({ c, href }: { c: HeroContent; href: (slug: string) => string }) {
  return (
    <div className="grid gap-6 rounded-[14px] px-6 py-10 sm:px-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center" style={{ background: "var(--sd-primary)", color: "var(--sd-on-primary)" }}>
      <div className="flex flex-col gap-3">
        {c.eyebrow ? <p className="text-[13px] font-bold uppercase tracking-[0.08em] opacity-90">{c.eyebrow}</p> : null}
        <h1 className="text-[34px] font-semibold leading-tight" style={{ fontFamily: "var(--sd-heading-font)" }}>
          {c.heading}
        </h1>
        {c.subheading ? <p className="max-w-xl text-[17px] leading-relaxed opacity-95">{c.subheading}</p> : null}
        {c.cta ? (
          <p className="mt-2">
            <Link href={href(c.cta.page)} className="inline-block rounded-full px-5 py-2.5 text-[15px] font-semibold no-underline" style={{ background: "var(--sd-on-primary)", color: "var(--sd-primary)" }}>
              {c.cta.label}
            </Link>
          </p>
        ) : null}
      </div>
      {c.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- a picture from the organization's old website, shown as it is
        <img src={c.image.src} alt={c.image.alt} referrerPolicy="no-referrer" loading="lazy" className="max-h-[260px] w-full rounded-field object-cover" />
      ) : null}
    </div>
  );
}

function Text({ c }: { c: TextContent }) {
  return (
    <div className="flex flex-col gap-2">
      {c.heading ? (
        <h2 className="text-[24px] font-semibold" style={heading()}>
          {c.heading}
        </h2>
      ) : null}
      {c.paragraphs.map((p, i) => (
        <p key={i} className="max-w-3xl text-[16px] leading-relaxed" style={ink}>
          {p}
        </p>
      ))}
    </div>
  );
}

function Events({ c, locale }: { c: EventsContent; locale: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[24px] font-semibold" style={heading()}>
        {c.heading}
      </h2>
      {c.events.length === 0 ? (
        <p style={ink}>{c.empty ?? "No events are listed right now."}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {c.events.map((e, i) => (
            <li key={i} className="rounded-field border px-4 py-3" style={{ borderColor: "var(--sd-secondary)" }}>
              <p className="text-[17px] font-semibold" style={ink}>
                {e.title}
              </p>
              <p className="text-[14px]" style={ink}>
                {when(e.starts_at, c.time_zone, locale)}
                {e.venue ? ` · ${e.venue}` : ""}
              </p>
              {e.description ? (
                <p className="mt-1 text-[15px]" style={ink}>
                  {e.description}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Giving({ c }: { c: GivingContent }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[24px] font-semibold" style={heading()}>
        {c.heading}
      </h2>
      {c.body ? (
        <p className="max-w-3xl text-[16px] leading-relaxed" style={ink}>
          {c.body}
        </p>
      ) : null}
      {c.items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {c.items.map((it, i) => (
            <li key={i} style={ink}>
              <span className="font-semibold">{it.name}</span>
              {it.description ? <span> · {it.description}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {c.cta ? (
        <p>
          <Button>{c.cta.label}</Button>
        </p>
      ) : null}
    </div>
  );
}

function Gallery({ c }: { c: GalleryContent }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[24px] font-semibold" style={heading()}>
        {c.heading}
      </h2>
      {c.albums.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {c.albums.map((a, i) => (
            <li key={i} style={ink}>
              <span className="font-semibold">{a.title}</span> · {a.photos} {a.photos === 1 ? "photo" : "photos"}
            </li>
          ))}
        </ul>
      ) : null}
      {c.images.length > 0 ? (
        <>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {c.images.map((img, i) => (
              <li key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a picture from the organization's old website, shown as it is */}
                <img src={img.src} alt={img.alt} referrerPolicy="no-referrer" loading="lazy" className="h-32 w-full rounded-tag object-cover" />
              </li>
            ))}
          </ul>
          {c.licence_unchecked ? <p className="text-[13px]" style={ink}>These pictures come from your old website. Check that you may reuse each one before you publish.</p> : null}
        </>
      ) : null}
    </div>
  );
}

function Leaders({ c }: { c: LeadersContent }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[24px] font-semibold" style={heading()}>
        {c.heading}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {c.people.map((p, i) => (
          <li key={i} style={ink}>
            <span className="font-semibold">{p.name}</span>
            <span> · {p.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Contact({ c }: { c: ContactContent }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-[24px] font-semibold" style={heading()}>
        {c.heading}
      </h2>
      {c.note ? <p style={ink}>{c.note}</p> : null}
      {c.addresses.map((a) => (
        <p key={a} style={ink}>
          {a}
        </p>
      ))}
      {c.phones.map((p) => (
        <p key={p} style={ink}>
          {p}
        </p>
      ))}
      {c.emails.map((e) => (
        <p key={e} style={ink}>
          {e}
        </p>
      ))}
      {c.hours ? <p style={ink}>{c.hours}</p> : null}
      {c.today ? <p style={ink}>{c.today}</p> : null}
      {c.social.length > 0 ? (
        <ul className="flex flex-wrap gap-3">
          {c.social.map((s) => (
            <li key={s.network}>
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--sd-link)" }}>
                {s.network.charAt(0).toUpperCase() + s.network.slice(1)}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function MapBlock({ c }: { c: MapContent }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-[24px] font-semibold" style={heading()}>
        {c.heading}
      </h2>
      {c.address ? <p style={ink}>{c.address}</p> : null}
      <p className="rounded-field border border-dashed px-4 py-6 text-center text-[14px]" style={{ borderColor: "var(--sd-secondary)", ...ink }}>
        A map will appear here when the website is published.
      </p>
    </div>
  );
}

function Faq({ c }: { c: FaqContent }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[24px] font-semibold" style={heading()}>
        {c.heading}
      </h2>
      <dl className="flex flex-col gap-2">
        {c.items.map((it, i) => (
          <div key={i}>
            <dt className="font-semibold" style={ink}>
              {it.question}
            </dt>
            <dd style={ink}>{it.answer}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Footer({ c, href }: { c: FooterContent; href: (slug: string) => string }) {
  return (
    <div className="flex flex-col gap-2 rounded-field px-6 py-5" style={{ background: "var(--sd-primary)", color: "var(--sd-on-primary)" }}>
      <p className="text-[17px] font-semibold">{c.name}</p>
      {c.lines.map((l) => (
        <p key={l} className="text-[14px]">
          {l}
        </p>
      ))}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
        {c.links.map((l) => (
          <li key={l.page}>
            <Link href={href(l.page)} className="underline">
              {l.label}
            </Link>
          </li>
        ))}
        {c.social.map((s) => (
          <li key={s.network}>
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
              {s.network.charAt(0).toUpperCase() + s.network.slice(1)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BlockBody({ block, href, locale }: { block: StoredBlock; href: (slug: string) => string; locale: string }) {
  switch (block.type) {
    case "hero":
      return <Hero c={block.content} href={href} />;
    case "text":
      return <Text c={block.content} />;
    case "events_list":
      return <Events c={block.content} locale={locale} />;
    case "giving_cta":
      return <Giving c={block.content} />;
    case "gallery":
      return <Gallery c={block.content} />;
    case "leaders":
      return <Leaders c={block.content} />;
    case "contact":
      return <Contact c={block.content} />;
    case "map":
      return <MapBlock c={block.content} />;
    case "faq":
      return <Faq c={block.content} />;
    case "footer":
      return <Footer c={block.content} href={href} />;
  }
}

/** The theme as the CSS variables the blocks read. Colours and font names were checked when the draft was read back. */
export function themeStyle(draft: StoredDraft): CSSProperties {
  const t = draft.theme;
  const family = (name: string | null, fallback: string) => (name ? `"${name}", ${fallback}` : fallback);
  const vars: Record<string, string> = {
    "--sd-primary": t.palette.primary,
    "--sd-secondary": t.palette.secondary,
    "--sd-accent": t.palette.accent,
    "--sd-bg": t.palette.background,
    "--sd-text": t.palette.text,
    "--sd-on-primary": t.palette.on_primary,
    // Headings and links use the main colour when it reads well on the page, else the text colour.
    "--sd-link": contrast(t.palette.primary, t.palette.background) >= 4.5 ? t.palette.primary : t.palette.text,
    "--sd-heading-font": family(t.fonts.heading, "Georgia, serif"),
    "--sd-body-font": family(t.fonts.body, "system-ui, sans-serif"),
  };
  return { ...vars, background: "var(--sd-bg)", color: "var(--sd-text)", fontFamily: "var(--sd-body-font)" } as CSSProperties;
}

/** One page of the draft, framed like a small website: its name and menu, then its blocks. */
export function SitePreview({ draft, page, basePath, locale = "en-US" }: { draft: StoredDraft; page: StoredPage; basePath: string; locale?: string }) {
  const href = (slug: string) => `${basePath}?page=${encodeURIComponent(slug)}`;
  const logo = draft.theme.logo;
  return (
    <div className="overflow-hidden rounded-[14px] border border-line" style={themeStyle(draft)} data-site-preview data-page={page.slug}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4" style={{ borderColor: "var(--sd-secondary)" }}>
        <p className="flex items-center gap-3 text-[20px] font-semibold" style={heading()}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- the organization's own logo from its old website
            <img src={logo.src} alt={logo.alt} referrerPolicy="no-referrer" className="h-9 w-auto max-w-[160px] object-contain" />
          ) : null}
          <span>{draft.name}</span>
        </p>
        <nav aria-label="Pages of the website draft">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[15px]">
            {draft.pages.map((p) => (
              <li key={p.id}>
                <Link href={href(p.slug)} className="underline-offset-4 hover:underline" style={{ color: "var(--sd-link)", fontWeight: p.slug === page.slug ? 700 : 400 }} aria-current={p.slug === page.slug ? "page" : undefined}>
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <div className="flex flex-col gap-8 px-6 py-8">
        {page.blocks.map((block) => (
          <section key={block.id} className="flex flex-col gap-2" data-block={block.type} data-source={block.source}>
            <SourceBadge block={block} />
            <BlockBody block={block} href={href} locale={locale} />
          </section>
        ))}
        {page.blocks.length === 0 ? <p style={ink}>This page has nothing on it yet.</p> : null}
      </div>
    </div>
  );
}
