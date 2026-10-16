import { Badge, StatusText } from "@/components/ui";
import { HEALTH_TONE, type Health } from "@/lib/care/health";

/** A household's sign as bold words (never colour alone): green Thriving, amber Cooling, red At risk or Lapsed, plain Steady and the rest. */
export function HealthChip({ health }: { health: Pick<Health, "level" | "label"> }) {
  const tone = HEALTH_TONE[health.level];
  return tone === "muted" ? <Badge tone="neutral">{health.label}</Badge> : <StatusText tone={tone}>{health.label}</StatusText>;
}
