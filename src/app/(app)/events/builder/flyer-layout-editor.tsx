"use client";

// Flyers v3: the Layout choice and the editors of the layout's blocks (flyer-layout.ts). Used by the full flyer maker (the poster
// editor) and by the guided creator's flyer panel, so both change the same poster.layout. Every block is optional: switch it
// off, or leave it empty, and the flyer closes up around what is left.

import { ChipGroup, Toggle } from "@/components/controls";
import { buttonClass } from "@/components/ui";
import { POSTER_LIMITS, type PosterContent } from "@/lib/events/flyer";
import { artPack, svgDataUri } from "@/lib/events/flyer-art-packs";
import { ORNAMENT_FAMILIES, ORNAMENT_LABEL, type OrnamentFamily } from "@/lib/events/flyer-decor";
import type { FlyerBrand } from "@/lib/events/flyer-brand";
import {
  CREDIT_GROUPS_MAX,
  HERO_SHAPES,
  HERO_SHAPE_LABEL,
  LAYOUT_CONTACTS_MAX,
  LAYOUT_LIMITS,
  LAYOUT_PRESET_LIST,
  originalThumbnailSvg,
  presetThumbnailSvg,
  titleWords,
  withLayoutPreset,
  withoutLayout,
  type BlockKey,
  type CreditGroup,
  type HeroShape,
  type LayoutContact,
  type PosterLayout,
} from "@/lib/events/flyer-layout";

import { SectionBox, TextField } from "./flyer-fields";
import { HeroPicker } from "./flyer-hero-picker";
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
  ornament,
  onPoster,
  disabled,
}: {
  poster: PosterContent;
  brand: FlyerBrand;
  headline: string;
  /** The greeting of the community's tradition, or "" (none): offered when a layout is chosen. */
  greeting: string;
  /** The corner decoration of the community's tradition (leaves for most, a lotus for the traditions that use it): where a new layout starts. */
  ornament: OrnamentFamily;
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
    else onPoster((p) => withLayoutPreset(p, key as never, { headline, greeting, ornament }));
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
            className={`flex items-start gap-3 rounded-field border bg-white p-2 text-left disabled:opacity-60 ${on ? "border-navy ring-2 ring-navy/30" : "border-line"}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={svgDataUri(o.svg)} alt="" width={64} height={80} className="h-20 w-16 shrink-0 rounded-chip border border-line-soft" />
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
  eventId,
  poster,
  headline,
  greeting,
  onPoster,
  disabled,
  isGuestVisible,
}: {
  eventId: string;
  poster: PosterContent;
  headline: string;
  greeting: string;
  onPoster: UpdatePoster;
  disabled: boolean;
  /** Anyone who sees this flyer sees the picture, guests included. */
  isGuestVisible?: boolean;
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
  const groups = layout.credits;
  const setGroups = (next: CreditGroup[]) => patch({ credits: next });
  const patchGroup = (i: number, partial: Partial<CreditGroup>) => setGroups(groups.map((g, at) => (at === i ? { ...g, ...partial } : g)));

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

      <SectionBox title="Decoration" note="The leaves, blossoms or lotus in the corners, drawn over a drawn frame in your brand's colours. An AI frame or no frame is left as it is.">
        <ChipGroup
          label="Corner decoration"
          options={ORNAMENT_FAMILIES.map((family) => ({ value: family, label: ORNAMENT_LABEL[family] }))}
          value={layout.ornament}
          onChange={(v) => patch({ ornament: v as OrnamentFamily })}
          disabled={disabled}
        />
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
        title="Picture"
        note="A picture of what the event is about, from your own photo albums (Weaver never makes it, and photos of children are not offered). Choose how it is framed; Weaver places it."
      >
        <ChipGroup
          label="Picture frame"
          options={HERO_SHAPES.map((shape) => ({ value: shape, label: HERO_SHAPE_LABEL[shape] }))}
          value={layout.hero.shape}
          onChange={(v) => patch({ hero: { ...layout.hero, shape: v as HeroShape } })}
          disabled={disabled}
        />
        <HeroPicker eventId={eventId} value={layout.hero.photo_id} onChange={(photo_id) => patch({ hero: { ...layout.hero, photo_id } })} disabled={disabled} isGuestVisible={isGuestVisible} />
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
        title="Thank-you cards"
        control={
          <button type="button" className={buttonClass("ghost", "xs")} disabled={disabled || groups.length >= CREDIT_GROUPS_MAX} onClick={() => setGroups([...groups, { heading: "", names: "", icon: "people" }])}>
            {groups.length >= CREDIT_GROUPS_MAX ? `All ${CREDIT_GROUPS_MAX} cards used` : "Add a card"}
          </button>
        }
        note={`One card for each team or group you want to thank (up to ${CREDIT_GROUPS_MAX}): a heading, a picture and their names. Names are set by Weaver and never sent to an AI.`}
      >
        {groups.length ? (
          <ol className="flex flex-col gap-3">
            {groups.map((g, i) => (
              <li key={i} className="rounded-field border border-line-soft bg-ground p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-bold">Card {i + 1}</p>
                  <button type="button" className={`${buttonClass("ghost", "xs")} min-h-9`} aria-label={`Remove card ${i + 1}`} disabled={disabled} onClick={() => setGroups(groups.filter((_, at) => at !== i))}>
                    Remove
                  </button>
                </div>
                <div className="mt-2 flex flex-col gap-2">
                  <TextField id={`layout-credit-${i}-heading`} label="Heading" value={g.heading} max={LAYOUT_LIMITS.credit_heading} onChange={(v) => patchGroup(i, { heading: v })} disabled={disabled} compact placeholder="Welcome team" />
                  <div>
                    <p className="crm-label" aria-hidden="true">
                      Picture
                    </p>
                    <IconPicker label={`Picture for card ${i + 1}`} value={g.icon} onChange={(icon) => patchGroup(i, { icon })} disabled={disabled} />
                  </div>
                  <TextField id={`layout-credit-${i}-names`} label="Names" value={g.names} max={LAYOUT_LIMITS.credit_names} onChange={(v) => patchGroup(i, { names: v })} multiline rows={2} disabled={disabled} compact />
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </SectionBox>

      <SectionBox title="Donors and closing message" note="A panel for the donors, with its own heading, and a closing message under it.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[220px_1fr]">
          <TextField id="layout-donors-heading" label="Heading" value={layout.donors.heading} max={LAYOUT_LIMITS.donors_heading} onChange={(v) => patch({ donors: { ...layout.donors, heading: v } })} disabled={disabled} />
          <TextField id="layout-donors-names" label="Names of the donors" value={layout.donors.names} max={LAYOUT_LIMITS.donors_names} onChange={(v) => patch({ donors: { ...layout.donors, names: v } })} multiline rows={3} disabled={disabled} hint={!layout.donors.names ? "The panel shows once it has names." : undefined} />
        </div>
        <TextField id="layout-closing" label="Closing message" value={layout.closing} max={LAYOUT_LIMITS.closing} onChange={(v) => patch({ closing: v })} multiline rows={2} disabled={disabled} />
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
                <li key={i} className="rounded-field border border-line-soft bg-ground p-2">
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
