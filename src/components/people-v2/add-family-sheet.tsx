"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { addFamilyAction, findFamilyMatchesAction, type AddFamilyAnswer } from "@/app/(app)/people/add-family-actions";
import { buttonClass } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import {
  FAMILY_MATCH_LABELS,
  canCheckForMatches,
  familyDraftProblem,
  isStrongMatch,
  matchesHeading,
  parseContact,
  type FamilyDraft,
  type FamilyMatchView,
  type FamilyMatchesView,
} from "@/lib/people-family";

/**
 * AddFamilySheet: "Add a family" as a sheet (a centred dialog on a desktop, a full-width sheet on a phone). The first adult's name, a
 * mobile or an email in ONE box, and an optional street. While the person types, families that may already be this one appear under
 * "Already here?" with their household card (number, IDs, adults, city) and an "Open it" button. Enter adds. If there are possible
 * matches, adding asks once more ("None of these — add a new family"): nothing is created until the person has said so. No child is
 * created here (children are added from the family's page).
 *
 * PROPS CONTRACT (the People home mounts it; nothing else is needed):
 *   open        boolean, required. The sheet is drawn only while true. Closing is always the parent's job: it sets `open` to false in onClose.
 *               Every time it turns true the sheet starts fresh (empty fields, no matches).
 *   onClose     () => void, required. Called by Cancel, the close button, Esc and a click on the dimmed background (never while saving).
 *   onAdded     (added: { householdId, personId, householdNumber }) => void, optional. Called once after the family was added. Default:
 *               router.push(`/households/${householdId}`) (the new family's page) and then onClose().
 *   onOpenFamily (householdId: string) => void, optional. Called when the person chooses "Open it" on a possible match. Default:
 *               router.push(`/households/${householdId}`) and then onClose().
 *   initialName string, optional. What was typed in the People box ("Priya Shah"): the last word becomes the last name, the rest the first
 *               name. Only a starting point; both fields stay editable. Read when the sheet opens.
 *   canAdd      boolean, optional, default true. false draws "You don't have access to this area" instead of the form (the people.manage
 *               check in the database is the real gate; a refusal from the server shows the same words).
 *   actions     { check, add }, optional. The two Server Actions, replaceable so the dev preview and the tests need no server.
 * It keeps its own state, needs no provider, and uses the New look tokens ([data-look="v2"]).
 */
export type AddFamilySheetProps = {
  open: boolean;
  onClose: () => void;
  onAdded?: (added: { householdId: string; personId: string; householdNumber: string | null }) => void;
  onOpenFamily?: (householdId: string) => void;
  initialName?: string;
  canAdd?: boolean;
  actions?: AddFamilyActions;
};

export type AddFamilyActions = {
  check: (draft: FamilyDraft) => Promise<ActionResult<FamilyMatchesView>>;
  add: (prev: ActionResult<AddFamilyAnswer> | null, fd: FormData) => Promise<ActionResult<AddFamilyAnswer>>;
};

const DEFAULT_ACTIONS: AddFamilyActions = { check: findFamilyMatchesAction, add: addFamilyAction };

type Check = { state: "idle" } | { state: "checking" } | { state: "ready"; view: FamilyMatchesView } | { state: "error"; error: string };
const IDLE: Check = { state: "idle" };

const NO_ACCESS = "You don't have access to this area";
const isRefusal = (error: string) => /don't have permission|not set up|switched off|session has expired/i.test(error);

