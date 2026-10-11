// Which counters this person's Today page needs, so the loader reads only those (a treasurer's page never counts attendance).

import type { ScopedContext } from "@/lib/permissions";

import { BRIEFING_COUNTERS } from "./briefing";
import { RECIPES, type CounterKey } from "./recipes";
import { routineRolesFor, stepApplies } from "./resolve";

export function countersNeeded(viewer: ScopedContext): Set<CounterKey> {
  const needed = new Set<CounterKey>(BRIEFING_COUNTERS);
  for (const role of routineRolesFor(viewer)) {
    for (const step of RECIPES[role]) {
      if (!stepApplies(viewer, step)) continue;
      if (step.signal) needed.add(step.signal);
      if (step.onlyIf) needed.add(step.onlyIf);
    }
  }
  return needed;
}
