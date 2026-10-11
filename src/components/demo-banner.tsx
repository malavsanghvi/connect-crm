import { DemoLeaveButton } from "@/components/demo-leave";
import { timeLeftText, type DemoBannerInfo } from "@/lib/demo-signin/rules";

/**
 * The slim strip on every page while someone is in a demo session: where they are, who they are exploring as, and the two ways out
 * (pick another person, or leave). `info` is null only when the session could not be read; the strip then still says it is a demo.
 */
export function DemoBanner({ info }: { info: DemoBannerInfo | null }) {
  return (
    <div
      role="note"
      data-testid="demo-banner"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-navy/20 bg-navy-50 px-4 py-1.5 text-center text-[12px] font-semibold text-navy"
    >
      <span>
        You are exploring a demo community{info?.role ? ` as ${info.role}` : ""}
      </span>
      <span aria-hidden>·</span>
      <a href="/demo" className="font-bold underline underline-offset-2">
        Switch role
      </a>
      <span aria-hidden>·</span>
      <DemoLeaveButton />
      {info ? <span className="font-normal text-muted">({timeLeftText(info.secondsLeft)})</span> : null}
    </div>
  );
}