/** "Priya Shah" → first "Priya", last "Shah". A starting point only. */
export function draftFromName(name: string | undefined): Pick<FamilyDraft, "firstName" | "lastName"> {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { firstName: "", lastName: "" };
  if (words.length === 1) return { firstName: words[0], lastName: "" };
  return { firstName: words.slice(0, -1).join(" "), lastName: words[words.length - 1] };
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Drawn only while `open`; each opening is a new mount, so the sheet always starts fresh. */
export function AddFamilySheet(props: AddFamilySheetProps) {
  if (!props.open) return null;
  return <OpenSheet {...props} />;
}

function OpenSheet({ onClose, onAdded, onOpenFamily, initialName, canAdd = true, actions = DEFAULT_ACTIONS }: AddFamilySheetProps) {
  const router = useRouter();
  const titleId = useId();
  const firstId = useId();
  const lastId = useId();
  const contactId = useId();
  const streetId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const seq = useRef(0);

  const [draft, setDraft] = useState<FamilyDraft>(() => ({ ...draftFromName(initialName), contact: "", street: "" }));
  const [check, setCheck] = useState<Check>(IDLE);
  const [awaitingNone, setAwaitingNone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => first.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  const runCheck = useCallback(
    async (d: FamilyDraft) => {
      const mine = ++seq.current;
      setCheck({ state: "checking" });
      const r = await actions.check(d);
      if (mine !== seq.current) return;
      if (r.ok && r.data) setCheck({ state: "ready", view: r.data });
      else if (!r.ok && isRefusal(r.error)) {
        setRefused(true);
        setCheck(IDLE);
      } else setCheck({ state: "error", error: r.ok ? "Could not check for families that may already be here." : r.error });
    },
    [actions],
  );

  // "Already here?": look while the person types, once there is a last name or a whole mobile or email.
  const checkable = canAdd && !refused && canCheckForMatches(draft);
  useEffect(() => {
    // Whatever was typed, an answer to an older version of it is not wanted any more.
    seq.current += 1;
    if (!checkable) return;
    const t = window.setTimeout(() => void runCheck(draft), 300);
    return () => window.clearTimeout(t);
    // The check depends on the three typed fields, not on the street.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkable, draft.firstName, draft.lastName, draft.contact, runCheck]);

  const shown: Check = checkable ? check : IDLE;
  const matches = shown.state === "ready" ? shown.view : null;
  const hasMatches = !!matches && matches.matches.length > 0;

  function change(patch: Partial<FamilyDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setProblem(null);
    // What was typed changed, so what the person agreed to ("none of these") no longer applies.
    setAwaitingNone(false);
  }

  function openFamily(householdId: string) {
    if (onOpenFamily) onOpenFamily(householdId);
    else {
      router.push(`/households/${householdId}`);
      onClose();
    }
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (saving) return;
    const p = familyDraftProblem(draft);
    if (p) {
      setProblem(p);
      return;
    }
    // Possible matches are on the screen and the person has not yet said "none of these": ask once, create nothing.
    if (hasMatches && !awaitingNone) {
      setAwaitingNone(true);
      window.setTimeout(() => confirmButton.current?.focus(), 0);
      return;
    }
    setSaving(true);
    setProblem(null);
    const c = parseContact(draft.contact);
    const fd = new FormData();
    fd.set("first_name", draft.firstName.trim());
    fd.set("last_name", draft.lastName.trim());
    if (c.mobile) fd.set("mobile", c.mobile);
    if (c.email) fd.set("email", c.email);
    if (draft.street.trim()) fd.set("street", draft.street.trim());
    if (awaitingNone) fd.set("none_of_these", "yes");
    let r: ActionResult<AddFamilyAnswer>;
    try {
      r = await actions.add(null, fd);
    } catch {
      r = { ok: false, error: "Could not add the family — the connection was lost. Nothing was added. Try again." };
    }
    setSaving(false);
    if (!r.ok) {
      if (isRefusal(r.error)) setRefused(true);
      else setProblem(r.error);
      return;
    }
    const data = r.data;
    if (data?.created) {
      if (onAdded) onAdded({ householdId: data.householdId, personId: data.personId, householdNumber: data.householdNumber });
      else {
        router.push(`/households/${data.householdId}`);
        onClose();
      }
      return;
    }
    // Families that may already be this one turned up on the server: show them and ask once.
    if (data && !data.created) {
      seq.current += 1;
      setCheck({ state: "ready", view: { total: data.total, matches: data.matches } });
      setAwaitingNone(true);
      window.setTimeout(() => confirmButton.current?.focus(), 0);
      return;
    }
    setProblem("Could not add the family — the answer was empty. Nothing was added. Try again.");
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && !saving) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) return;
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  }

  const noAccess = !canAdd || refused;
  const label = "mb-1 block text-[12px] font-extrabold uppercase tracking-[0.04em] text-muted";
  const contactState = parseContact(draft.contact);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(18,32,58,0.45)] sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="add-family-sheet"
        onKeyDown={onKeyDown}
        className="max-h-[94vh] w-full overflow-y-auto rounded-t-[22px] bg-white px-5 pb-5 pt-5 shadow-[0_24px_60px_rgba(18,32,58,0.28)] sm:max-w-[540px] sm:rounded-[22px] sm:px-6"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="m-0 font-display text-[24px] font-semibold leading-tight text-ink">
            Add a family
          </h2>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" title="Close" className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[22px] leading-none text-muted hover:bg-canvas">
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {noAccess ? (
          <div role="alert" className="mt-4 rounded-[14px] border border-line bg-canvas px-4 py-4">
            <p className="m-0 font-display text-[18px] font-semibold text-ink">{NO_ACCESS}</p>
            <p className="m-0 mt-1 text-[14px] text-muted">Adding a family needs permission to manage people. Ask an administrator who can, or ask them to add this family for you.</p>
            <div className="mt-3">
              <button type="button" onClick={onClose} className={buttonClass("ghost")}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <p className="m-0 mt-1 text-[14px] text-muted">Start with the first adult. Everyone else is added from the family&apos;s page.</p>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={firstId} className={label}>
                  First name
                </label>
                <input ref={first} id={firstId} name="first_name" value={draft.firstName} onChange={(e) => change({ firstName: e.target.value })} autoComplete="off" maxLength={200} className="crm-input w-full" />
              </div>
              <div>
                <label htmlFor={lastId} className={label}>
                  Last name
                </label>
                <input id={lastId} name="last_name" value={draft.lastName} onChange={(e) => change({ lastName: e.target.value })} autoComplete="off" maxLength={200} className="crm-input w-full" />
              </div>
            </div>
            <div className="mt-3">
              <label htmlFor={contactId} className={label}>
                Mobile or email
              </label>
              <input
                id={contactId}
                name="contact"
                value={draft.contact}
                onChange={(e) => change({ contact: e.target.value })}
                autoComplete="off"
                inputMode="email"
                placeholder="(713) 555-0142 or name@example.org"
                aria-describedby={`${contactId}-hint`}
                className="crm-input w-full"
              />
              <p id={`${contactId}-hint`} className="m-0 mt-1 text-[12px] text-muted">
                {contactState.mobile ? `Mobile ${contactState.mobile}` : contactState.email ? `Email ${contactState.email}` : "Optional. With one of them, a family already here is easier to spot."}
              </p>
            </div>
            <div className="mt-3">
              <label htmlFor={streetId} className={label}>
                Street (optional)
              </label>
              <input id={streetId} name="street" value={draft.street} onChange={(e) => change({ street: e.target.value })} autoComplete="off" maxLength={300} className="crm-input w-full" />
            </div>

            <div className="mt-4" aria-live="polite" data-testid="add-family-matches">
              {shown.state === "checking" ? <p className="m-0 text-[13px] text-muted">Looking for a family already here…</p> : null}
              {shown.state === "error" ? (
                <div role="alert" className="rounded-[12px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
                  {shown.error}{" "}
                  <button type="button" onClick={() => void runCheck(draft)} className="font-bold underline">
                    Try again
                  </button>
                </div>
              ) : null}
              {matches ? <MatchesPanel view={matches} onOpen={openFamily} confirming={awaitingNone} /> : null}
            </div>

            {problem ? (
              <p role="alert" className="m-0 mt-3 rounded-[12px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
                {problem}
              </p>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button ref={confirmButton} type="submit" disabled={saving} className={buttonClass("primary")}>
                {saving ? "Adding…" : awaitingNone ? "None of these — add a new family" : "Add family"}
              </button>
              <button type="button" onClick={onClose} disabled={saving} className={buttonClass("ghost")}>
                Cancel
              </button>
              <span className="text-[12px] text-muted">{awaitingNone ? "Enter adds it as a new family." : hasMatches ? "Enter asks once more before adding." : "Enter adds. Asks for nothing else."}</span>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function MatchesPanel({ view, onOpen, confirming }: { view: FamilyMatchesView; onOpen: (householdId: string) => void; confirming: boolean }) {
  if (view.matches.length === 0) {
    return view.total > 0 ? (
      <p className="m-0 rounded-[12px] border border-line bg-canvas px-3 py-2 text-[13px] text-muted">
        {matchesHeading(view.total)} You do not have access to open {view.total === 1 ? "it" : "them"}, so check with someone who does before adding.
      </p>
    ) : (
      <p className="m-0 text-[13px] font-semibold text-[var(--v2-green-ink,#0f4f33)]">No family like this yet.</p>
    );
  }
  const strong = view.matches.filter(isStrongMatch);
  const ordered = [...strong, ...view.matches.filter((m) => !isStrongMatch(m))];
  const more = Math.max(0, view.total - view.matches.length);
  return (
    <section aria-label="Already here?" className={`rounded-[14px] border px-3 py-3 ${confirming ? "border-navy bg-navy-50" : "border-line bg-canvas"}`}>
      <h3 className="m-0 font-display text-[16px] font-semibold text-ink">Already here?</h3>
      <p className="m-0 mt-0.5 text-[13px] text-muted">{matchesHeading(view.total)} Open it, or carry on if none of these is the family.</p>
      <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
        {ordered.map((m) => (
          <li key={m.householdId} className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-white px-3 py-2">
            <MatchCard m={m} />
            <button type="button" onClick={() => onOpen(m.householdId)} className={`${buttonClass("ghost", "sm")} ml-auto`} aria-label={`Open ${m.adults.slice(0, 2).join(" and ") || "this family"}${m.householdNumber ? `, household ${m.householdNumber}` : ""}`}>
              Open it
            </button>
          </li>
        ))}
      </ul>
      {more > 0 ? <p className="m-0 mt-2 text-[12px] text-muted">and {more} more with a similar name.</p> : null}
    </section>
  );
}

/** The household card line: never a name alone: number, the community's own ID, adults, city. */
function MatchCard({ m }: { m: FamilyMatchView }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="m-0 text-[14px] font-bold text-ink">{m.adults.length ? m.adults.slice(0, 3).join(" & ") : "A family"}</p>
      <p className="m-0 text-[12px] text-muted">
        {[m.householdNumber ? `No. ${m.householdNumber}` : null, m.orgHouseholdId, m.city, m.zone].filter(Boolean).join(" · ") || "No other details on file"}
      </p>
      <p className="m-0 mt-1 flex flex-wrap gap-1">
        {m.reasons.map((r) => (
          <span key={r} className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${r === "last_name" ? "border-line bg-canvas text-muted" : "border-navy-300 bg-navy-50 text-[#164690]"}`}>
            {FAMILY_MATCH_LABELS[r]}
          </span>
        ))}
      </p>
    </div>
  );
}
