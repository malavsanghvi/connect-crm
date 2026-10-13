"use client";

import { createContext, useContext } from "react";

import { findHouseholdsAction, openPledgesAction } from "@/app/(app)/giving/actions";
import { applyPaymentAction, possibleDuplicateZelleAction, recordOfflinePaymentAction } from "@/app/(app)/giving/payments/actions";
import { pledgeSheetOptionsAction, recordPledgeAction } from "@/app/(app)/giving/pledges/record-pledge-actions";
import { familyGivingAction, sheetHouseholdAction } from "@/app/(app)/giving/sheet-actions";

/**
 * Where the Giving sheets read and record. The real one is the EXISTING Server Actions: the Record payment sheet records through
 * recordOfflinePaymentAction exactly as the Record payment screen does (the same checks, the same repeat-Zelle warning, the same
 * apply-again retry). The Record pledge sheet records through recordPledgeAction, the one new way to write (slice 7, 0745: giving.manage,
 * a reason, recorded once). The dev preview supplies one over invented data.
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
};

export const GivingSheetBackendContext = createContext<GivingSheetBackend>(REAL);

export function useGivingSheetBackend(): GivingSheetBackend {
  return useContext(GivingSheetBackendContext);
}
