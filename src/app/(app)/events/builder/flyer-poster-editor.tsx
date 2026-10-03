"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { Toggle } from "@/components/controls";
import { buttonClass } from "@/components/ui";
import { FLYER_LIMITS, POSTER_AGENDA_MAX, POSTER_LIMITS, type FlyerDesign, type PosterAgendaRow, type PosterContent } from "@/lib/events/flyer";
import type { FlyerArtSetup } from "@/lib/events/flyer-art";
import type { FlyerBrand } from "@/lib/events/flyer-brand";
import { POSTER_ICONS, POSTER_ICON_LABEL, posterIconUri, type PosterIcon } from "@/lib/events/flyer-icons";

import { uploadPartnerLogoAction } from "./flyer-art-actions";
import { FlyerArtPicker } from "./flyer-art-picker";
import { InlineError, SectionBox, TextField } from "./flyer-fields";

const INK = "#1B2C5C";

/** A row of icon buttons (the built-in icon library); one is chosen. */
function IconPicker({ label, value, onChange, disabled }: { label: string; value: PosterIcon; onChange: (v: PosterIcon) => void; disabled: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {POSTER_ICONS.map((icon) => {
        const on = icon === value;
        return (
          <button
            key={icon}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={POSTER_ICON_LABEL[icon]}
            title={POSTER_ICON_LABEL[icon]}
            disabled={disabled}
            onClick={() => onChange(icon)}
            className={`flex h-11 w-11 items-center justify-center rounded-[10px] border bg-white disabled:opacity-60 ${on ? "border-navy ring-2 ring-navy/30" : "border-line"}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={posterIconUri(icon, INK)} alt="" width={26} height={26} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Flyer maker › Poster: the words and sections of the Poster template (Flyers
 * v2). Every section is optional: switch it off or leave it empty and the
 * poster closes up around what is left. The headline, the venue line and the
 * RSVP code are the design's own fields; everything else is design.poster
 * (events.flyer_design, stored with the design on "Use this flyer").
 */
export function FlyerPosterEditor({
  eventId,
  design,
  update,
  disabled,
  hasLogo,
  brand,
  art,
  defaults,
}: {
  eventId: string;
  design: FlyerDesign;
  update: (fn: (d: FlyerDesign) => FlyerDesign) => void;
  disabled: boolean;
  /** The community's brand kit has a logo to put at the top. */
  hasLogo: boolean;
  brand: FlyerBrand;
  art: FlyerArtSetup;
  /** The event's own words and date (what "Use the event's…" puts back). */
  defaults: { poster: PosterContent; venue_line: string };
}) {
  const poster = design.poster ?? defaults.poster;
  const patchPoster = (fn: (p: PosterContent) => PosterContent) => update((d) => ({ ...d, poster: fn(d.poster ?? defaults.poster) }));
  const setPoster = (patch: Partial<PosterContent>) => patchPoster((p) => ({ ...p, ...patch }));

  // ── The partner's logo ──
  const [logo, setLogo] = useState<{ busy: boolean; error: string | null; url: string | null }>({ busy: false, error: null, url: null });
  async function chooseLogo(e: ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setLogo({ busy: true, error: null, url: null });
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await uploadPartnerLogoAction(eventId, fd);
      if (!res.ok) {
        setLogo({ busy: false, error: res.error, url: null });
        return;
      }
      const stored = res.data!;
      patchPoster((p) => ({ ...p, partner: { ...p.partner, on: true, logo_path: stored.path } }));
      setLogo({ busy: false, error: null, url: stored.url });
    } catch (err) {
      console.error("[events/flyer] uploading the partner logo failed:", err);
      setLogo({ busy: false, error: "Could not upload the partner logo — the server did not respond. Check the connection and try again.", url: null });
    } finally {
      input.value = "";
    }
  }

  // ── The agenda ──
  // Rows are plain positions, so after a move, a removal or an addition the keyboard focus is put where the
  // person's attention was (the row they moved, the row that took the place of the removed one, the new row's
  // first box) instead of being left on a button that now belongs to another row; a polite status line says
  // what happened for screen readers.
  const rows = poster.agenda;
  const agendaList = useRef<HTMLOListElement | null>(null);
  const addRowButton = useRef<HTMLButtonElement | null>(null);
  const focusAfter = useRef<string | null>(null);
  const [agendaSaid, setAgendaSaid] = useState("");
  /** Clear, then set: a screen reader announces a message again only when the text changes. */
  const say = (message: string) => {
    setAgendaSaid("");
    window.setTimeout(() => setAgendaSaid(message), 60);
  };
  useEffect(() => {
    const want = focusAfter.current;
    if (!want) return;
    focusAfter.current = null;
    const selector = want.startsWith("time-") ? `#poster-row-${want.slice(5)}-time` : `[data-agenda="${want}"]`;
    const target = want === "add" ? addRowButton.current : agendaList.current?.querySelector<HTMLElement>(selector);
    target?.focus();
  }, [rows]);
  const setRows = (next: PosterAgendaRow[]) => setPoster({ agenda: next });
  const patchRow = (i: number, patch: Partial<PosterAgendaRow>) => setRows(rows.map((r, at) => (at === i ? { ...r, ...patch } : r)));
  const addRow = () => {
    if (rows.length >= POSTER_AGENDA_MAX) return;
    focusAfter.current = `time-${rows.length}`;
    say(`Row ${rows.length + 1} added.`);
    setRows([...rows, { icon: "clock", time: "", text: "" }]);
  };
  const removeRow = (i: number) => {
    // Focus lands on the row that took this one's place, or on the one before it, or on Add a row.
    focusAfter.current = rows.length > 1 ? `remove-${Math.min(i, rows.length - 2)}` : "add";
    say(`Row ${i + 1} removed.`);
    setRows(rows.filter((_, at) => at !== i));
  };
  const moveRow = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    // The moved row keeps the focus, on the same arrow when it can still go that way, else on the other.
    const same = by < 0 ? j > 0 : j < rows.length - 1;
    focusAfter.current = `${same ? (by < 0 ? "up" : "down") : by < 0 ? "down" : "up"}-${j}`;
    say(`Row ${i + 1} moved ${by < 0 ? "up" : "down"} to position ${j + 1}.`);
    setRows(next);
  };

  const ribbonStale = defaults.poster.ribbon.date !== poster.ribbon.date || defaults.poster.ribbon.time !== poster.ribbon.time;
  const venueStale = Boolean(defaults.venue_line) && defaults.venue_line !== design.venue_line;

  return (
    <div className="flex flex-col gap-3">
      <SectionBox title="Headline" note="Big and set in a serif face. It is the one thing a poster must have.">
        <TextField id="poster-headline" label="Headline" value={design.headline} max={FLYER_LIMITS.headline} onChange={(v) => update((d) => ({ ...d, headline: v }))} disabled={disabled} required />
        <TextField
          id="poster-subhead"
          label="Subhead (optional)"
          value={poster.subhead}
          max={POSTER_LIMITS.subhead}
          onChange={(v) => setPoster({ subhead: v })}
          disabled={disabled}
          hint="Gold capitals between two rules, under the headline."
        />
        <TextField id="poster-slogan" label="Slogan (optional)" value={poster.slogan} max={POSTER_LIMITS.slogan} onChange={(v) => setPoster({ slogan: v })} disabled={disabled} />
      </SectionBox>

      <SectionBox
        title="Logos"
        control={null}
        note="Your community's logo and, beside it, a partner's (for an event run with another organization)."
      >
        <Toggle
          label="Show our logo"
          checked={poster.logo && hasLogo}
          onChange={(on) => setPoster({ logo: on })}
          onNote={hasLogo ? "From your brand kit" : undefined}
          offNote={hasLogo ? "No logo" : "No logo in your brand kit yet (Setup › Profile & brand)"}
          disabled={disabled || !hasLogo}
        />
        <Toggle label="Show a partner logo" checked={poster.partner.on} onChange={(on) => patchPoster((p) => ({ ...p, partner: { ...p.partner, on } }))} onNote="A partner's logo or badge" offNote="No partner" disabled={disabled} />
        {poster.partner.on ? (
          <div className="flex flex-col gap-3 rounded-[10px] border border-line-soft bg-ground p-3">
            <div>
              <label htmlFor="poster-partner-file" className="crm-label">
                Upload the partner&apos;s logo (PNG or JPEG, up to 3 MB)
              </label>
              <input id="poster-partner-file" type="file" accept="image/png,image/jpeg" className="crm-input text-[12px]" onChange={(e) => void chooseLogo(e)} disabled={disabled || logo.busy} />
              {logo.busy ? <p className="crm-hint">Uploading…</p> : null}
              {logo.error ? <InlineError>{logo.error}</InlineError> : null}
              {poster.partner.logo_path ? (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {logo.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo.url} alt="The partner's uploaded logo" className="h-[56px] w-auto max-w-[160px] rounded-[6px] border border-line bg-white p-1" />
                  ) : (
                    <p className="crm-hint">A partner logo is uploaded; it shows in the preview.</p>
                  )}
                  <button
                    type="button"
                    className={buttonClass("ghost", "xs")}
                    disabled={disabled}
                    onClick={() => {
                      patchPoster((p) => ({ ...p, partner: { ...p.partner, logo_path: null } }));
                      setLogo({ busy: false, error: null, url: null });
                    }}
                  >
                    Remove the logo (use the badge)
                  </button>
                </div>
              ) : null}
            </div>
            <p className="crm-hint">Without a logo file, a round badge is drawn from these two short lines.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField
                id="poster-partner-label"
                label="Badge, first line"
                value={poster.partner.label}
                max={POSTER_LIMITS.partner_label}
                onChange={(v) => patchPoster((p) => ({ ...p, partner: { ...p.partner, label: v } }))}
                disabled={disabled}
                placeholder="JAINA"
              />
              <TextField
                id="poster-partner-sub"
                label="Badge, second line"
                value={poster.partner.sub}
                max={POSTER_LIMITS.partner_sub}
                onChange={(v) => patchPoster((p) => ({ ...p, partner: { ...p.partner, sub: v } }))}
                disabled={disabled}
                placeholder="2027"
              />
            </div>
          </div>
        ) : null}
      </SectionBox>

      <SectionBox
        title="Highlight box"
        control={<Toggle label="Highlight box" checked={poster.stat.on} onChange={(on) => patchPoster((p) => ({ ...p, stat: { ...p.stat, on } }))} onNote="On" offNote="Left out" disabled={disabled} />}
        note="A big number or fact in a framed box — “MORE THAN 80% of registrations are filled!”"
      >
        {poster.stat.on ? (
          <>
            <div>
              <p className="crm-label" aria-hidden="true">
                Icon
              </p>
              <IconPicker label="Highlight icon" value={poster.stat.icon} onChange={(icon) => patchPoster((p) => ({ ...p, stat: { ...p.stat, icon } }))} disabled={disabled} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField
                id="poster-stat-label"
                label="Small label"
                value={poster.stat.label}
                max={POSTER_LIMITS.stat_label}
                onChange={(v) => patchPoster((p) => ({ ...p, stat: { ...p.stat, label: v } }))}
                disabled={disabled}
                placeholder="MORE THAN"
              />
              <TextField
                id="poster-stat-value"
                label="Big number"
                value={poster.stat.value}
                max={POSTER_LIMITS.stat_value}
                onChange={(v) => patchPoster((p) => ({ ...p, stat: { ...p.stat, value: v } }))}
                disabled={disabled}
                placeholder="80%"
                required
                hint={!poster.stat.value ? "The box needs its big number — or switch the box off." : undefined}
              />
            </div>
            <TextField
              id="poster-stat-caption"
              label="Caption"
              value={poster.stat.caption}
              max={POSTER_LIMITS.stat_caption}
              onChange={(v) => patchPoster((p) => ({ ...p, stat: { ...p.stat, caption: v } }))}
              disabled={disabled}
              placeholder="OF CONVENTION REGISTRATIONS ARE FILLED!"
            />
          </>
        ) : null}
      </SectionBox>

      <SectionBox
        title="Date ribbon"
        control={<Toggle label="Date ribbon" checked={poster.ribbon.on} onChange={(on) => patchPoster((p) => ({ ...p, ribbon: { ...p.ribbon, on } }))} onNote="On" offNote="Left out" disabled={disabled} />}
        note="The date, time and venue on a ribbon. They start as the event's own, in your community's time zone."
      >
        {poster.ribbon.on ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField
                id="poster-ribbon-date"
                label="Date"
                value={poster.ribbon.date}
                max={POSTER_LIMITS.ribbon_date}
                onChange={(v) => patchPoster((p) => ({ ...p, ribbon: { ...p.ribbon, date: v } }))}
                disabled={disabled}
              />
              <TextField
                id="poster-ribbon-time"
                label="Time"
                value={poster.ribbon.time}
                max={POSTER_LIMITS.ribbon_time}
                onChange={(v) => patchPoster((p) => ({ ...p, ribbon: { ...p.ribbon, time: v } }))}
                disabled={disabled}
              />
            </div>
            {ribbonStale && (defaults.poster.ribbon.date || defaults.poster.ribbon.time) ? (
              <div>
                <button
                  type="button"
                  className={buttonClass("ghost", "xs")}
                  disabled={disabled}
                  onClick={() => patchPoster((p) => ({ ...p, ribbon: { ...p.ribbon, date: defaults.poster.ribbon.date, time: defaults.poster.ribbon.time } }))}
                >
                  Use the event&apos;s date and time
                </button>
              </div>
            ) : null}
            <TextField id="poster-venue" label="Venue" value={design.venue_line} max={FLYER_LIMITS.venue_line} onChange={(v) => update((d) => ({ ...d, venue_line: v }))} disabled={disabled} />
            {venueStale ? (
              <div>
                <button type="button" className={buttonClass("ghost", "xs")} disabled={disabled} onClick={() => update((d) => ({ ...d, venue_line: defaults.venue_line }))}>
                  Use the event&apos;s venue
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </SectionBox>

      <SectionBox
        title="Agenda"
        control={
          <button type="button" ref={addRowButton} className={buttonClass("ghost", "xs")} disabled={disabled || rows.length >= POSTER_AGENDA_MAX} onClick={addRow}>
            {rows.length >= POSTER_AGENDA_MAX ? `All ${POSTER_AGENDA_MAX} rows used` : "Add a row"}
          </button>
        }
        note={`Up to ${POSTER_AGENDA_MAX} rows: an icon, a time and what happens. No rows, no agenda.`}
      >
        <p role="status" className="sr-only">
          {agendaSaid}
        </p>
        {rows.length ? (
          <ol ref={agendaList} className="flex flex-col gap-3">
            {rows.map((row, i) => (
              <li key={i} className="rounded-[10px] border border-line-soft bg-ground p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12px] font-bold">Row {i + 1}</p>
                  <div className="flex gap-1">
                    <button type="button" data-agenda={`up-${i}`} className={`${buttonClass("ghost", "xs")} min-h-9 min-w-9`} aria-label={`Move row ${i + 1} up`} disabled={disabled || i === 0} onClick={() => moveRow(i, -1)}>
                      ↑
                    </button>
                    <button type="button" data-agenda={`down-${i}`} className={`${buttonClass("ghost", "xs")} min-h-9 min-w-9`} aria-label={`Move row ${i + 1} down`} disabled={disabled || i === rows.length - 1} onClick={() => moveRow(i, 1)}>
                      ↓
                    </button>
                    <button type="button" data-agenda={`remove-${i}`} className={`${buttonClass("ghost", "xs")} min-h-9`} aria-label={`Remove row ${i + 1}`} disabled={disabled} onClick={() => removeRow(i)}>
                      Remove
                    </button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[auto_150px_1fr] sm:items-end">
                  <div>
                    <label htmlFor={`poster-row-${i}-icon`} className="crm-label">
                      Icon
                    </label>
                    <div className="flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={posterIconUri(row.icon, INK)} alt="" width={28} height={28} />
                      <select id={`poster-row-${i}-icon`} className="crm-input" value={row.icon} disabled={disabled} onChange={(e) => patchRow(i, { icon: e.target.value as PosterIcon })}>
                        {POSTER_ICONS.map((icon) => (
                          <option key={icon} value={icon}>
                            {POSTER_ICON_LABEL[icon]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <TextField id={`poster-row-${i}-time`} label="Time" value={row.time} max={POSTER_LIMITS.agenda_time} onChange={(v) => patchRow(i, { time: v })} disabled={disabled} compact />
                  <TextField id={`poster-row-${i}-text`} label="What happens" value={row.text} max={POSTER_LIMITS.agenda_text} onChange={(v) => patchRow(i, { text: v })} disabled={disabled} compact />
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </SectionBox>

      <SectionBox title="Paragraph and footer">
        <TextField
          id="poster-paragraph"
          label="Paragraph (optional)"
          value={poster.paragraph}
          max={POSTER_LIMITS.paragraph}
          onChange={(v) => setPoster({ paragraph: v })}
          multiline
          rows={4}
          disabled={disabled}
          hint="Starts as the event's description."
        />
        {defaults.poster.paragraph && poster.paragraph !== defaults.poster.paragraph ? (
          <div>
            <button type="button" className={buttonClass("ghost", "xs")} disabled={disabled} onClick={() => setPoster({ paragraph: defaults.poster.paragraph })}>
              Use the event&apos;s description
            </button>
          </div>
        ) : null}
        <TextField
          id="poster-footer"
          label="Footer credit (optional)"
          value={poster.footer}
          max={POSTER_LIMITS.footer}
          onChange={(v) => setPoster({ footer: v })}
          disabled={disabled}
          hint="The line on the bottom band. Empty shows your community's name."
        />
      </SectionBox>

      <SectionBox title="Art" note="The border and the picture along the bottom. The words, logos and layout are always drawn by the flyer maker.">
        <FlyerArtPicker eventId={eventId} brand={brand} poster={poster} onPoster={setPoster} art={art} disabled={disabled} />
      </SectionBox>
    </div>
  );
}
