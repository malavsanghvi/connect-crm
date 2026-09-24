import Link from "next/link";

import { AddIdentifierForm, RetireIdentifierButton, type TargetOption } from "@/components/identifier-forms";
import { Alert, Badge, Card, EmptyState, TableWrap } from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import type { Tables } from "@/lib/database.types";
import { formatDate } from "@/lib/dates";
import { identifierKindLabel, identifierTarget, isRetired, systemOptions } from "@/lib/identifiers";
import {
  IDENTIFIER_KINDS,
  canManageIdentifierKind,
  canViewIdentifierKind,
  manageableIdentifierKinds,
  type IdentifierKind,
} from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

type ExternalId = Pick<
  Tables<"external_ids">,
  | "id"
  | "kind"
  | "system"
  | "value"
  | "label"
  | "person_id"
  | "household_id"
  | "source"
  | "confidence"
  | "times_matched"
  | "last_matched_at"
  | "valid_from"
  | "valid_to"
  | "notes"
>;

const KIND_HINTS: Partial<Record<IdentifierKind, string>> = {
  crm: "An id from a system being retired (Neon, NamoCRM RSVP tickets…). Kept so old QR codes and imports still resolve.",
  accounting: "QuickBooks customer / donor id.",
  bank_payer: "How this family appears on the bank statement (Zelle sender, ACH originator). Not unique — a matching hint.",
  payment_provider: "Payment-provider customer id, e.g. cus_…",
};

/** Identifiers grouped by kind, with add / retire respecting per-kind permissions. */
export function IdentifiersPanel({
  session,
  rows,
  ownerNames,
  targets,
  returnPath,
  today,
  connectNumbers,
  personOnly = false,
}: {
  session: CrmSession;
  rows: ExternalId[];
  ownerNames: Map<string, string>;
  targets: TargetOption[];
  returnPath: string;
  today: string;
  connectNumbers: { label: string; value: string | null; owner: string }[];
  /** On a person's page: household-only kinds (org_household) are managed on the household. */
  personOnly?: boolean;
}) {
  const rules = identifierRules(session.center.rules);
  const tz = session.center.time_zone;
  const applicable = IDENTIFIER_KINDS.filter((k) => !(personOnly && identifierTarget(k) === "household"));
  const visibleKinds = applicable.filter((k) => canViewIdentifierKind(session, k));
  const hiddenKinds = applicable.filter((k) => !canViewIdentifierKind(session, k));
  const manageable = manageableIdentifierKinds(session).filter((k) => applicable.includes(k));

  return (
    <div className="space-y-5">
      <Card title="Member and household numbers" description="Issued by Community Connect when the record was created; they never change.">
        <TableWrap>
          <table className="crm-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Value</th>
                <th>Belongs to</th>
              </tr>
            </thead>
            <tbody>
              {connectNumbers.map((c) => (
                <tr key={`${c.label}-${c.owner}`}>
                  <td>{c.label}</td>
                  <td className="font-mono">{c.value ?? "—"}</td>
                  <td>{c.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      {visibleKinds.map((kind) => {
        const group = rows.filter((r) => r.kind === kind);
        const label = identifierKindLabel(kind, rules);
        const canManage = canManageIdentifierKind(session, kind);
        return (
          <Card
            key={kind}
            title={label}
            description={
              kind === "org_member"
                ? `The ID ${session.center.short_name ?? "the center"} already issued to each PERSON (system "${rules.orgMemberSystem}").`
                : kind === "org_household"
                  ? `The ID ${session.center.short_name ?? "the center"} already issued to the HOUSEHOLD (system "${rules.orgHouseholdSystem}") — a separate number space from person IDs.`
                  : KIND_HINTS[kind]
            }
            padded={false}
          >
            {group.length === 0 ? (
              <EmptyState title={`No ${label.toLowerCase()} on file`} />
            ) : (
              <TableWrap>
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Value</th>
                      <th>System</th>
                      <th>Label</th>
                      <th>Belongs to</th>
                      <th>Source</th>
                      <th>Valid</th>
                      <th>Status</th>
                      {canManage ? <th aria-label="Actions" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((r) => {
                      const retired = isRetired(r.valid_to, today);
                      const owner = r.person_id ? ownerNames.get(r.person_id) : r.household_id ? ownerNames.get(r.household_id) : null;
                      return (
                        <tr key={r.id} className={retired ? "opacity-60" : undefined}>
                          <td className="font-mono font-semibold">{r.value}</td>
                          <td>{r.system}</td>
                          <td>{r.label ?? "—"}</td>
                          <td>
                            {r.person_id ? (
                              <Link href={`/people/${r.person_id}`} className="crm-link">
                                {owner ?? "Person"}
                              </Link>
                            ) : (
                              <span>{owner ?? "Household"} (household)</span>
                            )}
                          </td>
                          <td>
                            {r.source}
                            {kind === "bank_payer" ? (
                              <div className="text-xs text-muted">
                                matched {r.times_matched}×{r.last_matched_at ? `, last ${formatDate(r.last_matched_at, tz)}` : ""}
                                {r.confidence !== null ? ` · confidence ${Math.round(Number(r.confidence) * 100)}%` : ""}
                              </div>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap text-[0.8125rem]">
                            {formatDate(r.valid_from, tz)} – {r.valid_to ? formatDate(r.valid_to, tz) : "now"}
                          </td>
                          <td>{retired ? <Badge>Retired</Badge> : r.valid_to ? <Badge tone="warning">Ends {formatDate(r.valid_to, tz)}</Badge> : <Badge tone="success">Live</Badge>}</td>
                          {canManage ? (
                            <td className="text-right">
                              {r.valid_to ? null : <RetireIdentifierButton id={r.id} value={r.value} returnPath={returnPath} />}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        );
      })}

      {hiddenKinds.length > 0 ? (
        <Alert tone="info">
          {hiddenKinds.map((k) => identifierKindLabel(k, rules)).join(", ")} identifiers are only visible with a giving
          permission (giving.view or giving.record_offline).
        </Alert>
      ) : null}

      <Card
        title="Add an identifier"
        description={
          manageable.length === 0
            ? "You can view identifiers but not change them. People identifiers need people.manage; finance identifiers need giving.manage."
            : "Retire an old value instead of editing it, so the history stays intact."
        }
      >
        {manageable.length > 0 ? (
          <AddIdentifierForm
            kinds={manageable.map((k) => ({
              kind: k,
              label: identifierKindLabel(k, rules),
              systems: systemOptions(k, rules),
              hint: KIND_HINTS[k],
            }))}
            targets={targets}
            returnPath={returnPath}
            orgMemberDigits={rules.orgMemberDigits}
            orgHouseholdDigits={rules.orgHouseholdDigits}
          />
        ) : (
          <p className="text-sm text-muted">No identifier kinds are editable with your roles.</p>
        )}
      </Card>
    </div>
  );
}
