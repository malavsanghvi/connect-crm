"use client";

import { Icon } from "@/components/brand/icons";
import { useState, type ReactNode } from "react";

import {
  ADD_FIELD_TEXT,
  CHILD_CUSTOM_NOTE,
  addFieldMode,
  rowsFor,
  type CustomEntity,
  type CustomFieldsPayload,
  type OkPayload,
} from "@/lib/people-v2/custom-fields";

import { LockIcon, Section } from "../slideover/section";

import { AddFieldSheet } from "./add-field-sheet";
import { CustomFieldsNote, useCustomFields } from "./custom-context";
import { CustomValueRow } from "./custom-row";
import { ManageSheet } from "./manage-sheet";

// The three places custom fields are drawn on the New look's People screens, one behaviour in all of them:
//   - PersonCustomGroup: a "Custom" group on each adult's card on the Family page (under Language)
//   - HouseholdCustomCard: "Custom details" in the right column
//   - CustomFieldsSection: "Custom fields" in the person slide-over, open by default, right under Profile
// Each shows the community's custom fields for people (or households) with click-to-edit values, an "Add a field" link (settings holders)
// or "Ask an admin" (everyone else who can read them), and, for settings holders, Manage (archive and restore). A role that cannot read
// custom fields sees "You don't have access to this area", never an empty group. Children (D2): their values are shown to authorised
// staff only, with a note, and are never part of anything given to the assistant.

type Sheet = null | "add" | "manage";

/** The two sheets and the buttons that open them, for one group. */
function useSheets(payload: OkPayload, entity: CustomEntity) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const mode = addFieldMode(payload.access);
  const sheets: ReactNode =
    sheet === "add" ? (
      <AddFieldSheet mode={mode} entity={entity} payload={payload} onClose={() => setSheet(null)} />
    ) : sheet === "manage" ? (
      <ManageSheet entity={entity} payload={payload} onClose={() => setSheet(null)} onAdd={() => setSheet("add")} />
    ) : null;
  const hasAny = payload[entity].active.length + payload[entity].archived.length > 0;
  return { mode, sheets, openAdd: () => setSheet("add"), openManage: () => setSheet("manage"), canManage: payload.access.canDefine && hasAny };
}

const LINK =
  "inline-flex min-h-10 items-center gap-1.5 rounded-lg px-1 text-[13.5px] font-bold text-[var(--v2-blue)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)] md:min-h-8";

function AddLink({ mode, onClick }: { mode: "add" | "ask"; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} data-testid="add-field-link" className={LINK}>
      {mode === "add" ? (
        <Icon name="plus" size={14} />
      ) : null}
      {ADD_FIELD_TEXT[mode]}
    </button>
  );
}

function ManageLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} data-testid="manage-fields-link" className={LINK}>
      Manage
    </button>
  );
}

