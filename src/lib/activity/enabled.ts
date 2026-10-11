// The community's recording switch: centers.rules.activity.enabled (default off). Only an explicit true turns it
// on. The database checks the same switch on its own, so this is a shortcut that saves a round trip, not the rule.

export function activityRecordingOn(rules: unknown): boolean {
  if (typeof rules !== "object" || rules === null) return false;
  const activity = (rules as Record<string, unknown>).activity;
  if (typeof activity !== "object" || activity === null) return false;
  return (activity as Record<string, unknown>).enabled === true;
}

/**
 * When the switch last changed (rules.activity.since, set by app.set_activity_recording, 0625): an ISO time, or null when
 * it never changed through the platform screen (a community that was never switched on, or switched on before 0625).
 */
export function activitySince(rules: unknown): string | null {
  if (typeof rules !== "object" || rules === null) return null;
  const activity = (rules as Record<string, unknown>).activity;
  if (typeof activity !== "object" || activity === null) return null;
  const since = (activity as Record<string, unknown>).since;
  if (typeof since !== "string") return null;
  return Number.isFinite(Date.parse(since)) ? since : null;
}
