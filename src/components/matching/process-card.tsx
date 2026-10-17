import { formatDay } from "@/lib/care/model";
import { WHO_SUBMITS_LABEL, type ProcessAnswer } from "@/lib/matching/catch";
import { fileLine } from "@/lib/matching/files";

/**
 * How to claim from one employer: who submits, the steps in order, what to have ready, the links, how long it takes, tips, and
 * whether Weaver's team saw it work. Shared by the community's entry page and Platform; no person, no community, no amount.
 */
export function ProcessCard({ answer }: { answer: ProcessAnswer }) {
  const p = answer.process;
  if (!p) {
    return (
      <>
        <p className="crm-hint m-0" data-testid="no-process">
          Weaver&apos;s team has not written the steps for {answer.program.companyName} yet. Until it does, ask the member to find the matching program through their
          employer&apos;s human resources or giving portal.
        </p>
        <ProcessFiles answer={answer} />
      </>
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
      <ProcessFiles answer={answer} />
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

/** The forms and screens that show the way (0928): each opens in a new tab through a link that lasts an hour. */
export function ProcessFiles({ answer }: { answer: ProcessAnswer }) {
  if (answer.files.length === 0) return null;
  return (
    <div data-testid="process-files">
      <p className="m-0 mb-1 text-[13.5px] font-semibold text-ink">Forms and screens</p>
      {answer.filesNotice ? (
        <p role="alert" className="m-0 mb-1 text-[13px] text-danger">
          {answer.filesNotice}
        </p>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13.5px]">
        {answer.files.map((f) => (
          <li key={f.id}>
            {f.url ? (
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="crm-link">
                {f.caption}
              </a>
            ) : (
              <span className="text-ink">{f.caption}</span>
            )}{" "}
            <span className="text-muted">({fileLine(f)})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
