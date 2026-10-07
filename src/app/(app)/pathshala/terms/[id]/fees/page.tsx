import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ActionForm } from "@/components/action-form";
import { Badge, Card } from "@/components/ui";
import { isPermissionError } from "@/lib/access-db";
import { loadClasses, loadTerms } from "@/lib/data/pathshala";
import { explainError } from "@/lib/errors";
import { isModuleEnabled } from "@/lib/modules";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { formatDate, formatDateTime, toDateTimeLocal } from "@/lib/pathshala/format";
import { load, resolveUserNames, row, rows, viewerOf } from "@/lib/pathshala/server";
import { loadLevelFees, loadLevelRows, loadPayNowReady, loadSeats, loadTermRules, NEEDS_UPDATE, type Loaded } from "@/lib/pathshala-registration/db";
import {
  bandCell,
  buildFeeGroups,
  lockedSentence,
  missingFeeNames,
  openChecklist,
  seatsLabel,
  unpricedOfferedSentence,
  type CheckItem,
} from "@/lib/pathshala-registration/fees";
import { feeLabel, formatMoney } from "@/lib/pathshala-registration/money";
import { PAYMENT_MODE_LABEL, SEAT_RULE_LABEL, feeEditing, payNowBlockedReason, paymentModeSentence, termStatusLabel } from "@/lib/pathshala-registration/rules";
import { isUuid } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { LoadProblem, LoadProblemPage, Notice, PathshalaHeader, PDefinitionList, PNoAccessPage } from "../../../ui";
import { openRegistrationAction, saveFeesAction, saveRulesAction, tryFamilyAction } from "./actions";
import { FeesEditor, type FeeEditorGroup } from "./fees-editor";
import { RulesForm } from "./rules-form";
import { TryFamily, type ExampleLevel } from "./try-family";

export const metadata: Metadata = { title: "Fees and rules" };

const AREA = "Pathshala fees (pathshala.view, pathshala.manage or giving.manage)";
const DRAFT_IS_PRINCIPALS =
  "This term is not open for registration yet: while it is a draft its fees are the Pathshala principal's (pathshala.view or pathshala.manage). The treasurer sees it here once registration opens.";

/** Why a 0590 read did not give rows, for the page: null when it did. */
function problemOf(what: string, r: Loaded<unknown>): string | null {
  if (r.status === "ok" || r.status === "missing") return null;
  if (r.status === "shape") return `Could not read ${what} — the database answered with something this screen cannot read (${r.message}). Has the latest migration been applied?`;
  return `Could not load ${what} — ${explainError(r.error)}.`;
}

const CHECK_TONE: Record<CheckItem["tone"], { badge: "danger" | "warning" | "success" | "navy"; word: string }> = {
  bad: { badge: "danger", word: "Missing" },
  warn: { badge: "warning", word: "Check" },
  ok: { badge: "success", word: "Ready" },
  info: { badge: "navy", word: "Note" },
};

/**
 * Pathshala › Terms › a term › Fees and rules (PATHSHALA_REGISTRATION_PLAN §2.2–§2.7, §3.3, P9, P15–P22): an explicit
 * fee for every level with a class this term, the registration rules, "Try a family", and "Open registration", which
 * the database refuses while a fee is missing (naming the levels). The principal sets everything while the term is a
 * draft; after it opens only the treasurer changes it, with a reason, for new registrations only.
 */
