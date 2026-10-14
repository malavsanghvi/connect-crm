"use client";

import { useId, useState, useTransition, type ReactNode } from "react";

import {
  addCareNoteAction,
  archiveCareNoteAction,
  editCareNoteAction,
  logCareTouchAction,
  moreCareTouchesAction,
  saveCareProfileAction,
  setCareOwnerAction,
  voidCareTouchAction,
  type CareSave,
  type ProfileCall,
  type TouchCall,
} from "@/app/(app)/households/[id]/care-actions";
import { buttonClass } from "@/components/ui";
import {
  CHANNEL_LABEL,
  NO_ACCESS,
  OUTCOME_LABEL,
  PROFILE_CHANNELS,
  RECOGNITION,
  RECOGNITION_HINT,
  RECOGNITION_LABEL,
  THANKS,
  THANKS_LABEL,
  TOUCH_CHANNELS,
  TOUCH_KINDS,
  TOUCH_KIND_LABEL,
  TOUCH_OUTCOMES,
  TOUCH_PRESETS,
  accessLine,
  formatMonthDay,
  languageName,
  ownerLine,
  restLine,
  touchLine,
  type CareCard as CardData,
  type CareHolder,
  type CareNote,
  type CarePersonFields,
  type CareProfile,
  type CareTouchPage,
  type CareTouchRow,
} from "@/lib/care/model";
import type { CareCardLoad, CareRead } from "@/lib/data/care";
import { formatCents } from "@/lib/money";

// The Care card on the Family page (WeCare slice 2). Shown only to someone with a WeCare role (the page checks careCan first;
// the database decides). Everything here is the organization's own: Weaver staff cannot see it. Every write says what failed
// in plain words next to what the person did, keeps what they typed, and offers Try again. Nothing here names a child: the
// database never returns one.

const BOX = "rounded-2xl border border-line bg-white p-[18px]";
const H3 = "m-0 mb-1.5 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted";

