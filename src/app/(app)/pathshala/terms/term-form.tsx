import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import type { Tables } from "@/lib/database.types";
import { toDateTimeLocal } from "@/lib/pathshala/format";

import { saveTerm } from "../actions";
import { Checkbox, FormGrid, PField, Select } from "../ui";

/**
 * A term's dates, registration window, membership rule and no-class days. Its fees and registration rules are on the
 * term's Fees and rules page (PATHSHALA_REGISTRATION_PLAN §3.3): a fee per level, the sibling discount, the family cap,
 * the late fee and how families pay. A draft leaves Draft only through "Open registration" there, after its checks.
 */
export function TermForm({ term, tz, cols = 2 }: { term: Tables<"pathshala_terms"> | null; tz: string; cols?: 1 | 2 }) {
  const draft = !term || term.status === "draft";
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
        {draft ? (
          <PField
            label="Status"
            hint={
              term ? (
                <>
                  Families cannot see a draft. Open registration on the term&apos;s{" "}
                  <Link className="crm-link" href={`/pathshala/terms/${term.id}/fees`}>
                    Fees and rules
                  </Link>{" "}
                  page once every level with a class has its fee.
                </>
              ) : (
                "A new term starts as a draft that families cannot see. Set its fees and open registration on its Fees and rules page."
              )
            }
          >
            <span className="crm-input block bg-canvas text-muted">Draft (hidden from families)</span>
          </PField>
        ) : (
          <PField label="Status">
            <Select
              name="status"
              defaultValue={term.status}
              options={[
                { value: "registration", label: "Registration open" },
                { value: "active", label: "Active (classes running)" },
                { value: "closed", label: "Closed" },
              ]}
            />
          </PField>
        )}
        <PField label="First day">
          <input type="date" name="starts_on" required defaultValue={term?.starts_on ?? ""} className="crm-input" />
        </PField>
        <PField label="Last day">
          <input type="date" name="ends_on" required defaultValue={term?.ends_on ?? ""} className="crm-input" />
        </PField>
        <PField label="Registration opens">
          <input type="datetime-local" name="registration_opens_at" defaultValue={toDateTimeLocal(term?.registration_opens_at, tz)} className="crm-input" />
        </PField>
        <PField label="Registration closes" hint="A late registration window, with its late fee, is set on the Fees and rules page.">
          <input type="datetime-local" name="registration_closes_at" defaultValue={toDateTimeLocal(term?.registration_closes_at, tz)} className="crm-input" />
        </PField>
        <PField label="No-class dates" hint="One date per line (YYYY-MM-DD). Dates outside the term are ignored.">
          <textarea name="no_class_dates" rows={4} defaultValue={(term?.no_class_dates ?? []).join("\n")} className="crm-input font-mono" />
        </PField>
      </FormGrid>
      <Checkbox name="membership_required" label="Membership required to register" defaultChecked={term?.membership_required ?? true} />
      <p className="crm-hint">
        Fees are set per level on the term&apos;s Fees and rules page{term ? "" : ", once the term is created"}: the fee for each level, the sibling
        discount, the family cap, the late fee, and whether families pay when they register or later.
      </p>
    </ActionForm>
  );
}
