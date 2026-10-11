// The community's recording switch: centers.rules.activity.enabled (default off). Only an explicit true turns it
// on. The database checks the same switch on its own, so this is a shortcut that saves a round trip, not the rule.

export function activityRecordingOn(rules: unknown): boolean {
  if (typeof rules !== "object" || rules === null) return false;
  const activity = (rules as Record<string, unknown>).activity;
  if (typeof activity !== "object" || activity === null) return false;
  return (activity as Record<string, unknown>).enabled === true;
}
