"use client";

// Flyers v3: the Layout choice and the editors of the layout's blocks (flyer-layout.ts). Used by the full flyer maker (the poster
// editor) and by the guided creator's flyer panel, so both change the same poster.layout. Every block is optional: switch it
// off, or leave it empty, and the flyer closes up around what is left.

import { Toggle } from "@/components/controls";
import { buttonClass } from "@/components/ui";
import { POSTER_LIMITS, type PosterContent } from "@/lib/events/flyer";
import { artPack, svgDataUri } from "@/lib/events/flyer-art-packs";
import type { FlyerBrand } from "@/lib/events/flyer-brand";
import {
  LAYOUT_CONTACTS_MAX,
  LAYOUT_LIMITS,
  LAYOUT_PRESET_LIST,
  originalThumbnailSvg,
  presetThumbnailSvg,
  titleWords,
  withLayoutPreset,
  withoutLayout,
  type BlockKey,
  type LayoutContact,
  type PosterLayout,
} from "@/lib/events/flyer-layout";

import { SectionBox, TextField } from "./flyer-fields";
import { IconPicker } from "./flyer-icon-picker";

type UpdatePoster = (fn: (p: PosterContent) => PosterContent) => void;

/**
 * The Layout choice: the original stacked poster, or one of the layouts, each with a small drawing of how it arranges the words.
 * Choosing a layout changes only how the words are arranged: everything already typed is kept, so moving between layouts loses nothing.
 */
