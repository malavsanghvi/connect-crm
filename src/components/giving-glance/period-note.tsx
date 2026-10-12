import type { TabPeriod } from "@/lib/giving-glance/page";

/** One line at the top of the Pledges and Payments tabs: they follow the year chosen in "Giving at a glance", and say so. */
export function PeriodNote({ period, what }: { period: TabPeriod; what: string }) {
  return (
    <p className="px-[18px] pb-3 text-[12px] text-muted" data-testid="period-note">
      Showing {what} {what.startsWith("pledges") ? "made" : "received"} in <strong className="text-ink-2">{period.label}</strong>, the year chosen above.{" "}
      <a href={period.showAllHref} className="crm-link font-semibold">
        Show all years
      </a>
    </p>
  );
}
