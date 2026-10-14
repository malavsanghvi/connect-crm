"use client";

import { createContext, useContext } from "react";

import { findHouseholdsAction, openPledgesAction } from "@/app/(app)/giving/actions";
import { applyPaymentAction, possibleDuplicateZelleAction, recordOfflinePaymentAction } from "@/app/(app)/giving/payments/actions";
import { deletePledgeAction, editPledgeAction, pledgeEditSheetAction } from "@/app/(app)/giving/pledges/edit-pledge-actions";
import { emailPledgeAction, pledgeEmailSheetAction, pledgeEmailStatusAction } from "@/app/(app)/giving/pledges/email-pledge-actions";
import { pledgeSheetOptionsAction, recordPledgeAction } from "@/app/(app)/giving/pledges/record-pledge-actions";
import { familyGivingAction, sheetHouseholdAction } from "@/app/(app)/giving/sheet-actions";

/**
 * Where the Giving sheets read and record. The real one is the EXISTING Server Actions: the Record payment sheet records through
 * recordOfflinePaymentAction exactly as the Record payment screen does (the same checks, the same repeat-Zelle warning, the same
 * apply-again retry). The Record pledge sheet records through recordPledgeAction, the one new way to write (slice 7, 0745: giving.manage,
 * a reason, recorded once). The Edit pledge sheet reads and writes through pledgeEditSheetAction, editPledgeAction and deletePledgeAction (0782,
 * giving.manage). The Email pledge sheet reads and sends through pledgeEmailSheetAction, emailPledgeAction and pledgeEmailStatusAction (0792, giving.manage).
 * The dev preview supplies one over invented data.
 */
export type GivingSheetBackend = {
  household: typeof sheetHouseholdAction;
  pledges: typeof openPledgesAction;
  family: typeof familyGivingAction;
  record: typeof recordOfflinePaymentAction;
  apply: typeof applyPaymentAction;
  duplicateZelle: typeof possibleDuplicateZelleAction;
  findHouseholds: typeof findHouseholdsAction;
  pledgeOptions: typeof pledgeSheetOptionsAction;
  recordPledge: typeof recordPledgeAction;
  pledgeEditSheet: typeof pledgeEditSheetAction;
  editPledge: typeof editPledgeAction;
  deletePledge: typeof deletePledgeAction;
  pledgeEmailSheet: typeof pledgeEmailSheetAction;
  emailPledge: typeof emailPledgeAction;
  emailStatus: typeof pledgeEmailStatusAction;
};

const REAL: GivingSheetBackend = {
  household: sheetHouseholdAction,
  pledges: openPledgesAction,
  family: familyGivingAction,
  record: recordOfflinePaymentAction,
  apply: applyPaymentAction,
  duplicateZelle: possibleDuplicateZelleAction,
  findHouseholds: findHouseholdsAction,
  pledgeOptions: pledgeSheetOptionsAction,
  recordPledge: recordPledgeAction,
  pledgeEditSheet: pledgeEditSheetAction,
  editPledge: editPledgeAction,
  deletePledge: deletePledgeAction,
  pledgeEmailSheet: pledgeEmailSheetAction,
  emailPledge: emailPledgeAction,
  emailStatus: pledgeEmailStatusAction,
};

export const GivingSheetBackendContext = createContext<GivingSheetBackend>(REAL);

export function useGivingSheetBackend(): GivingSheetBackend {
  return useContext(GivingSheetBackendContext);
}