export default async function TermFeesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = viewerOf(await getSession());
  if (!pathshalaAreas.fees(v)) return <PNoAccessPage area={AREA} />;
  if (!isUuid(id)) notFound();
  const { db, center } = v;
  const tz = center.time_zone;
  const currency = center.currency;
  const givingOn = isModuleEnabled(v, "giving");
  const retryHref = `/pathshala/terms/${id}/fees`;

  const res = await load(async () => {
    const term = row(await db.from("pathshala_terms").select("*").eq("id", id).maybeSingle(), "the term");
    if (!term) return null;
    const [terms, tracks, classes, rules, levels, fees, seats, ready, funds] = await Promise.all([
      loadTerms(db, center.id),
      db.from("pathshala_tracks").select("id, key, name").eq("center_id", center.id).then((r) => rows(r, "Pathshala tracks")),
      loadClasses(db, center.id, term.id),
      loadTermRules(db, [term.id]),
      loadLevelRows(db, center.id),
      loadLevelFees(db, center.id),
      loadSeats(db, term.id),
      loadPayNowReady(db, center.id),
      // The funds only fill the fund picker: when they cannot be read, the picker says so and the page still works.
      givingOn
        ? db
            .from("funds")
            .select("id, name")
            .eq("center_id", center.id)
            .eq("active", true)
            .order("name")
            .then((r) => {
              if (r.error) console.error("[pathshala/fees] could not read the funds for the picker:", r.error);
              return r.error ? null : (r.data ?? []);
            })
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);
    return { term, terms, tracks, classes, rules, levels, fees, seats, ready, funds };
  });
  if (!res.ok) return <LoadProblemPage message={res.error} retryHref={retryHref} />;
  if (!res.data) {
    // The treasurer reads a term once registration opens; a draft is the principal's (RLS shows them nothing).
    if (!pathshalaAreas.admin(v)) return <PNoAccessPage area={AREA}>{DRAFT_IS_PRINCIPALS}</PNoAccessPage>;
    notFound();
  }
  const { term, terms, tracks, classes, rules, levels, fees, seats, ready, funds } = res.data;

  const header = (
    <PathshalaHeader
      title={`${term.name} · Fees and rules`}
      description={`Pathshala term · ${termStatusLabel(term.status)} · a fee for every level with a class, and how families register and pay`}
      back={{ href: `/pathshala/terms/${term.id}`, label: term.name }}
    />
  );

  // A database without 0590: say so plainly, never an empty table.
  if (rules.status === "missing" || levels.status === "missing" || fees.status === "missing") {
    return (
      <>
        {header}
        <Notice tone="warning">
          {NEEDS_UPDATE} Until it is applied, fees per level, how families pay and opening registration from here are not available, and nothing is
          billed.
        </Notice>
      </>
    );
  }
  for (const r of [rules, levels, fees]) {
    if (r.status === "error" && isPermissionError(r.error)) return <PNoAccessPage area={AREA} />;
  }
  const problem = problemOf("the term's rules", rules) ?? problemOf("the levels", levels) ?? problemOf("the fees", fees);
  if (problem || rules.status !== "ok" || levels.status !== "ok" || fees.status !== "ok") {
    return (
      <>
        {header}
        <LoadProblem message={problem ?? "Could not load this page."} retryHref={retryHref} />
      </>
    );
  }
  const termRules = rules.value.get(term.id);
  if (!termRules) return <LoadProblemPage message="Could not load the term's rules — the term was not found among them. Reload the page." retryHref={retryHref} />;

  const editing = feeEditing(v, { status: term.status, fees_locked_at: termRules.fees_locked_at });
  const groups = buildFeeGroups({
    term,
    terms,
    tracks,
    levels: levels.value,
    classes,
    fees: fees.value,
    seats: seats.status === "ok" ? seats.value : null,
  });
  const seatsProblem = seats.status === "ok" ? null : seats.status === "missing" ? "Seats need the database update that is on its way." : problemOf("the seats", seats);
  const payNowBlocked = payNowBlockedReason({
    givingOn,
    ready:
      ready.status === "ok"
        ? { status: "ok", sentence: ready.value }
        : ready.status === "missing"
          ? { status: "missing" }
          : { status: "error", reason: ready.status === "shape" ? `the answer could not be read (${ready.message})` : explainError(ready.error) },
  });
  const missing = missingFeeNames(groups);
  const lockedBy = termRules.fees_locked_by ? (await resolveUserNames(db, center.id, [termRules.fees_locked_by])).get(termRules.fees_locked_by) ?? null : null;

  const editorGroups: FeeEditorGroup[] = groups.map((g) => ({
    trackId: g.track.id,
    trackName: g.track.name,
    rows: g.rows.map((r) => ({
      levelId: r.level.id,
      name: r.level.name,
      band: bandCell(r.level),
      offered: r.offered,
      classes: r.classes,
      retired: !r.level.active,
      saved: r.saved,
      suggestion: r.suggestion,
      seats: seatsLabel(r.seats),
    })),
  }));
  const exampleLevels: ExampleLevel[] = groups.flatMap((g) =>
    g.rows
      .filter((r) => r.level.active)
      .map((r) => ({ id: r.level.id, name: r.level.name, label: `${r.level.name} · ${r.saved !== null ? feeLabel(r.saved, currency) : "no fee yet"}` })),
  );
  const startsOnLabel = formatDate(term.starts_on, tz);

  return (
    <>
      {header}
      <div className="mb-4">
        <Notice tone="navy">{editing.note}</Notice>
      </div>

      {editing.open ? (
        <Card title="Registration is open" className="mb-4">
          <div className="flex flex-col gap-2 text-[13px]">
            <p>{lockedSentence(termRules.fees_locked_at, lockedBy, tz) ?? "This term was opened before fees per level existed, so its fees and rules were not locked when it opened; they are the treasurer's to change now."}</p>
            {missing.length ? <p className="font-bold text-danger">{unpricedOfferedSentence(missing, term.name)}</p> : null}
            {termRules.payment_mode === "pay_now" && payNowBlocked ? (
              <p className="font-bold text-danger">Families pay when registering in this term, but that cannot be used right now: {payNowBlocked}</p>
            ) : null}
          </div>
        </Card>
      ) : (
        <OpenCard
          items={openChecklist({
            groups,
            paymentMode: termRules.payment_mode,
            payNowBlocked,
            givingOn,
            membershipRequired: term.membership_required,
            registrationOpensAt: term.registration_opens_at,
            registrationClosesAt: term.registration_closes_at,
            tz,
          })}
          canOpen={editing.canOpen}
          termId={term.id}
          termName={term.name}
          termHref={`/pathshala/terms/${term.id}`}
        />
      )}

      <Card
        title="Fees per level"
        description="A fee for every level with a class this term ($0 is Free). Tick levels to give them one fee at once."
        className="mb-4"
      >
        {editorGroups.length === 0 ? (
          <p className="text-[13px] text-muted">
            No levels yet. Add them in{" "}
            <Link className="crm-link" href="/pathshala/levels">
              Pathshala › Levels
            </Link>
            , then their classes in{" "}
            <Link className="crm-link" href={`/pathshala?term=${term.id}`}>
              Classes
            </Link>
            .
          </p>
        ) : (
          <FeesEditor groups={editorGroups} action={saveFeesAction.bind(null, term.id)} canEdit={editing.canEdit} needsReason={editing.needsReason} currency={currency} />
        )}
        {seatsProblem ? <p className="mt-2 text-xs text-brown">The seats could not be counted, so they show as “—”. {seatsProblem}</p> : null}
      </Card>

      <Card title="Registration rules" description="How families pay, seats, the sibling discount and family cap, the late window and the deadlines." className="mb-4">
        {editing.canEdit ? (
          <RulesForm
            values={{
              payment_mode: termRules.payment_mode,
              hold_hours: termRules.hold_hours,
              office_payment_allowed: termRules.office_payment_allowed,
              office_hold_days: termRules.office_hold_days,
              seat_rule: termRules.seat_rule,
              sibling_discount_pct: term.sibling_discount_pct,
              fee_per_family_cap_cents: term.fee_per_family_cap_cents,
              late_registration_closes_local: toDateTimeLocal(termRules.late_registration_closes_at, tz),
              late_fee_cents: termRules.late_fee_cents,
              withdrawal_credit_until: termRules.withdrawal_credit_until,
              age_cutoff_on: termRules.age_cutoff_on,
              fund_id: termRules.fund_id,
            }}
            action={saveRulesAction.bind(null, term.id)}
            needsReason={editing.needsReason}
            payNowBlocked={payNowBlocked}
            givingOn={givingOn}
            funds={funds}
            startsOnLabel={startsOnLabel}
            registrationClosesLabel={term.registration_closes_at ? formatDateTime(term.registration_closes_at, tz) : null}
          />
        ) : (
          <PDefinitionList
            items={rulesSummary({
              mode: termRules.payment_mode,
              payNowBlocked,
              hold: termRules.hold_hours,
              office: termRules.office_payment_allowed,
              officeDays: termRules.office_hold_days,
              seat: termRules.seat_rule,
              sibling: term.sibling_discount_pct,
              cap: term.fee_per_family_cap_cents,
              closes: term.registration_closes_at,
              late: termRules.late_registration_closes_at,
              lateFee: termRules.late_fee_cents,
              withdrawal: termRules.withdrawal_credit_until,
              cutoff: termRules.age_cutoff_on,
              startsOnLabel,
              tz,
              currency,
            })}
          />
        )}
      </Card>

      {pathshalaAreas.admin(v) ? (
        <Card title="Try a family" description="What a family would pay with this term's fees and rules, priced as a registration would be. Nothing is saved or billed.">
          {exampleLevels.length ? (
            <TryFamily action={tryFamilyAction.bind(null, term.id)} levels={exampleLevels} cutoffLabel={termRules.age_cutoff_on ? formatDate(termRules.age_cutoff_on, tz) : startsOnLabel} currency={currency} />
          ) : (
            <p className="text-[13px] text-muted">Add levels first; then try a family here.</p>
          )}
        </Card>
      ) : null}
    </>
  );
}

