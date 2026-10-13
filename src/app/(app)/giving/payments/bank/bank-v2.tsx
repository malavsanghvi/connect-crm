import { ActionForm } from "@/components/action-form";
import { BankTab } from "@/components/giving-bank/bank-tab";
import { loadBankTab } from "@/lib/data/giving-bank";
import type { RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { createBankAccountAction } from "./actions";
import { BankImport } from "./bank-import";

/**
 * Giving › Bank in the New look (docs/GIVING_REDESIGN.md section 4, slice 4). The importer inside the Import sheet is today's
 * statement importer; a community with no bank account yet adds one here, with the existing action.
 */
export async function BankV2({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const model = await loadBankTab(session, await searchParams);
  const account = model.account;
  return (
    <BankTab
      model={model}
      importer={
        account ? <BankImport bankAccountId={account.id} accountName={account.name} expectedFormat={account.statementFormat} currency={model.currency} /> : null
      }
      noAccount={<NewAccountForm />}
    />
  );
}

function NewAccountForm() {
  return (
    <ActionForm action={createBankAccountAction} submitLabel="Add bank account" pendingLabel="Adding…" resetOnSuccess>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ba-name" className="crm-label">
            Name
          </label>
          <input id="ba-name" name="name" required placeholder="Operating account" className="crm-input" />
        </div>
        <div>
          <label htmlFor="ba-inst" className="crm-label">
            Bank
          </label>
          <input id="ba-inst" name="institution" className="crm-input" />
        </div>
        <div>
          <label htmlFor="ba-last4" className="crm-label">
            Last 4 digits
          </label>
          <input id="ba-last4" name="last4" inputMode="numeric" maxLength={4} className="crm-input" />
        </div>
        <div>
          <label htmlFor="ba-format" className="crm-label">
            Statement format
          </label>
          <select id="ba-format" name="statement_format" defaultValue="generic_csv" className="crm-input">
            <option value="generic_csv">CSV with date, amount and description</option>
            <option value="chase_csv">Chase CSV</option>
          </select>
        </div>
      </div>
    </ActionForm>
  );
}
