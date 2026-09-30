import { BarList } from "@/components/events/bars";
import { Card, EmptyState, TableWrap } from "@/components/ui";
import { formatNps } from "@/lib/survey/feedback";
import { countWithShare, type QuestionResult } from "@/lib/survey/results";

const MAX_COMMENTS = 50;

/** One question's results: average and spread for ratings, NPS with its groups, counts for choices, the answers for text. */
export function QuestionResultCard({ result, responses }: { result: QuestionResult; responses: number }) {
  const hint = `${result.answers} of ${responses} answered`;
  if (result.answers === 0) {
    return (
      <Card span={result.type === "text" ? 12 : 6} title={result.label} description={hint}>
        <p className="text-[13px] text-muted">No answers to this question yet.</p>
      </Card>
    );
  }
  if (result.type === "rating") {
    const top = Math.max(1, ...result.distribution.map((d) => d.count));
    return (
      <Card span={6} title={result.label} description={hint}>
        <p className="mb-3 text-[26px] font-extrabold leading-none text-navy">
          {result.average !== null ? result.average.toFixed(1) : "—"} <span className="text-[13px] font-semibold text-muted">out of 5</span>
        </p>
        <BarList
          labelWidth="4rem"
          items={[...result.distribution].reverse().map((d) => ({
            label: `${d.value} ${d.value === 1 ? "star" : "stars"}`,
            value: d.count,
            ratio: d.count / top,
            tone: d.value <= 2 ? "danger" : "purple",
          }))}
        />
      </Card>
    );
  }
  if (result.type === "nps") {
    const n = Math.max(1, result.answers);
    return (
      <Card span={6} title={result.label} description={hint}>
        <p className="mb-3 text-[26px] font-extrabold leading-none text-navy">
          {formatNps(result.nps)} <span className="text-[13px] font-semibold text-muted">net promoter score</span>
        </p>
        <BarList
          labelWidth="8rem"
          items={[
            { label: "Promoters (9–10)", value: countWithShare(result.promoters, result.promoters / n), ratio: result.promoters / n, tone: "success" },
            { label: "Passives (7–8)", value: countWithShare(result.passives, result.passives / n), ratio: result.passives / n, tone: "navy" },
            { label: "Detractors (0–6)", value: countWithShare(result.detractors, result.detractors / n), ratio: result.detractors / n, tone: "danger" },
          ]}
        />
      </Card>
    );
  }
  if (result.type === "single" || result.type === "multi") {
    return (
      <Card span={6} title={result.label} description={`${hint} · ${result.type === "multi" ? "people could pick several" : "pick one"}`}>
        <BarList
          labelWidth="9rem"
          items={result.options.map((o) => ({ label: o.label, value: countWithShare(o.count, o.ratio), ratio: o.ratio, tone: "navy" as const }))}
        />
      </Card>
    );
  }
  const shown = result.comments.slice(0, MAX_COMMENTS);
  return (
    <Card
      span={12}
      padded={false}
      title={result.label}
      description={result.comments.length > shown.length ? `${hint} · the newest ${shown.length} are shown here; all answers are in the table below` : hint}
    >
      {shown.length === 0 ? (
        <EmptyState title="No written answers yet" />
      ) : (
        <TableWrap>
          <table className="crm-table min-w-[560px]">
            <thead>
              <tr>
                <th>From</th>
                <th>Answer</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c, i) => (
                <tr key={`${c.submittedAt}-${i}`}>
                  <td className={c.anonymous ? "font-bold text-faint" : "font-bold"}>{c.from}</td>
                  <td>
                    {c.text}
                    {c.flagged ? <span className="cc-status-warn ml-2 whitespace-nowrap">· flagged to the event lead</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
