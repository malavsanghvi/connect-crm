// "What we found" (B92 W2): the finished read of a website, in plain English. No hooks and no state, so it renders the
// same on the server and in the browser, and tests/site-found-render.test.tsx can render it from a fixture.
//
// Two kinds of read, two views (src/lib/site-found.ts builds them):
//   OwnReport        the organization's own website: its pages, words, contact details, logo, colours, fonts and menu.
//   ReferenceReport  a website the organization LIKES: patterns only. The view it is given holds no sentence and no
//                    address of that site, and this component prints nothing but counts, yes/no values, colours, font
//                    names and fixed words from it.
import type { ReactNode } from "react";

import { Card, StatusText } from "@/components/ui";
import type { ContrastLine, FoundView, OwnView, ReferenceView, Swatch } from "@/lib/site-found";

export const REFERENCE_PROMISE =
  "Weaver looks only at how this website is put together: the order of its sections, its menu, colours, fonts and how full its pages are. Its words and pictures are never copied.";

const yesNo = (b: boolean) => (b ? "Yes" : "No");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[12px] font-semibold text-muted">{it.label}</dt>
          <dd className="break-words text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 mt-4 text-[13px] font-bold text-ink first:mt-0">{children}</h3>;
}

/** A colour as a chip with its name and share in words (never colour alone). */
export function Swatches({ swatches }: { swatches: Swatch[] }) {
  if (swatches.length === 0) return <p className="text-[13px] text-muted">No clear colours were found.</p>;
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Colours found">
      {swatches.map((s) => (
        <li key={`${s.role}-${s.hex}`} className="flex items-center gap-2.5 text-[13px]" data-swatch={s.hex}>
          <span aria-hidden className="h-9 w-9 shrink-0 rounded-[8px] border border-line" style={{ background: s.hex }} />
          <span className="min-w-0">
            <span className="block font-semibold text-ink">{s.roleLabel}</span>
            <span className="block font-mono text-[12px] text-muted">
              {s.hex}
              {s.percent > 0 ? ` · about ${s.percent}% of the colour used` : ""}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ContrastList({ lines }: { lines: ContrastLine[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-1.5" aria-label="Can the colours be read?">
      {lines.map((c) => (
        <li key={`${c.foreground}-${c.background}`} className="flex flex-wrap items-center gap-2 text-[13px]">
          <span aria-hidden className="inline-flex h-7 w-10 items-center justify-center rounded-[6px] border border-line text-[13px] font-bold" style={{ color: c.foreground, background: c.background }}>
            Aa
          </span>
          <StatusText tone={c.ok ? "ok" : "warn"}>{c.ok ? "Easy to read" : "Hard to read"}</StatusText>
          <span className="text-muted">{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

function FontsLine({ fonts }: { fonts: { heading: string | null; body: string | null; others: string[] } }) {
  if (!fonts.heading && !fonts.body && fonts.others.length === 0) return <p className="text-[13px] text-muted">No fonts were found.</p>;
  return (
    <Facts
      items={[
        ...(fonts.heading ? [{ label: "Headings", value: fonts.heading }] : []),
        ...(fonts.body ? [{ label: "Body text", value: fonts.body }] : []),
        ...(fonts.others.length > 0 ? [{ label: "Also used", value: fonts.others.join(", ") }] : []),
      ]}
    />
  );
}

function HomeOrder({ sections }: { sections: { kind: string; label: string }[] }) {
  if (sections.length === 0) return <p className="text-[13px] text-muted">The home page&apos;s sections could not be told apart.</p>;
  return (
    <ol className="flex list-decimal flex-col gap-0.5 pl-5 text-[13px]" aria-label="Home page sections, top to bottom">
      {sections.map((s, i) => (
        <li key={`${s.kind}-${i}`}>{s.label}</li>
      ))}
    </ol>
  );
}

function Notes({ notes, stopped }: { notes: string[]; stopped: string | null }) {
  const all = stopped ? [...notes, stopped] : notes;
  if (all.length === 0) return null;
  return (
    <ul className="mt-2 list-disc pl-5 text-[13px] text-muted" aria-label="Things to know about this read">
      {all.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

// ── The organization's own website ───────────────────────────────────────────
export function OwnReport({ view }: { view: OwnView }) {
  const o = view.organization;
  const shownLogos = view.logos.filter((l) => l.shown);
  const otherLogos = view.logos.filter((l) => !l.shown);
  return (
    <div className="flex flex-col gap-4" data-found="own">
      <Card
        title={`What we found on ${view.site || "your website"}`}
        description={`${plural(view.pagesRead, "page")} read${view.pagesInSitemap > 0 ? ` (the site lists ${view.pagesInSitemap})` : ""}. This is your own website, so its words and pictures can be reused in your new one.`}
      >
        <Facts
          items={[
            ...(o.name ? [{ label: "Name of the organization", value: o.name }] : []),
            ...(o.languages.length > 0 ? [{ label: "Languages", value: o.languages.join(", ") }] : []),
            ...(o.description ? [{ label: "How the site describes itself", value: o.description }] : []),
            ...(o.emails.length > 0 ? [{ label: "Email addresses", value: o.emails.join(", ") }] : []),
            ...(o.phones.length > 0 ? [{ label: "Phone numbers", value: o.phones.join(", ") }] : []),
            ...(o.addresses.length > 0 ? [{ label: "Street addresses", value: o.addresses.join(" · ") }] : []),
            {
              label: "Social links",
              value:
                o.social.length > 0 ? (
                  <span className="flex flex-wrap gap-x-3">
                    {o.social.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
                        {s.network.charAt(0).toUpperCase() + s.network.slice(1)}
                      </a>
                    ))}
                  </span>
                ) : (
                  "None found"
                ),
            },
            {
              label: "Giving links",
              value:
                o.donate.length > 0 ? (
                  <span className="flex flex-wrap gap-x-3">
                    {o.donate.map((d) => (
                      <a key={d.url} href={d.url} target="_blank" rel="noopener noreferrer" className="underline">
                        {d.label}
                      </a>
                    ))}
                  </span>
                ) : (
                  "None found"
                ),
            },
          ]}
        />
        <Notes notes={view.notes} stopped={view.stopped} />
        {view.trimmed ? <p className="mt-2 text-[13px] text-muted">The site is large, so some page text was shortened to fit. Nothing is lost from the site itself.</p> : null}
      </Card>

      <Card title="Pages by kind" description="Weaver sorted the pages it read into kinds. Where it was not sure, please check it.">
        {view.groups.length === 0 ? (
          <p className="text-[13px] text-muted">No pages could be read.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {view.notSure > 0 ? <p className="text-[13px] text-muted">{plural(view.notSure, "page")} could not be sorted with confidence. They are marked below.</p> : null}
            {view.groups.map((g) => (
              <details key={g.kind} className="rounded-[10px] border border-line-soft px-3 py-2" data-kind={g.kind}>
                <summary className="cursor-pointer text-[13px] font-semibold text-ink">
                  {g.label} <span className="font-normal text-muted">· {plural(g.count, "page")}</span>
                </summary>
                <ul className="mt-2 flex flex-col gap-1 text-[13px]">
                  {g.pages.map((p) => (
                    <li key={p.path} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium text-ink">{p.title}</span>
                      <span className="break-all font-mono text-[12px] text-muted">{p.path}</span>
                      <StatusText tone={p.sure === "sure" ? "ok" : p.sure === "probably" ? "warn" : "bad"}>{p.sureWords}</StatusText>
                      {p.scripts ? <span className="text-[12px] text-muted">built by scripts</span> : null}
                    </li>
                  ))}
                  {g.hiddenPages > 0 ? <li className="text-muted">and {plural(g.hiddenPages, "more page")}</li> : null}
                </ul>
              </details>
            ))}
          </div>
        )}
        {view.scriptPages.length > 0 ? (
          <div className="mt-3 rounded-[10px] border border-saffron/40 bg-saffron-50 px-3 py-2 text-[13px] text-brown-900" data-found-section="scripts">
            <p className="font-bold">{plural(view.scriptPages.length, "page")} built by scripts</p>
            <p>Little text could be read from {view.scriptPages.length === 1 ? "this page" : "these pages"}, because {view.scriptPages.length === 1 ? "it is" : "they are"} drawn by the browser. A person should look at {view.scriptPages.length === 1 ? "it" : "them"}.</p>
            <ul className="mt-1 list-disc pl-5">
              {view.scriptPages.map((p) => (
                <li key={p.path}>
                  {p.title} <span className="font-mono text-[12px]">{p.path}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card title="How the home page is laid out" description="The sections of the home page, from the top.">
        <HomeOrder sections={view.homeSections} />
        {view.hero ? <p className="mt-2 text-[13px]">{view.hero}</p> : null}
        {view.hasSearch ? <p className="mt-1 text-[13px]">The site has a search box.</p> : null}
      </Card>

      <Card title="Colours, fonts and logo" description="What your site looks like now. A new site can keep these or change them.">
        <Heading>Colours</Heading>
        <Swatches swatches={view.swatches} />
        <ContrastList lines={view.contrast} />
        <Heading>Fonts</Heading>
        <FontsLine fonts={view.fonts} />
        <Heading>Logo</Heading>
        {shownLogos.length === 0 && otherLogos.length === 0 ? (
          <p className="text-[13px] text-muted">No logo was found. You can upload one under Setup › Profile &amp; brand.</p>
        ) : (
          <ul className="flex flex-wrap gap-3" aria-label="Logo candidates">
            {shownLogos.map((l) => (
              <li key={l.url} className="flex w-44 flex-col gap-1 text-[12px] text-muted">
                <span className="flex h-24 items-center justify-center rounded-[10px] border border-line bg-white p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={l.url} alt={l.alt || "Possible logo"} loading="lazy" referrerPolicy="no-referrer" className="max-h-20 max-w-full object-contain" />
                </span>
                <span>{l.source}</span>
                {l.width && l.height ? <span>{l.width} × {l.height} pixels</span> : null}
              </li>
            ))}
          </ul>
        )}
        {otherLogos.length > 0 ? (
          <p className="mt-2 text-[13px] text-muted">
            {plural(otherLogos.length, "more picture")} {otherLogos.length === 1 ? "is" : "are"} kept on another website, so {otherLogos.length === 1 ? "it is" : "they are"} not shown here.
          </p>
        ) : null}
      </Card>

      <Card title="Menu and footer">
        {view.menu ? (
          <>
            <Facts
              items={[
                { label: "Menu items across the top", value: String(view.menu.topLevel) },
                { label: "Menu levels", value: view.menu.depth > 1 ? `${view.menu.depth} (it has drop-down menus)` : "1 (a flat menu)" },
                { label: "Links in the menu", value: String(view.menu.totalLinks) },
                { label: "Menu button for phones", value: yesNo(view.menu.mobileToggle) },
                ...(view.menu.button ? [{ label: "Button in the menu", value: view.menu.button }] : []),
              ]}
            />
            {view.menu.items.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1 text-[13px]" aria-label="Menu">
                {view.menu.items.map((it) => (
                  <li key={it.label}>
                    <span className="font-semibold text-ink">{it.label}</span>
                    {it.children.length > 0 ? (
                      <span className="text-muted">
                        {" "}
                        — {it.children.join(", ")}
                        {it.moreChildren > 0 ? ` and ${it.moreChildren} more` : ""}
                      </span>
                    ) : null}
                  </li>
                ))}
                {view.menu.moreItems > 0 ? <li className="text-muted">and {plural(view.menu.moreItems, "more menu item")}</li> : null}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] text-muted">No menu was found.</p>
        )}
        <Heading>Footer</Heading>
        {view.footer ? (
          <Facts
            items={[
              { label: "Columns", value: String(view.footer.columns) },
              { label: "Links", value: String(view.footer.linkCount) },
              { label: "Social links", value: yesNo(view.footer.social) },
              { label: "Newsletter sign-up", value: yesNo(view.footer.newsletter) },
              { label: "Street address", value: yesNo(view.footer.address) },
              { label: "Copyright line", value: yesNo(view.footer.copyright) },
            ]}
          />
        ) : (
          <p className="text-[13px] text-muted">No footer was found.</p>
        )}
      </Card>
    </div>
  );
}

// ── A website the organization likes ─────────────────────────────────────────
export function ReferenceReport({ view }: { view: ReferenceView }) {
  return (
    <div data-found="reference">
      <Card title={`A website you like${view.site ? `: ${view.site}` : ""}`} description={REFERENCE_PROMISE}>
        <p className="text-[13px] text-muted">{plural(view.pagesRead, "page")} looked at.</p>
        <Notes notes={view.notes} stopped={view.stopped} />

        <Heading>Order of the home page</Heading>
        <HomeOrder sections={view.homeSections} />
        {view.hero ? <p className="mt-2 text-[13px]">{view.hero}</p> : null}

        <Heading>Menu</Heading>
        {view.menu ? (
          <Facts
            items={[
              { label: "Items across the top", value: String(view.menu.topLevel) },
              { label: "Menu levels", value: view.menu.depth > 1 ? `${view.menu.depth} (drop-down menus)` : "1 (a flat menu)" },
              { label: "Menu button for phones", value: yesNo(view.menu.mobileToggle) },
              { label: "A button in the menu (such as Give)", value: yesNo(view.menu.button) },
              { label: "Search box", value: yesNo(view.menu.search) },
            ]}
          />
        ) : (
          <p className="text-[13px] text-muted">No menu was found.</p>
        )}

        <Heading>Footer</Heading>
        {view.footer ? (
          <Facts
            items={[
              { label: "Columns", value: String(view.footer.columns) },
              { label: "Links", value: String(view.footer.linkCount) },
              { label: "Social links", value: yesNo(view.footer.social) },
              { label: "Newsletter sign-up", value: yesNo(view.footer.newsletter) },
              { label: "Street address", value: yesNo(view.footer.address) },
            ]}
          />
        ) : (
          <p className="text-[13px] text-muted">No footer was found.</p>
        )}

        <Heading>Colours</Heading>
        <Swatches swatches={view.swatches} />
        {view.contrast.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1 text-[13px]" aria-label="Can the colours be read?">
            {view.contrast.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <StatusText tone={c.ok ? "ok" : "warn"}>{c.ok ? "Easy to read" : "Hard to read"}</StatusText>
                <span className="text-muted">
                  {c.ratio}:1, {c.words}.
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <Heading>Fonts</Heading>
        <FontsLine fonts={view.fonts} />

        <Heading>How full the pages are</Heading>
        {view.density ? (
          <Facts
            items={[
              { label: "Text", value: `${view.density.text} (about ${view.density.avgWords} words a page)` },
              { label: "Pictures", value: `${view.density.imagery} (about ${view.density.avgImages} a page)` },
              { label: "Sections a page", value: String(view.density.avgSections) },
              { label: "A logo in the header", value: yesNo(view.logoPresent) },
            ]}
          />
        ) : (
          <p className="text-[13px] text-muted">Not enough pages were read to tell.</p>
        )}

        {view.kinds.length > 0 ? (
          <>
            <Heading>Kinds of pages it has</Heading>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              {view.kinds.map((k) => (
                <li key={k.kind}>
                  {k.label} <span className="text-muted">· {k.count}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>
    </div>
  );
}

export function FoundReport({ view }: { view: FoundView }) {
  return view.mode === "own" ? <OwnReport view={view} /> : <ReferenceReport view={view} />;
}
