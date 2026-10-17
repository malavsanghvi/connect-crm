import { WHO_SUBMITS_LABEL, type ProcessAnswer } from "@/lib/matching/catch";
import { formatDay } from "@/lib/care/model";

/**
 * How to claim from one employer: who submits, the steps in order, what to have ready, the links, how long it takes, tips, and
 * whether Weaver's team saw it work. Shared by the community's entry page and Platform; no person, no community, no amount.
 */
export function ProcessCard({ answer }: { answer: ProcessAnswer }) {
  const p = answer.process;
  if (!p) {
    return (
      <p className="crm-hint m-0" data-testid="no-process">
        Weaver&apos;s team has not written the steps for {answer.program.companyName} yet. Until it does, ask the member to find the matching program through their
        employer&apos;s human resources or giving portal.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="process">
      <p className="m-0 text-[14px] text-ink">
        {p.summary} <span className="text-muted">{WHO_SUBMITS_LABEL[p.whoSubmits]}.</span>
      </p>
      <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-[14px] text-ink">
        {p.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      {p.documents.length > 0 ? (
        <p className="m-0 text-[13.5px] text-ink">
          <span className="font-semibold">Have ready:</span> {p.documents.join("; ")}.
        </p>
      ) : null}
      {p.links.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13.5px]">
          {p.links.map((l) => (
            <li key={l.url}>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="crm-link">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {p.typicalDays !== null ? <p className="m-0 text-[13.5px] text-muted">It usually takes about {p.typicalDays} {p.typicalDays === 1 ? "day" : "days"}.</p> : null}
      {p.tips ? <p className="m-0 whitespace-pre-wrap text-[13.5px] text-ink">{p.tips}</p> : null}
      <p className="m-0 text-[12.5px] text-muted" data-testid="process-worked">
        {p.workedOn ? `Weaver's team saw it work on ${formatDay(p.workedOn)}${p.workedNote ? `: ${p.workedNote}` : ""}. ` : "Not yet seen to work by Weaver's team. "}
        {answer.workedCommunities > 0
          ? `${answer.workedCommunities} ${answer.workedCommunities === 1 ? "community has" : "communities have"} had a match paid through this program.`
          : "No community has had a match paid through this program yet."}
        {answer.here && answer.here.received > 0
          ? ` Here: ${answer.here.received} ${answer.here.received === 1 ? "match" : "matches"}${answer.here.lastOn ? `, the last on ${formatDay(answer.here.lastOn)}` : ""}.`
          : ""}
      </p>
    </div>
  );
}
