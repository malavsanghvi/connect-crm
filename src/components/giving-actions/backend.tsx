"use client";

import { createContext, useContext } from "react";

import { findHouseholdsAction, openPledgesAction } from "@/app/(app)/giving/actions";
import { applyPaymentAction, possibleDuplicateZelleAction, recordOfflinePaymentAction } from "@/app/(app)/giving/payments/actions";
import { familyGivingAction, sheetHouseholdAction } from "@/app/(app)/giving/sheet-actions";

/**
 * Where the Giving sheets read and record. The real one is the EXISTING Server Actions: the Record payment sheet records through
 * recordOfflinePaymentAction exactly as the Record payment screen does (the same checks, the same repeat-Zelle warning, the same
 * apply-again retry); nothing here is a new way to write. The dev preview supplies one over invented data.
 */
export type GivingSheetBackend = {
  household: typeof sheetHouseholdAction;
  pledges: typeof openPledgesAction;
  family: typeof familyGivingAction;
  record: typeof recordOfflinePaymentAction;
  apply: typeof applyPaymentAction;
  duplicateZelle: typeof possibleDuplicateZelleAction;
  findHouseholds: typeof findHouseholdsAction;
};

const REAL: GivingSheetBackend = {
  household: sheetHouseholdAction,
  pledges: openPledgesAction,
  family: familyGivingAction,
  record: recordOfflinePaymentAction,
  apply: applyPaymentAction,
  duplicateZelle: possibleDuplicateZelleAction,
  findHouseholds: findHouseholdsAction,
};

export const GivingSheetBackendContext = createContext<GivingSheetBackend>(REAL);

export function useGivingSheetBackend(): GivingSheetBackend {
  return useContext(GivingSheetBackendContext);
}