function OpenCard({ items, canOpen, termId, termName, termHref }: { items: CheckItem[]; canOpen: boolean; termId: string; termName: string; termHref: string }) {
  const refused = items.some((i) => i.tone === "bad");
  return (
    <Card title="Open registration" description="What opening still waits for. Opening locks the fees and rules, and families can register." className="mb-4">
      <ul className="flex flex-col gap-1.5 text-[13px]">
        {items.map((item) => (
          <li key={item.text} className="flex items-start gap-2">
            <span className="w-16 shrink-0">
              <Badge tone={CHECK_TONE[item.tone].badge}>{CHECK_TONE[item.tone].word}</Badge>
            </span>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
      {canOpen ? (
        <ActionForm
          action={openRegistrationAction.bind(null, termId)}
          submitLabel="Open registration"
          pendingLabel="Opening…"
          variant="ok"
          className="mt-3"
          confirmMessage={`Open registration for ${termName}? Families can register from the term's opening date, and its fees and rules lock: after this only the treasurer can change them, with a reason, and a change applies to new registrations only.`}
        >
          {refused ? <p className="mb-2 text-xs text-muted">The database will refuse while anything above is missing, and say what.</p> : null}
        </ActionForm>
      ) : (
        <p className="mt-3 text-xs text-muted">
          Only the Pathshala principal (pathshala.manage) opens registration. The term&apos;s dates are on its{" "}
          <Link className="crm-link" href={termHref}>
            page
          </Link>
          .
        </p>
      )}
    </Card>
  );
}

/** The rules in words, for people who may read but not change them now. */
function rulesSummary(r: {
  mode: "pledge" | "pay_now";
  payNowBlocked: string | null;
  hold: number;
  office: boolean;
  officeDays: number;
  seat: "automatic" | "office";
  sibling: number;
  cap: number | null;
  closes: string | null;
  late: string | null;
  lateFee: number;
  withdrawal: string | null;
  cutoff: string | null;
  startsOnLabel: string;
  tz: string;
  currency: string;
}): [string, ReactNode][] {
  return [
    [
      "How families pay",
      <>
        <span className="font-bold">{PAYMENT_MODE_LABEL[r.mode]}</span>
        <span className="block text-xs text-muted">{paymentModeSentence(r.mode, { hold_hours: r.hold, office_payment_allowed: r.office, office_hold_days: r.officeDays })}</span>
        {r.mode === "pay_now" && r.payNowBlocked ? <span className="block text-xs font-bold text-brown">Cannot be used yet: {r.payNowBlocked}</span> : null}
      </>,
    ],
    ["Seats", SEAT_RULE_LABEL[r.seat]],
    ["Sibling discount", `${r.sibling}% for every child after the first`],
    ["Family cap", r.cap === null ? "No cap" : `${formatMoney(r.cap, r.currency)} for a family's children`],
    ["Registration closes", r.closes ? formatDateTime(r.closes, r.tz) : "No closing date"],
    ["Late registration", r.late ? `Until ${formatDateTime(r.late, r.tz)} · late fee ${formatMoney(r.lateFee, r.currency)} per learner` : "No late window"],
    ["Withdrawal deadline", r.withdrawal ? formatDate(r.withdrawal, r.tz) : "14 days after the first class day"],
    ["Age cut-off", r.cutoff ? formatDate(r.cutoff, r.tz) : `The first day of term (${r.startsOnLabel})`],
  ];
}
