import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { Card, NoAccess, PageHeader, QueryError, TableWrap } from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { parseNumberingOverview } from "@/lib/setup";
import { rulesVersion } from "@/lib/settings-rules";

import { saveIdentifierSystemsAction, saveNumberingAction } from "./actions";

export const metadata: Metadata = { title: "Numbering · Settings" };

/**
 * Settings › Numbering (Setup step data.numbering): the prefixes and next numbers the
 * organization's member, household, pledge, order, receipt and event numbers use.
 * A number already issued is never issued again (the database refuses to go back).
 */
export default async function NumberingPage() {
  const session = await getSession();
  const { db, center } = session;
  const header = (
    <PageHeader
      title="Settings"
      description={`${center.short_name || center.name} · the numbers on member cards, receipts and pledges — adopt your existing register numbers here`}
    />
  );
  if (!canAccess(session, "centerSettings")) {
    return (
      <>
        {header}
        <NoAccess area="Numbering" access="centerSettings" />
      </>
    );
  }
  const res = await db.rpc("numbering_overview", { p_center: center.id });
  if (res.error) {
    return (
      <>
        {header}
        <QueryError what="the numbering" error={res.error} retryHref="/settings/numbering" />
      </>
    );
  }
  const rows = parseNumberingOverview(res.data);
  const legacy = identifierRules(center.rules).legacySystems;
  const version = rulesVersion(center.rules);

  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        <Card title="Number prefixes and next numbers" description="Setup › Numbering and identifier systems">
          <ActionForm action={saveNumberingAction} submitLabel="Save numbering" pendingLabel="Saving…">
            <TableWrap>
              <table className="crm-table" aria-label="Numbering">
                <thead>
                  <tr>
                    <th>Numbers</th>
                    <th>Prefix</th>
                    <th>Next number</th>
                    <th>Next looks like</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.kind} data-kind={r.kind}>
                      <td className="font-bold">{r.label}</td>
                      <td>
                        <input name={`prefix_${r.kind}`} defaultValue={r.prefix} maxLength={16} className="crm-input w-[140px] font-mono uppercase" aria-label={`${r.label} prefix`} />
                      </td>
                      <td>
                        <input name={`next_${r.kind}`} defaultValue={String(r.next_value)} inputMode="numeric" className="crm-input w-[140px] font-mono" aria-label={`${r.label}: next number`} />
                      </td>
                      <td className="font-mono text-[13px]">
                        {r.prefix}
                        {r.next_value}
                      </td>
                      <td className="text-[12px] text-muted">{r.started ? "In use — the next number can only go up" : "Not used yet"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <div className="mt-3">
              <label className="crm-label" htmlFor="numbering-reason">
                Reason (goes in the audit log)
              </label>
              <input id="numbering-reason" name="reason" className="crm-input" maxLength={500} placeholder="e.g. Adopt our existing member numbers" />
            </div>
            <p className="crm-hint mt-2">Saving also marks the Setup step as reviewed, even when nothing changed.</p>
          </ActionForm>
        </Card>
        <Card title="Identifier systems" description="The old systems whose IDs you keep on each record (Neon, NamoCRM, QuickBooks, …)">
          <ActionForm action={saveIdentifierSystemsAction} submitLabel="Save identifier systems" pendingLabel="Saving…">
            <input type="hidden" name="version" value={version === null ? "" : String(version)} />
            <label className="crm-label" htmlFor="legacy-systems">
              One per line: system name | label shown on records
            </label>
            <textarea
              id="legacy-systems"
              name="systems"
              className="crm-input min-h-[110px] font-mono"
              defaultValue={legacy.map((l) => (l.label === l.system ? l.system : `${l.system} | ${l.label}`)).join("\n")}
              placeholder={"Neon | Neon CRM account ID\nNamoCRM | NamoCRM member ID"}
            />
            <p className="crm-hint mt-1">
              {legacy.length > 0 ? `Declared now: ${legacy.map((l) => l.label).join(", ")}.` : "No old systems are declared yet."}{" "}
              <Link href="/settings/import" className="crm-link">
                Data import
              </Link>{" "}
              keeps each legacy ID on the record.
            </p>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
