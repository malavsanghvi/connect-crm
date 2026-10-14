// What Platform › Setup › Demo sign-in shows (app.demo_signin_status, platform admins only), read defensively and worded for people.

export type DemoSigninStatus = {
  enabled: boolean;
  reason: string | null;
  changedAt: string | null;
  changedBy: string | null;
  peopleTotal: number;
  peopleReady: number;
  liveSessions: number;
  started24h: number;
  hours: number;
  communities: { id: string; name: string; kind: "faith" | "neutral" | null }[];
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function parseStatus(raw: unknown): DemoSigninStatus | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const communities: DemoSigninStatus["communities"] = [];
  for (const c of Array.isArray(o.communities) ? o.communities : []) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const id = text(r.id);
    if (!id) continue;
    communities.push({ id, name: text(r.name) ?? "Demo community", kind: r.kind === "faith" || r.kind === "neutral" ? r.kind : null });
  }
  return {
    enabled: o.enabled === true,
    reason: text(o.reason),
    changedAt: text(o.changed_at),
    changedBy: text(o.changed_by),
    peopleTotal: num(o.people_total),
    peopleReady: num(o.people_ready),
    liveSessions: num(o.live_sessions),
    started24h: num(o.started_24h),
    hours: num(o.hours) || 2,
    communities,
  };
}

/** The next thing to do, in one sentence, from what is set up. */
export function nextStep(s: DemoSigninStatus): string {
  // One demo community is enough to run the demo; the other kind can be added at any time.
  if (s.communities.length === 0) return "Create a demo community first. One is enough to start; the other kind can be added later.";
  if (s.peopleReady < s.peopleTotal) return "Set up the sign-ins: every demo person needs one before the demo can be turned on.";
  if (!s.enabled) return "Everything is ready. Turn the demo on when you want visitors to be able to try it.";
  return "The demo is on. Turn it off at any time: running demos end at once.";
}