function Shell({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={BOX} data-testid="care-card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id={id} className="m-0 font-display text-[18px] font-semibold text-ink">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Failure({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mt-2 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
      <p className="m-0">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className={`${buttonClass("bad", "xs")} mt-2`}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** One write at a time per part of the card: pending, the failure with its retry, the last success line. */
function useWrite() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = (call: () => Promise<CareSave>, onOk?: () => void) => {
    const attempt = () =>
      start(async () => {
        setDone(null);
        let res: CareSave;
        try {
          res = await call();
        } catch (e) {
          console.error("[care] the request did not reach the server:", e);
          res = { ok: false, error: "Could not reach the server. Check the connection and try again." };
        }
        if (res.ok) {
          setError(null);
          setDone(res.message);
          onOk?.();
        } else {
          setError({ message: res.error, retry: attempt });
        }
      });
    attempt();
  };
  return { pending, error, done, run, clear: () => setError(null) };
}

/** The Care card, or the reason it cannot be shown (no access, WeCare off, a failed read with its retry). */
export function CareCard({ load, householdId, timeZone, retryHref }: { load: CareCardLoad; householdId: string; timeZone: string; retryHref: string }) {
  const { card } = load;
  if (card.status === "no_access") {
    return (
      <Shell title="Care">
        <p className="m-0 text-[14px] text-muted">{NO_ACCESS}.</p>
      </Shell>
    );
  }
  if (card.status === "off") {
    return (
      <Shell title="Care">
        <p className="m-0 text-[14px] text-muted">{card.message}</p>
      </Shell>
    );
  }
  if (card.status === "error") {
    return (
      <Shell title="Care">
        <div role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          <p className="m-0">Could not load the care record — {card.error.replace(/\.?$/, ".")}</p>
          <a href={retryHref} className={`${buttonClass("bad", "xs")} mt-2`}>
            Try again
          </a>
        </div>
      </Shell>
    );
  }
  return <CareCardBody data={card.data} touches={load.touches} holders={load.holders} householdId={householdId} timeZone={timeZone} />;
}

function CareCardBody({
  data,
  touches,
  holders,
  householdId,
  timeZone,
}: {
  data: CardData;
  touches: CareRead<CareTouchPage>;
  holders: CareRead<CareHolder[]> | null;
  householdId: string;
  timeZone: string;
}) {
  const rest = restLine(data.profile);
  return (
    <Shell
      title={data.label}
      aside={
        data.owners.needsOwner ? (
          <span className="rounded-full bg-[var(--v2-sun-tint)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--v2-sun-ink)]">Needs an owner</span>
        ) : null
      }
    >
      {rest ? (
        <p role="status" className="m-0 mb-3 rounded-[10px] border border-[var(--v2-sun-from)]/60 bg-[var(--v2-sun-tint)] px-3 py-2 text-[13.5px] font-semibold text-[var(--v2-sun-ink)]">
          {rest}. Thank and care for them as usual; no asks.
        </p>
      ) : null}
      <Owners data={data} holders={holders} householdId={householdId} />
      <Profile data={data} householdId={householdId} />
      <Touches data={data} first={touches} householdId={householdId} timeZone={timeZone} />
      <Notes notes={data.notes} total={data.notesTotal} canManage={data.access.manage} adults={data.household.adults} householdId={householdId} timeZone={timeZone} />
      <PeopleFields data={data} />
      <p className="m-0 mt-4 border-t border-line pt-3 text-[12.5px] text-muted">{accessLine(data.label, data.access)}</p>
    </Shell>
  );
}

// ── Owners ───────────────────────────────────────────────────────────────────
function Owners({ data, holders, householdId }: { data: CardData; holders: CareRead<CareHolder[]> | null; householdId: string }) {
  const [editing, setEditing] = useState(false);
  const [owner, setOwner] = useState(data.owners.owner?.holds ? data.owners.owner.userId : "");
  const [backup, setBackup] = useState(data.owners.backup?.holds ? data.owners.backup.userId : "");
  const w = useWrite();
  const ownerId = useId();
  const backupId = useId();
  const save = () =>
    w.run(() => setCareOwnerAction({ householdId, ownerId: owner || null, backupId: owner && backup ? backup : null }), () => setEditing(false));
  return (
    <div className="mb-3">
      <p className={`m-0 text-[14.5px] ${data.owners.needsOwner ? "font-semibold text-[var(--v2-sun-ink)]" : "text-ink"}`}>
        {ownerLine(data.owners)}
        {data.access.manage && !editing ? (
          <button type="button" onClick={() => setEditing(true)} className="ml-2 text-[13px] font-bold text-[var(--v2-blue)] hover:underline">
            {data.owners.owner ? "Change" : "Choose an owner"}
          </button>
        ) : null}
      </p>
      {editing ? (
        holders && holders.status === "ok" ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor={ownerId} className="crm-label">
                Relationship owner
              </label>
              <select id={ownerId} className="crm-input" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">No owner</option>
                {holders.data.map((h) => (
                  <option key={h.userId} value={h.userId}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={backupId} className="crm-label">
                Backup
              </label>
              <select id={backupId} className="crm-input" value={backup} disabled={!owner} onChange={(e) => setBackup(e.target.value)}>
                <option value="">No backup</option>
                {holders.data
                  .filter((h) => h.userId !== owner)
                  .map((h) => (
                    <option key={h.userId} value={h.userId}>
                      {h.name}
                    </option>
                  ))}
              </select>
            </div>
            <p className="m-0 text-[12.5px] text-muted sm:col-span-2">Only people with a care role can own a household. The backup sees it exactly as the owner does.</p>
            <div className="flex gap-2 sm:col-span-2">
              <button type="button" onClick={save} disabled={w.pending} className={buttonClass("primary", "sm")}>
                {w.pending ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => (setEditing(false), w.clear())} className={buttonClass("ghost", "sm")}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <Failure
            message={
              holders?.status === "error"
                ? `Could not load who can own a household — ${holders.error.replace(/\.?$/, ".")}`
                : holders?.status === "off"
                  ? holders.message
                  : `${NO_ACCESS}.`
            }
          />
        )
      ) : null}
      {w.error ? <Failure message={w.error.message} onRetry={w.error.retry} /> : null}
    </div>
  );
}

// ── The care profile ─────────────────────────────────────────────────────────
function profileValue(p: CareProfile | null, data: CardData): { label: string; value: string }[] {
  return [
    { label: "Thank them", value: p?.thanks ? THANKS_LABEL[p.thanks] : "Not known yet" },
    { label: "Recognition", value: p?.recognition ? RECOGNITION_LABEL[p.recognition] : "Not known yet" },
    { label: "Reach them by", value: p?.channel ? CHANNEL_LABEL[p.channel] : "Not known yet" },
    { label: "Language", value: p?.language ? languageName(p.language) : "Not known yet" },
    { label: "Reach first", value: p?.contactName ?? (data.household.primaryMember ? `${data.household.primaryMember} (primary)` : "Not chosen") },
  ];
}

function Profile({ data, householdId }: { data: CardData; householdId: string }) {
  const p = data.profile;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => ({
    thanks: p?.thanks ?? "",
    recognition: p?.recognition ?? "",
    channel: p?.channel ?? "",
    language: p?.language ?? "",
    contact: p?.contactPersonId ?? "",
    // An ended rest is not carried into the form (saving it again would be refused as a date in the past).
    doNotAsk: p?.resting ?? false,
    restUntil: p?.resting ? (p.restUntil ?? "") : "",
  }));
  const w = useWrite();
  const ids = { thanks: useId(), recognition: useId(), channel: useId(), language: useId(), contact: useId(), dna: useId(), rest: useId() };
  const set = (k: keyof typeof draft, v: string | boolean) => setDraft((d) => ({ ...d, [k]: v }));
  const save = () => {
    const fields: ProfileCall["fields"] = {
      thanks: draft.thanks || null,
      recognition: draft.recognition || null,
      channel: draft.channel || null,
      language: draft.language || null,
      contact_person_id: draft.contact || null,
      do_not_ask: draft.doNotAsk,
      rest_until: draft.doNotAsk ? draft.restUntil || null : null,
    };
    w.run(() => saveCareProfileAction({ householdId, fields }), () => setEditing(false));
  };
  return (
    <div className="mb-3 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className={H3}>How they like to be cared for</h3>
        {!editing ? (
          <button type="button" onClick={() => setEditing(true)} className="text-[13px] font-bold text-[var(--v2-blue)] hover:underline">
            Edit
          </button>
        ) : null}
      </div>
      {!editing ? (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px]">
          {profileValue(p, data).map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-muted">{r.label}</dt>
              <dd className="m-0 text-ink">{r.value}</dd>
            </div>
          ))}
          {p?.recognition ? (
            <p className="col-span-2 m-0 text-[12.5px] text-muted">{RECOGNITION_HINT[p.recognition]}</p>
          ) : null}
        </dl>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <Select id={ids.thanks} label="Thank them" value={draft.thanks} onChange={(v) => set("thanks", v)} options={THANKS.map((k) => [k, THANKS_LABEL[k]])} />
          <Select id={ids.recognition} label="Recognition" value={draft.recognition} onChange={(v) => set("recognition", v)} options={RECOGNITION.map((k) => [k, RECOGNITION_LABEL[k]])} />
          <Select id={ids.channel} label="Reach them by" value={draft.channel} onChange={(v) => set("channel", v)} options={PROFILE_CHANNELS.map((k) => [k, CHANNEL_LABEL[k]])} />
          <Select id={ids.language} label="Language" value={draft.language} onChange={(v) => set("language", v)} options={data.languages.map((l) => [l, languageName(l)])} />
          <Select
            id={ids.contact}
            label="Reach first"
            value={draft.contact}
            onChange={(v) => set("contact", v)}
            options={data.household.adults.map((a) => [a.personId, a.name])}
            empty="The primary member"
          />
          <div>
            <span className="crm-label">Asking</span>
            <label htmlFor={ids.dna} className="flex min-h-10 items-center gap-2 text-[14px] text-ink">
              <input id={ids.dna} type="checkbox" checked={draft.doNotAsk} onChange={(e) => set("doNotAsk", e.target.checked)} />
              Do not ask
            </label>
          </div>
          {draft.doNotAsk ? (
            <div>
              <label htmlFor={ids.rest} className="crm-label">
                Rest until (leave empty: until someone changes it)
              </label>
              <input id={ids.rest} type="date" className="crm-input" value={draft.restUntil} min={data.today ?? undefined} onChange={(e) => set("restUntil", e.target.value)} />
            </div>
          ) : null}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" onClick={save} disabled={w.pending} className={buttonClass("primary", "sm")}>
              {w.pending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => (setEditing(false), w.clear())} className={buttonClass("ghost", "sm")}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {w.error ? <Failure message={w.error.message} onRetry={w.error.retry} /> : null}
    </div>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  options,
  empty = "Not known yet",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  empty?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="crm-label">
        {label}
      </label>
      <select id={id} className="crm-input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{empty}</option>
        {options.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Touches ──────────────────────────────────────────────────────────────────
function when(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" });
}

function Touches({ data, first, householdId, timeZone }: { data: CardData; first: CareRead<CareTouchPage>; householdId: string; timeZone: string }) {
  const [older, setOlder] = useState<CareTouchRow[]>([]);
  const [more, setMore] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [form, setForm] = useState(false);
  const quick = useWrite();
  const remove = useWrite();
  const rows = first.status === "ok" ? [...first.data.rows, ...older] : [];
  const hasMore = more ?? (first.status === "ok" ? first.data.more : false);

  const loadOlder = () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    startLoading(async () => {
      const res = await moreCareTouchesAction({ householdId, beforeAt: last.at, beforeKey: last.key }).catch((e: unknown) => {
        console.error("[care] could not load more touches:", e);
        return { ok: false as const, error: "Could not load more touches — the server could not be reached." };
      });
      if (res.ok) {
        setLoadError(null);
        setOlder((o) => [...o, ...res.page.rows]);
        setMore(res.page.more);
      } else setLoadError(res.error);
    });
  };

  return (
    <div className="mb-3 border-t border-line pt-3">
      <h3 className={H3}>Touches</h3>
      <p className="m-0 mb-2 text-[13px] text-muted">
        {data.lastTouch ? `Last personal touch ${when(data.lastTouch.at, timeZone)}${data.lastTouch.by ? ` by ${data.lastTouch.by}` : ""}. ` : "No personal touch recorded yet. "}
        {data.touches12m} in the last 12 months, {data.asks12m === 1 ? "1 of them an ask" : `${data.asks12m} of them asks`}.
      </p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Record a touch in one tap">
        {TOUCH_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className="cc-chip"
            disabled={quick.pending}
            onClick={() => quick.run(() => logCareTouchAction({ householdId, kind: p.touch.kind, channel: p.touch.channel, outcome: p.touch.outcome, isAsk: p.touch.is_ask }))}
          >
            {p.label}
          </button>
        ))}
        <button type="button" className="cc-chip" aria-expanded={form} onClick={() => setForm((f) => !f)}>
          {form ? "Close" : "Another touch…"}
        </button>
      </div>
      {quick.done && !quick.error ? (
        <p role="status" className="m-0 mt-1 text-[13px] text-success">
          {quick.done}
        </p>
      ) : null}
      {quick.error ? <Failure message={quick.error.message} onRetry={quick.error.retry} /> : null}
      {form ? <TouchForm data={data} householdId={householdId} onDone={() => setForm(false)} /> : null}

      {first.status === "ok" ? (
        rows.length === 0 ? (
          <p className="m-0 mt-2 text-[13.5px] text-muted">Nothing yet: no touches recorded, and no messages, receipts, check-ins or shifts for the adults.</p>
        ) : (
          <ul className="m-0 mt-2 list-none divide-y divide-line p-0">
            {rows.map((t) => (
              <li key={t.key} className="py-2 text-[13.5px]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="m-0 text-ink">
                      <span className="text-muted">{when(t.at, timeZone)}</span> · {touchLine(t)}
                      {t.amountCents !== null ? ` · ${formatCents(t.amountCents)}` : ""}
                    </p>
                    <p className="m-0 text-[12.5px] text-muted">
                      {[t.personName ? `With ${t.personName}` : null, t.by ? `By ${t.by}` : null, t.source !== "manual" ? "From Weaver's records" : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {t.note ? (
                      <p dir="auto" className="m-0 mt-0.5 whitespace-pre-wrap text-ink">
                        {t.note}
                      </p>
                    ) : null}
                  </div>
                  {t.canRemove ? (
                    <button
                      type="button"
                      disabled={remove.pending}
                      className="shrink-0 text-[12.5px] font-bold text-[var(--v2-blue)] hover:underline"
                      onClick={() => {
                        if (window.confirm("Remove this touch from the log? It stays in the history.")) {
                          remove.run(() => voidCareTouchAction({ householdId, touchId: t.id }), () => setOlder((o) => o.filter((x) => x.id !== t.id)));
                        }
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <Failure
          message={
            first.status === "error"
              ? `Could not load the touch log — ${first.error.replace(/\.?$/, ".")}`
              : first.status === "off"
                ? first.message
                : `${NO_ACCESS}.`
          }
        />
      )}
      {remove.error ? <Failure message={remove.error.message} onRetry={remove.error.retry} /> : null}
      {hasMore ? (
        <button type="button" onClick={loadOlder} disabled={loading} className={`${buttonClass("ghost", "xs")} mt-2`}>
          {loading ? "Loading…" : "Show older touches"}
        </button>
      ) : null}
      {loadError ? <Failure message={loadError} onRetry={loadOlder} /> : null}
    </div>
  );
}

function TouchForm({ data, householdId, onDone }: { data: CardData; householdId: string; onDone: () => void }) {
  const [t, setT] = useState<{ kind: string; channel: string; outcome: string; isAsk: boolean; note: string; personId: string; day: string }>({
    kind: "check_in",
    channel: "phone",
    outcome: "done",
    isAsk: false,
    note: "",
    personId: "",
    day: "",
  });
  const w = useWrite();
  const ids = { kind: useId(), channel: useId(), outcome: useId(), ask: useId(), note: useId(), person: useId(), day: useId() };
  const save = () => {
    const call: TouchCall = {
      householdId,
      kind: t.kind,
      channel: t.channel,
      outcome: t.outcome,
      isAsk: t.kind === "care_moment" ? false : t.isAsk,
      note: t.note.trim() || null,
      personId: t.personId || null,
      // A past day: noon in the browser's time, so the date stays the day chosen.
      touchedAt: t.day ? new Date(`${t.day}T12:00:00`).toISOString() : null,
    };
    w.run(() => logCareTouchAction(call), onDone);
  };
  return (
    <div className="mt-2 grid gap-2 rounded-[12px] border border-line bg-[var(--v2-ground)] p-3 sm:grid-cols-2">
      <Select id={ids.kind} label="What" value={t.kind} onChange={(v) => setT({ ...t, kind: v })} options={TOUCH_KINDS.map((k) => [k, TOUCH_KIND_LABEL[k]])} empty="Choose" />
      <Select id={ids.channel} label="How" value={t.channel} onChange={(v) => setT({ ...t, channel: v })} options={TOUCH_CHANNELS.map((k) => [k, CHANNEL_LABEL[k]])} empty="Choose" />
      <Select id={ids.outcome} label="How it went" value={t.outcome} onChange={(v) => setT({ ...t, outcome: v })} options={TOUCH_OUTCOMES.map((k) => [k, OUTCOME_LABEL[k]])} empty="Choose" />
      <Select id={ids.person} label="With" value={t.personId} onChange={(v) => setT({ ...t, personId: v })} options={data.household.adults.map((a) => [a.personId, a.name])} empty="The household" />
      <div>
        <label htmlFor={ids.day} className="crm-label">
          When (leave empty: today)
        </label>
        <input id={ids.day} type="date" className="crm-input" value={t.day} max={data.today ?? undefined} onChange={(e) => setT({ ...t, day: e.target.value })} />
      </div>
      <div>
        <span className="crm-label">Ask or no ask</span>
        <label htmlFor={ids.ask} className="flex min-h-10 items-center gap-2 text-[14px] text-ink">
          <input id={ids.ask} type="checkbox" checked={t.isAsk && t.kind !== "care_moment"} disabled={t.kind === "care_moment"} onChange={(e) => setT({ ...t, isAsk: e.target.checked })} />
          This touch was an ask
        </label>
        {t.kind === "care_moment" ? <p className="m-0 text-[12.5px] text-muted">A care moment is never an ask.</p> : null}
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={ids.note} className="crm-label">
          Note (optional, about the adults only)
        </label>
        <textarea id={ids.note} className="crm-input min-h-[72px] py-2" maxLength={1000} value={t.note} onChange={(e) => setT({ ...t, note: e.target.value })} />
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <button type="button" onClick={save} disabled={w.pending || !t.kind || !t.channel || !t.outcome} className={buttonClass("primary", "sm")}>
          {w.pending ? "Saving…" : "Record touch"}
        </button>
      </div>
      {w.error ? (
        <div className="sm:col-span-2">
          <Failure message={w.error.message} onRetry={w.error.retry} />
        </div>
      ) : null}
    </div>
  );
}

// ── Notes ────────────────────────────────────────────────────────────────────
function Notes({
  notes,
  total,
  canManage,
  adults,
  householdId,
  timeZone,
}: {
  notes: CareNote[];
  total: number;
  canManage: boolean;
  adults: CardData["household"]["adults"];
  householdId: string;
  timeZone: string;
}) {
  const [body, setBody] = useState("");
  const [personId, setPersonId] = useState("");
  const add = useWrite();
  const ids = { body: useId(), person: useId() };
  return (
    <div className="mb-3 border-t border-line pt-3">
      <h3 className={H3}>Care notes</h3>
      {notes.length === 0 ? <p className="m-0 text-[13.5px] text-muted">No notes yet.</p> : null}
      <ul className="m-0 list-none space-y-2 p-0">
        {notes.map((n) => (
          <NoteRow key={n.id} note={n} canManage={canManage} householdId={householdId} timeZone={timeZone} />
        ))}
      </ul>
      {total > notes.length ? <p className="m-0 mt-1 text-[12.5px] text-muted">Showing the latest {notes.length} of {total} notes.</p> : null}
      <div className="mt-2">
        <label htmlFor={ids.body} className="crm-label">
          Add a note (about the adults only)
        </label>
        <textarea id={ids.body} className="crm-input min-h-[64px] py-2" maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="mt-1.5 flex flex-wrap items-end gap-2">
          {adults.length > 1 ? (
            <div>
              <label htmlFor={ids.person} className="crm-label">
                About
              </label>
              <select id={ids.person} className="crm-input" value={personId} onChange={(e) => setPersonId(e.target.value)}>
                <option value="">The household</option>
                {adults.map((a) => (
                  <option key={a.personId} value={a.personId}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <button
            type="button"
            disabled={add.pending || !body.trim()}
            onClick={() => add.run(() => addCareNoteAction({ householdId, body, personId: personId || null }), () => (setBody(""), setPersonId("")))}
            className={buttonClass("primary", "sm")}
          >
            {add.pending ? "Saving…" : "Save note"}
          </button>
        </div>
        {add.error ? <Failure message={add.error.message} onRetry={add.error.retry} /> : null}
      </div>
    </div>
  );
}

function NoteRow({ note, canManage, householdId, timeZone }: { note: CareNote; canManage: boolean; householdId: string; timeZone: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.body);
  const w = useWrite();
  const id = useId();
  return (
    <li className="rounded-[10px] bg-[var(--v2-ground)] px-3 py-2 text-[13.5px]">
      {editing ? (
        <div>
          <label htmlFor={id} className="sr-only">
            Note
          </label>
          <textarea id={id} className="crm-input min-h-[64px] py-2" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="mt-1.5 flex gap-2">
            <button type="button" disabled={w.pending} onClick={() => w.run(() => editCareNoteAction({ householdId, noteId: note.id, body: text }), () => setEditing(false))} className={buttonClass("primary", "xs")}>
              {w.pending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => (setEditing(false), setText(note.body), w.clear())} className={buttonClass("ghost", "xs")}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p dir="auto" className="m-0 whitespace-pre-wrap text-ink">
          {note.body}
        </p>
      )}
      <p className="m-0 mt-1 text-[12px] text-muted">
        {[note.personName ? `About ${note.personName}` : null, note.by ? `By ${note.by}` : null, when(note.createdAt, timeZone), note.editedAt ? "corrected" : null].filter(Boolean).join(" · ")}
        {note.mine && !editing ? (
          <button type="button" onClick={() => setEditing(true)} className="ml-2 font-bold text-[var(--v2-blue)] hover:underline">
            Correct
          </button>
        ) : null}
        {(note.mine || canManage) && !editing ? (
          <button
            type="button"
            disabled={w.pending}
            onClick={() => {
              if (window.confirm("Archive this note? It leaves the card and stays in the history.")) w.run(() => archiveCareNoteAction({ householdId, noteId: note.id }));
            }}
            className="ml-2 font-bold text-[var(--v2-blue)] hover:underline"
          >
            Archive
          </button>
        ) : null}
      </p>
      {w.error ? <Failure message={w.error.message} onRetry={w.error.retry} /> : null}
    </li>
  );
}

// ── The People fields, read where they live ──────────────────────────────────
const CALL_TIME: Record<string, string> = { morning: "mornings", afternoon: "afternoons", evening: "evenings" };

function agreedLine(a: CarePersonFields["agreed"]): string {
  const yes = [a.email ? "email" : null, a.sms ? "texts" : null, a.whatsapp ? "WhatsApp" : null, a.post ? "post" : null].filter(Boolean);
  const no = [a.email === false ? "email" : null, a.sms === false ? "texts" : null, a.whatsapp === false ? "WhatsApp" : null, a.post === false ? "post" : null].filter(Boolean);
  const parts: string[] = [];
  if (yes.length) parts.push(`Agreed to ${yes.join(", ")}`);
  if (no.length) parts.push(`said no to ${no.join(", ")}`);
  return parts.join("; ");
}

function PeopleFields({ data }: { data: CardData }) {
  if (!data.people) {
    return (
      <div className="border-t border-line pt-3">
        <h3 className={H3}>From People</h3>
        <p className="m-0 text-[13px] text-muted">Interests, best call time, special days and dietary needs show here for roles that can also see People.</p>
      </div>
    );
  }
  return (
    <div className="border-t border-line pt-3">
      <h3 className={H3}>From People</h3>
      {data.people.length === 0 ? <p className="m-0 text-[13px] text-muted">No adults are recorded in this household.</p> : null}
      <ul className="m-0 list-none space-y-2 p-0">
        {data.people.map((p) => {
          const lines = [
            p.bestCallTime ? `Best called in the ${CALL_TIME[p.bestCallTime] ?? p.bestCallTime}` : null,
            p.language ? `Speaks ${languageName(p.language)}` : null,
            p.interests.length ? `Interests: ${p.interests.join(", ")}` : null,
            p.expertise.length ? `Expertise: ${p.expertise.join(", ")}` : null,
            p.anniversary ? `Anniversary ${formatMonthDay(p.anniversary)}` : null,
            p.dietary.length || p.dietaryOther ? `Dietary: ${[...p.dietary, p.dietaryOther].filter(Boolean).join(", ")}` : null,
            agreedLine(p.agreed) || null,
          ].filter((x): x is string => Boolean(x));
          return (
            <li key={p.personId} className="text-[13.5px]">
              <p className="m-0 font-semibold text-ink">{p.name}</p>
              {lines.length ? (
                <p className="m-0 text-muted">{lines.join(" · ")}</p>
              ) : (
                <p className="m-0 text-muted">Nothing more recorded in People.</p>
              )}
            </li>
          );
        })}
      </ul>
      {data.specialDays && data.specialDays.length > 0 ? (
        <p className="m-0 mt-2 text-[13px] text-muted">
          Special days:{" "}
          {data.specialDays
            .map((d) => `${d.label ?? d.kind.replace(/_/g, " ")}${d.personName ? ` (${d.personName})` : ""}${d.date ? ` ${formatMonthDay(d.date)}` : d.tithi ? ` ${d.tithi}` : ""}`)
            .join(" · ")}
        </p>
      ) : null}
      <p className="m-0 mt-1 text-[12px] text-faint">Read from People as they are today: change them on the person, not here.</p>
    </div>
  );
}

