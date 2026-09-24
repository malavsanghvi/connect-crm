import { ActionForm } from "@/components/action-form";
import type { Tables } from "@/lib/database.types";
import { centsToDollarsInput, toDateTimeLocal } from "@/lib/pathshala/format";

import { saveTerm } from "../actions";
import { Checkbox, FormGrid, PField, Select } from "../ui";

export function TermForm({ term, tz, cols = 2 }: { term: Tables<"pathshala_terms"> | null; tz: string; cols?: 1 | 2 }) {
  return (
    <ActionForm buttonsClassName="mt-3"
      action={saveTerm.bind(null, term?.id ?? null)}
      submitLabel={term ? "Save term" : "Create term"}
      resetOnSuccess={!term}
      variant="primary"
    >
      <FormGrid cols={cols}>
        <PField label="Term name" hint="For example 2026-2027">
          <input name="name" required defaultValue={term?.name ?? ""} className="crm-input" />
        </PField>
        <PField label="Status">
          <Select
            name="status"
            defaultValue={term?.status ?? "draft"}
            options={[
              { value: "draft", label: "Draft (hidden from families)" },
              { value: "registration", label: "Registration open" },
              { value: "active", label: "Active (classes running)" },
              { value: "closed", label: "Closed" },
            ]}
          />
        </PField>
        <PField label="First day">
          <input type="date" name="starts_on" required defaultValue={term?.starts_on ?? ""} className="crm-input" />
        </PField>
        <PField label="Last day">
          <input type="date" name="ends_on" required defaultValue={term?.ends_on ?? ""} className="crm-input" />
        </PField>
        <PField label="Registration opens">
          <input type="datetime-local" name="registration_opens_at" defaultValue={toDateTimeLocal(term?.registration_opens_at, tz)} className="crm-input" />
        </PField>
        <PField label="Registration closes">
          <input type="datetime-local" name="registration_closes_at" defaultValue={toDateTimeLocal(term?.registration_closes_at, tz)} className="crm-input" />
        </PField>
        <PField label="Fee per child ($)" hint="Billed per child as a pledge">
          <input name="fee_per_child" inputMode="decimal" defaultValue={centsToDollarsInput(term?.fee_per_child_cents ?? 0)} className="crm-input" />
        </PField>
        <PField label="Family cap ($)" hint="Leave blank for no cap">
          <input name="fee_family_cap" inputMode="decimal" defaultValue={centsToDollarsInput(term?.fee_per_family_cap_cents)} className="crm-input" />
        </PField>
        <PField label="Sibling discount (%)">
          <input name="sibling_discount_pct" type="number" min={0} max={100} defaultValue={term?.sibling_discount_pct ?? 0} className="crm-input" />
        </PField>
        <PField label="No-class dates" hint="One date per line (YYYY-MM-DD). Dates outside the term are ignored.">
          <textarea name="no_class_dates" rows={4} defaultValue={(term?.no_class_dates ?? []).join("\n")} className="crm-input font-mono" />
        </PField>
      </FormGrid>
      <Checkbox name="membership_required" label="Membership required to register" defaultChecked={term?.membership_required ?? true} />
    </ActionForm>
  );
}
