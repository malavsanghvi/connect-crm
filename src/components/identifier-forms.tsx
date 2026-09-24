"use client";

import { useState } from "react";

import { addIdentifierAction, retireIdentifierAction } from "@/app/(app)/identifiers/actions";
import { ActionForm } from "@/components/action-form";
import { identifierTarget, padOrgId, type SystemOption } from "@/lib/identifiers";

export type KindOption = { kind: string; label: string; systems: SystemOption[]; hint?: string };
export type TargetOption = { value: string; label: string; type: "household" | "person" };

export function AddIdentifierForm({
  kinds,
  targets,
  returnPath,
  orgMemberDigits,
  orgHouseholdDigits,
}: {
  kinds: KindOption[];
  targets: TargetOption[];
  returnPath: string;
  orgMemberDigits: number | null;
  orgHouseholdDigits: number | null;
}) {
  const [kind, setKind] = useState(kinds[0]?.kind ?? "");
  const current = kinds.find((k) => k.kind === kind);
  const [system, setSystem] = useState(current?.systems[0]?.system ?? "");
  const [label, setLabel] = useState(current?.systems[0]?.label ?? "");
  const mustBe = identifierTarget(kind);
  const allowedTargets = targets.filter((t) => mustBe === "either" || t.type === mustBe);
  const digits = kind === "org_member" ? orgMemberDigits : kind === "org_household" ? orgHouseholdDigits : null;

  function chooseKind(next: string) {
    setKind(next);
    const k = kinds.find((x) => x.kind === next);
    setSystem(k?.systems[0]?.system ?? "");
    setLabel(k?.systems[0]?.label ?? "");
  }
  function chooseSystem(next: string) {
    setSystem(next);
    const known = current?.systems.find((s) => s.system === next);
    if (known?.label) setLabel(known.label);
  }

  if (kinds.length === 0) return null;
  return (
    <ActionForm action={addIdentifierAction} submitLabel="Add identifier" pendingLabel="Adding…" resetOnSuccess>
      <input type="hidden" name="returnPath" value={returnPath} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div>
          <label htmlFor="id-kind" className="crm-label">
            Kind
          </label>
          <select id="id-kind" name="kind" value={kind} onChange={(e) => chooseKind(e.target.value)} className="crm-input">
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
          {current?.hint ? <p className="crm-hint">{current.hint}</p> : null}
        </div>
        <div>
          <label htmlFor="id-target" className="crm-label">
            Belongs to
          </label>
          <select
            id="id-target"
            name="target"
            key={`target-${kind}`}
            className="crm-input"
            defaultValue={allowedTargets[0]?.value}
            disabled={allowedTargets.length === 0}
          >
            {allowedTargets.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {mustBe !== "either" ? (
            <p className="crm-hint">
              {current?.label} {mustBe === "person" ? "belongs to one person." : "belongs to the household, not a person."}
            </p>
          ) : null}
          {allowedTargets.length === 0 ? (
            <p className="crm-hint text-maroon">
              {mustBe === "person" ? "This household has no current members to attach it to." : "Add it from the household page."}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="id-value" className="crm-label">
            Value (exactly as the other system shows it)
          </label>
          <input id="id-value" name="value" required maxLength={200} className="crm-input font-mono" autoComplete="off" />
          {digits ? (
            <p className="crm-hint">
              Numbers are kept at {digits} digits with leading zeros: 417 is saved as {padOrgId("417", digits)}.
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="id-system" className="crm-label">
            System
          </label>
          {current && current.systems.length > 1 ? (
            <select
              id="id-system"
              name="system"
              value={system}
              onChange={(e) => chooseSystem(e.target.value)}
              className="crm-input"
            >
              {current.systems.map((s) => (
                <option key={s.system} value={s.system}>
                  {s.label ? `${s.label} — ${s.system}` : s.system}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="id-system"
              name="system"
              required
              value={system}
              onChange={(e) => chooseSystem(e.target.value)}
              className="crm-input"
              autoComplete="off"
            />
          )}
        </div>
        <div>
          <label htmlFor="id-label" className="crm-label">
            Label (optional)
          </label>
          <input
            id="id-label"
            name="label"
            maxLength={120}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Neon account id"
            className="crm-input"
          />
        </div>
        <div>
          <label htmlFor="id-notes" className="crm-label">
            Notes (optional)
          </label>
          <input id="id-notes" name="notes" maxLength={500} className="crm-input" />
        </div>
      </div>
      <div className="h-3" />
    </ActionForm>
  );
}

export function RetireIdentifierButton({ id, value, returnPath }: { id: string; value: string; returnPath: string }) {
  return (
    <ActionForm
      action={retireIdentifierAction}
      submitLabel="Retire"
      pendingLabel="Retiring…"
      variant="danger"
      size="sm"
      confirmMessage={`Retire "${value}"? It will stop matching from today but stays in the history.`}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="returnPath" value={returnPath} />
    </ActionForm>
  );
}
