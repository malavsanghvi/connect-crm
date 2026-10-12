// Who is shown as a child in the find box. By birth date when there is one (under the community's age of majority, never under
// 18); with no birth date, only a person recorded as a child of the household. A person with neither is not shown as a child.

import { MIN_AGE_OF_MAJORITY } from "@/lib/age-of-majority";
import { ageOn } from "@/lib/dates";

export function isChildRecord(dateOfBirth: string | null | undefined, role: string | null | undefined, today: string, majority: number = MIN_AGE_OF_MAJORITY): boolean {
  const age = ageOn(dateOfBirth, today);
  if (age !== null) return age < Math.max(majority, MIN_AGE_OF_MAJORITY);
  return (role ?? "").toLowerCase() === "child";
}