export function LayoutChooser({
  poster,
  brand,
  headline,
  greeting,
  onPoster,
  disabled,
}: {
  poster: PosterContent;
  brand: FlyerBrand;
  headline: string;
  /** The greeting of the community's tradition, or "" (none): offered when a layout is chosen. */
  greeting: string;
  onPoster: UpdatePoster;
  disabled: boolean;
}) {
  const pal = artPack(poster.occasion, brand).palette;
  const colors = { paper: pal.paper, ink: pal.ink, accent: pal.accent, gold: pal.gold };
  const current = poster.layout?.preset ?? "original";
  const options = [
    { key: "original", label: "Original", blurb: "The stacked poster: title, highlight box, date ribbon, agenda", svg: originalThumbnailSvg(colors) },
    ...LAYOUT_PRESET_LIST.map((p) => ({ key: p.key as string, label: p.label, blurb: p.blurb, svg: presetThumbnailSvg(p.key, colors) })),
  ];
  const choose = (key: string) => {
    if (key === current) return;
    if (key === "original") onPoster((p) => withoutLayout(p));
    else onPoster((p) => withLayoutPreset(p, key as never, { headline, greeting }));
  };
  return (
    <div role="radiogroup" aria-label="Flyer layout" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {options.map((o) => {
        const on = o.key === current;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => choose(o.key)}
            className={`flex items-start gap-3 rounded-[12px] border bg-white p-2 text-left disabled:opacity-60 ${on ? "border-navy ring-2 ring-navy/30" : "border-line"}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={svgDataUri(o.svg)} alt="" width={64} height={80} className="h-20 w-16 shrink-0 rounded-[6px] border border-line-soft" />
            <span className="min-w-0">
              <span className="block text-[13px] font-bold">{o.label}</span>
              <span className="block text-[12px] leading-[1.4] text-muted">{o.blurb}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The poster's own words the layouts arrange, for the guided creator (the full flyer maker has them in its headline, ribbon and footer sections). */
export function LayoutPosterWords({ poster, onPoster, disabled }: { poster: PosterContent; onPoster: UpdatePoster; disabled: boolean }) {
  const set = (patch: Partial<PosterContent>) => onPoster((p) => ({ ...p, ...patch }));
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <TextField id="layout-subhead" label="Sub-title (optional)" value={poster.subhead} max={POSTER_LIMITS.subhead} onChange={(v) => set({ subhead: v })} disabled={disabled} />
      <TextField id="layout-tagline" label="Tagline (optional)" value={poster.slogan} max={POSTER_LIMITS.slogan} onChange={(v) => set({ slogan: v })} disabled={disabled} />
      <TextField id="layout-footer" label="Footer line (optional)" value={poster.footer} max={POSTER_LIMITS.footer} onChange={(v) => set({ footer: v })} disabled={disabled} />
    </div>
  );
}

/**
 * The editors of the layout's own blocks: the small line and the accent word, the greetings, the host card, the note box, the call to
 * action and the contacts. Shown only while a layout is chosen. A block with a switch is left out when it is off even if it has words.
 */
export function LayoutBlockEditors({
  poster,
  headline,
  greeting,
  onPoster,
  disabled,
}: {
  poster: PosterContent;
  headline: string;
  greeting: string;
  onPoster: UpdatePoster;
  disabled: boolean;
}) {
  const layout = poster.layout;
  if (!layout) return null;
  const setLayout = (fn: (l: PosterLayout) => PosterLayout) => onPoster((p) => (p.layout ? { ...p, layout: fn(p.layout) } : p));
  const patch = (partial: Partial<PosterLayout>) => setLayout((l) => ({ ...l, ...partial }));
  const isOn = (key: BlockKey) => !layout.off.includes(key);
  const setOn = (key: BlockKey, on: boolean) => setLayout((l) => ({ ...l, off: on ? l.off.filter((k) => k !== key) : [...new Set([...l.off, key])] }));

  const words = titleWords(headline, "");
  const rows = layout.contacts;
  const setRows = (next: LayoutContact[]) => patch({ contacts: next });

  return (
    <div className="flex flex-col gap-3">
      <SectionBox title="Above the title" note="A small line such as “Monthly” or “Annual”, and which word of the title is set in the second colour.">
        <TextField id="layout-eyebrow" label="Small line (optional)" value={layout.eyebrow} max={LAYOUT_LIMITS.eyebrow} onChange={(v) => patch({ eyebrow: v })} disabled={disabled} />
        <div>
          <TextField
            id="layout-accent"
            label="Accent word (optional)"
            value={layout.accent}
            max={LAYOUT_LIMITS.accent}
            onChange={(v) => patch({ accent: v })}
            disabled={disabled}
            hint="A word from the title, shown in the second colour. Empty: a one-colour title."
          />
          {words.length > 1 ? (
            <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Pick the accent word from the title">
              {words.map((w, i) => (
                <button key={`${w.text}-${i}`} type="button" className={buttonClass("ghost", "xs")} disabled={disabled} onClick={() => patch({ accent: w.text.replace(/[^\p{L}\p{N}'’-]+/gu, "") })}>
                  {w.text}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </SectionBox>

      <SectionBox title="Greetings" note="A greeting at the top and one at the bottom, in your community's own words. Leave one empty to leave it out.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField id="layout-greeting-top" label="At the top" value={layout.greeting.top} max={LAYOUT_LIMITS.greeting} onChange={(v) => patch({ greeting: { ...layout.greeting, top: v } })} disabled={disabled} />
          <TextField id="layout-greeting-bottom" label="At the bottom" value={layout.greeting.bottom} max={LAYOUT_LIMITS.greeting} onChange={(v) => patch({ greeting: { ...layout.greeting, bottom: v } })} disabled={disabled} />
        </div>
        {greeting && (layout.greeting.top !== greeting || layout.greeting.bottom !== greeting) ? (
          <div>
            <button type="button" className={buttonClass("ghost", "xs")} disabled={disabled} onClick={() => patch({ greeting: { top: greeting, bottom: greeting } })}>
              Use “{greeting}” at the top and bottom
            </button>
          </div>
        ) : null}
      </SectionBox>

      <SectionBox
        title="Host or sponsor card"
        control={<Toggle label="Host card" checked={isOn("host")} onChange={(on) => setOn("host", on)} onNote="On" offNote="Left out" disabled={disabled} />}
        note="Who is hosting or sponsoring, on a card. Choose the label (“Hosted by”, “Sponsored by”, your own word) and type the names."
      >
        {isOn("host") ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr]">
            <TextField id="layout-host-label" label="Label" value={layout.host.label} max={LAYOUT_LIMITS.host_label} onChange={(v) => patch({ host: { ...layout.host, label: v } })} disabled={disabled} placeholder="Hosted by" />
            <TextField
              id="layout-host-names"
              label="Names"
              value={layout.host.names}
              max={LAYOUT_LIMITS.host_names}
              onChange={(v) => patch({ host: { ...layout.host, names: v } })}
              disabled={disabled}
              hint={!layout.host.names ? "The card shows once it has names." : undefined}
            />
          </div>
        ) : null}
      </SectionBox>

      <SectionBox
        title="Note box"
        control={<Toggle label="Note box" checked={isOn("note")} onChange={(on) => setOn("note", on)} onNote="On" offNote="Left out" disabled={disabled} />}
        note="A short note with a small picture, such as what to bring."
      >
        {isOn("note") ? (
          <>
            <div>
              <p className="crm-label" aria-hidden="true">
                Picture
              </p>
              <IconPicker label="Note picture" value={layout.note.icon} onChange={(icon) => patch({ note: { ...layout.note, icon } })} disabled={disabled} />
            </div>
            <TextField
              id="layout-note"
              label="Note"
              value={layout.note.text}
              max={LAYOUT_LIMITS.note_text}
              onChange={(v) => patch({ note: { ...layout.note, text: v } })}
              multiline
              rows={3}
              disabled={disabled}
              hint={!layout.note.text ? "The box shows once it has a note." : undefined}
            />
          </>
        ) : null}
      </SectionBox>

      <SectionBox
        title="Call to action and contacts"
        control={<Toggle label="Contacts" checked={isOn("contacts")} onChange={(on) => setOn("contacts", on)} onNote="Contacts on" offNote="Contacts left out" disabled={disabled} />}
        note={`A line asking people to act (“RSVP at…”, “Register now”) and up to ${LAYOUT_CONTACTS_MAX} people to contact. Names and numbers are set by Weaver and never sent to an AI.`}
      >
        <div className="flex items-center justify-between gap-2">
          <TextField id="layout-cta" label="Call to action (optional)" value={layout.cta} max={LAYOUT_LIMITS.cta} onChange={(v) => patch({ cta: v })} disabled={disabled} />
        </div>
        {isOn("contacts") ? (
          <>
            <TextField id="layout-contacts-label" label="Label above the contacts" value={layout.contacts_label} max={LAYOUT_LIMITS.contacts_label} onChange={(v) => patch({ contacts_label: v })} disabled={disabled} placeholder="Please contact" />
            <ol className="flex flex-col gap-3">
              {rows.map((row, i) => (
                <li key={i} className="rounded-[10px] border border-line-soft bg-ground p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-bold">Contact {i + 1}</p>
                    <button type="button" className={`${buttonClass("ghost", "xs")} min-h-9`} aria-label={`Remove contact ${i + 1}`} disabled={disabled} onClick={() => setRows(rows.filter((_, at) => at !== i))}>
                      Remove
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <TextField id={`layout-contact-${i}-name`} label="Name" value={row.name} max={LAYOUT_LIMITS.contact_name} onChange={(v) => setRows(rows.map((r, at) => (at === i ? { ...r, name: v } : r)))} disabled={disabled} compact />
                    <TextField id={`layout-contact-${i}-detail`} label="Phone or email" value={row.detail} max={LAYOUT_LIMITS.contact_detail} onChange={(v) => setRows(rows.map((r, at) => (at === i ? { ...r, detail: v } : r)))} disabled={disabled} compact />
                  </div>
                </li>
              ))}
            </ol>
            <div>
              <button type="button" className={buttonClass("ghost", "xs")} disabled={disabled || rows.length >= LAYOUT_CONTACTS_MAX} onClick={() => setRows([...rows, { name: "", detail: "" }])}>
                {rows.length >= LAYOUT_CONTACTS_MAX ? `All ${LAYOUT_CONTACTS_MAX} contacts used` : "Add a contact"}
              </button>
            </div>
          </>
        ) : null}
      </SectionBox>
    </div>
  );
}