function Rows({
  payload,
  entity,
  recordId,
  owner,
  path,
  wide,
}: {
  payload: OkPayload;
  entity: CustomEntity;
  recordId: string;
  owner: string;
  path: string;
  wide?: boolean;
}) {
  const rows = rowsFor(payload[entity].active, payload.values[recordId]);
  if (rows.length === 0) return <p className="m-0 py-1 text-[13.5px] text-muted">No custom fields yet.</p>;
  return (
    <div>
      {rows.map((r) => (
        <CustomValueRow key={r.key} row={r} entity={entity} recordId={recordId} owner={owner} canEdit={payload.access.canEdit} currency={payload.currency} path={path} wide={wide} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// On a person's card
// ---------------------------------------------------------------------------
export function PersonCustomGroup({ personId, firstName, path }: { personId: string; firstName: string; path: string }) {
  const payload = useCustomFields();
  if (!payload) return null;
  if (payload.state !== "ok") {
    return (
      <div className="mt-3 border-t border-line pt-3" data-testid="custom-group">
        <CustomFieldsNote payload={payload} />
      </div>
    );
  }
  return <PersonGroupBody payload={payload} personId={personId} firstName={firstName} path={path} />;
}

function PersonGroupBody({ payload, personId, firstName, path }: { payload: OkPayload; personId: string; firstName: string; path: string }) {
  const s = useSheets(payload, "people");
  return (
    <div className="mt-3 border-t border-line pt-3" data-testid="custom-group" role="group" aria-label={`Custom fields of ${firstName}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className="m-0 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted">Custom</h4>
        {s.canManage ? <ManageLink onClick={s.openManage} /> : null}
      </div>
      <Rows payload={payload} entity="people" recordId={personId} owner={firstName} path={path} />
      <AddLink mode={s.mode} onClick={s.openAdd} />
      {s.sheets}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The household's card
// ---------------------------------------------------------------------------
const CARD = "rounded-2xl border border-line bg-white p-[18px]";
const CARD_TITLE = "m-0 font-display text-[18px] font-semibold text-ink";

export function HouseholdCustomCard({ householdId, householdName, path }: { householdId: string; householdName: string; path: string }) {
  const payload = useCustomFields();
  if (!payload) return null;
  if (payload.state !== "ok") {
    return (
      <section aria-label="Custom details" className={CARD} data-testid="custom-details">
        <h2 className={`${CARD_TITLE} mb-2`}>Custom details</h2>
        <CustomFieldsNote payload={payload} />
      </section>
    );
  }
  return <HouseholdCardBody payload={payload} householdId={householdId} householdName={householdName} path={path} />;
}

function HouseholdCardBody({ payload, householdId, householdName, path }: { payload: OkPayload; householdId: string; householdName: string; path: string }) {
  const s = useSheets(payload, "households");
  return (
    <section aria-label="Custom details" className={CARD} data-testid="custom-details">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className={CARD_TITLE}>Custom details</h2>
        <span className="flex items-center gap-2">
          {payload.access.canEdit ? null : <span className="rounded-full bg-[var(--v2-ground)] px-2.5 py-0.5 text-[12px] font-semibold text-muted">View only</span>}
          {s.canManage ? <ManageLink onClick={s.openManage} /> : null}
        </span>
      </div>
      <Rows payload={payload} entity="households" recordId={householdId} owner={householdName} path={path} wide />
      <AddLink mode={s.mode} onClick={s.openAdd} />
      {s.sheets}
    </section>
  );
}

// ---------------------------------------------------------------------------
// In the person slide-over
// ---------------------------------------------------------------------------
export function CustomFieldsSection({
  payload,
  personId,
  firstName,
  isChild,
  path,
}: {
  payload: CustomFieldsPayload;
  personId: string;
  firstName: string;
  isChild: boolean;
  path: string;
}) {
  return (
    <Section id="custom_fields" title="Custom fields" open>
      {payload.state !== "ok" ? <CustomFieldsNote payload={payload} /> : <SectionBody payload={payload} personId={personId} firstName={firstName} isChild={isChild} path={path} />}
    </Section>
  );
}

function SectionBody({ payload, personId, firstName, isChild, path }: { payload: OkPayload; personId: string; firstName: string; isChild: boolean; path: string }) {
  const s = useSheets(payload, "people");
  return (
    <div data-testid="custom-fields-section">
      <Rows payload={payload} entity="people" recordId={personId} owner={firstName} path={path} wide />
      <div className="mt-1 flex flex-wrap items-center gap-x-4">
        <AddLink mode={s.mode} onClick={s.openAdd} />
        {s.canManage ? <ManageLink onClick={s.openManage} /> : null}
      </div>
      {isChild ? (
        <p className="m-0 mt-2 inline-flex items-center gap-1.5 text-[12.5px] text-muted" data-testid="child-custom-note">
          <LockIcon />
          {CHILD_CUSTOM_NOTE}
        </p>
      ) : null}
      {s.sheets}
    </div>
  );
}
