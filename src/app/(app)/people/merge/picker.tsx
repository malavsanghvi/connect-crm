"use client";

import { useRouter } from "next/navigation";

import { findHouseholdsForPeopleAction } from "@/app/(app)/households/actions";
import type { CardLabels } from "@/components/household-card";
import { HouseholdPicker } from "@/components/household-picker";

/** Step 1 of the household merge: find the other household by its card, never by name alone. */
export function HouseholdMergePicker({ keepId, labels, timeZone, currency }: { keepId: string; labels: CardLabels; timeZone: string; currency: string }) {
  const router = useRouter();
  return (
    <HouseholdPicker
      labels={labels}
      timeZone={timeZone}
      currency={currency}
      idPrefix="merge"
      selectLabel="Compare with this one"
      finder={findHouseholdsForPeopleAction}
      onSelect={(c) => {
        if (c.household_id !== keepId) router.push(`/people/merge?household=${keepId}&other=${c.household_id}`);
      }}
    />
  );
}
