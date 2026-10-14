// What the Giving sheets need from the signed-in person and the community, worked out on the server where the sheets are mounted
// (the New look's shell). Null when the person has nothing to do with Giving there (Giving switched off, or no Giving permission
// that opens payments): no sheet can open, and the buttons that would open one follow their ordinary link instead.

import { identifierRules } from "@/lib/center-rules";
import { communityFormat } from "@/lib/community-format";
import { todayInTz } from "@/lib/dates";
import { GIVING_ADDONS } from "@/lib/giving-today/tabs";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

import type { GivingSheetContext } from "./record-sheet";

/** May this person use the find box's Giving lane at all? Giving on, and any Giving permission that opens payments or pledges. */
export function canFindGiving(session: CrmSession): boolean {
  return isModuleEnabled(session, "giving") && (canAccess(session, "payments") || canAccess(session, "pledges") || canAccess(session, "recordPayment"));
}

export function givingSheetContext(session: CrmSession, now: Date = new Date()): GivingSheetContext | null {
  if (!isModuleEnabled(session, "giving")) return null;
  const canRecord = canAccess(session, "recordPayment");
  if (!canRecord && !canAccess(session, "payments")) return null;
  const { center } = session;
  const fmt = communityFormat(center);
  const rules = identifierRules(center.rules);
  return {
    currency: fmt.currency,
    locale: fmt.locale,
    timeZone: center.time_zone,
    today: todayInTz(center.time_zone, now),
    labels: { orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel },
    canRecord,
    canAllocate: canAccess(session, "allocatePayment"),
    canRecordPledge: canAccess(session, "recordPledge"),
    canEditPledge: canAccess(session, "givingManage"),
    canEmailPledge: canAccess(session, "givingManage"),
    bankOn: isModuleEnabled(session, GIVING_ADDONS.bank),
    canOpenFamily: canAccess(session, "households"),
  };
}
