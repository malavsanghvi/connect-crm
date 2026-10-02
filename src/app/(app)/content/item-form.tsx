"use client";

import { useEffect, useRef, useState } from "react";

import { ActionForm } from "@/components/action-form";
import { Drawer } from "@/components/drawer";
import { HistoryButton } from "@/components/record-history";
import { Alert, buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { nivaBodyCounter, NIVA_SOURCE_MAX_CHARS } from "@/lib/niva-queue";

import { saveContentItemAction } from "./actions";

export type MetaField = "when" | "series" | "length_minutes" | "source" | "schedule" | "stream_status" | "items_count";

const META_LABEL: Record<MetaField, { label: string; hint?: string; type?: "number" | "select" }> = {
  when: { label: "Timing rule", hint: "e.g. Sunrise + 48 minutes" },
  series: { label: "Series", hint: "e.g. Jainism 1" },
  length_minutes: { label: "Length (minutes)", type: "number" },
  source: { label: "Source", hint: "e.g. Streaming provider · embedded player" },
  schedule: { label: "Schedule", hint: "e.g. 24 hours, or Scheduled events" },
  stream_status: { label: "Stream status", type: "select" },
  items_count: { label: "Items", type: "number", hint: "How many entries this source holds" },
};

export type ItemValues = {
  id: string;
  kind: string;
  title: string;
  body_md: string | null;
  media_url: string | null;
  media_path: string | null;
  metadata: Record<string, unknown>;
  /** When given, an edit of a published item says that saving takes it out of what members see. */
  status?: string | null;
};

const COUNTER_TONE = { ok: "text-muted", warn: "text-brown", bad: "font-bold text-danger" } as const;

/**
 * A Niva source's text, with a live character counter (the same count the save checks). Mounted with
 * the drawer, so it starts from the saved text each time the drawer opens; a form reset (after a new
 * source is saved) brings the counter back to the empty box.
 */
function NivaBodyField({ id, defaultValue }: { id: string; defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onReset = () => setTimeout(() => setValue(ref.current?.value ?? ""), 0);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);
  const counter = nivaBodyCounter(value);
  return (
    <div>
      <label htmlFor={id} className="crm-label">
        The text Niva answers from
      </label>
      <textarea
        ref={ref}
        id={id}
        name="body_md"
        rows={10}
        defaultValue={defaultValue}
        onChange={(e) => setValue(e.currentTarget.value)}
        aria-describedby={`${id}-hint ${id}-count`}
        aria-invalid={counter.tone === "bad" || undefined}
        className="crm-input font-mono text-[13px]"
      />
      <p id={`${id}-count`} aria-live="polite" className={`mt-1 text-right text-[12px] ${COUNTER_TONE[counter.tone]}`}>
        {counter.label}
      </p>
      <p id={`${id}-hint`} className="crm-hint">
        Niva quotes only this text, so write it out in full: one topic per source, {NIVA_SOURCE_MAX_CHARS.toLocaleString("en-US")} characters at most. A
        description of the source is not enough.
      </p>
    </div>
  );
}

/**
 * "New …" / "Edit" for a content item in a right-hand drawer. Saving keeps a
 * draft; "Send for approval" puts it in the Approval queue (status in_review).
 * Editing a published item sends it back through approval, and the drawer says so.
 *
 * A Niva source (kind "niva_source") gets its own text box, whatever `bodyLabel` says: the label
 * names it as the text Niva answers from, with a live counter against the 4,000-character limit
 * the save enforces (saveContentItemAction).
 */
export function ContentItemButton({
  kind,
  kindLabel,
  meta,
  item,
  label,
  variant = "primary",
  size = "sm",
  bodyLabel = "Text",
  showMedia = true,
}: {
  kind: string;
  kindLabel: string;
  meta: MetaField[];
  item?: ItemValues;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  bodyLabel?: string;
  showMedia?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const idp = item ? `ci-${item.id.slice(0, 8)}` : `ci-new-${kind}`;
  const m = item?.metadata ?? {};
  const isNiva = kind === "niva_source";
  const published = item?.status === "published";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass(variant, size)}>
        {label}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} kicker={kindLabel} title={item ? item.title : `New ${kindLabel.toLowerCase()}`}>
        <ActionForm
          action={saveContentItemAction}
          submitLabel="Save draft"
          hideSubmit
          resetOnSuccess={!item}
          extraButtons={
            <>
              <button type="submit" name="submit" value="draft" data-variant="ghost" className={buttonClass("ghost")}>
                Save draft
              </button>
              <button type="submit" name="submit" value="review" data-variant="primary" className={buttonClass("primary")}>
                Send for approval
              </button>
              {item ? <HistoryButton table="content_items" recordId={item.id} title={item.title} size="md" /> : null}
            </>
          }
        >
          <input type="hidden" name="kind" value={kind} />
          {item ? <input type="hidden" name="id" value={item.id} /> : null}
          <div className="mb-3 flex flex-col gap-3">
            {published ? (
              <Alert tone="warning" title={isNiva ? "This source is in Niva now" : "This item is published"}>
                {isNiva
                  ? "Saving takes this source out of Niva until it is approved again."
                  : "Saving takes this item off the member app until it is approved again."}
              </Alert>
            ) : null}
            <div>
              <label htmlFor={`${idp}-title`} className="crm-label">
                Title
              </label>
              <input id={`${idp}-title`} name="title" required defaultValue={item?.title ?? ""} maxLength={200} className="crm-input" />
            </div>
            {meta.map((f) => {
              const cfg = META_LABEL[f];
              const value = m[f] === undefined || m[f] === null ? "" : String(m[f]);
              return (
                <div key={f}>
                  <label htmlFor={`${idp}-${f}`} className="crm-label">
                    {cfg.label}
                  </label>
                  {cfg.type === "select" ? (
                    <select id={`${idp}-${f}`} name={`meta_${f}`} defaultValue={value || "idle"} className="crm-input">
                      <option value="live">Live</option>
                      <option value="idle">Idle</option>
                      <option value="off">Off</option>
                    </select>
                  ) : (
                    <input
                      id={`${idp}-${f}`}
                      name={`meta_${f}`}
                      defaultValue={value}
                      inputMode={cfg.type === "number" ? "numeric" : undefined}
                      className="crm-input"
                    />
                  )}
                  {cfg.hint ? <p className="crm-hint">{cfg.hint}</p> : null}
                </div>
              );
            })}
            {isNiva ? (
              <NivaBodyField id={`${idp}-body`} defaultValue={item?.body_md ?? ""} />
            ) : (
              <div>
                <label htmlFor={`${idp}-body`} className="crm-label">
                  {bodyLabel}
                </label>
                <textarea id={`${idp}-body`} name="body_md" rows={6} defaultValue={item?.body_md ?? ""} className="crm-input font-mono text-[13px]" />
              </div>
            )}
            {showMedia ? (
              <>
                <div>
                  <label htmlFor={`${idp}-url`} className="crm-label">
                    Media link (optional)
                  </label>
                  <input id={`${idp}-url`} name="media_url" defaultValue={item?.media_url ?? ""} placeholder="https://" className="crm-input" />
                  <p className="crm-hint">A streaming, audio or video link. Leave blank until the recording exists.</p>
                </div>
                <div>
                  <label htmlFor={`${idp}-path`} className="crm-label">
                    Stored file (optional)
                  </label>
                  <input id={`${idp}-path`} name="media_path" defaultValue={item?.media_path ?? ""} placeholder="audio/navkar.mp3" className="crm-input" />
                </div>
              </>
            ) : null}
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}
