import { StatusText } from "@/components/ui";

export type IrsLookup = {
  ok?: boolean;
  found?: boolean;
  ein?: string;
  name?: string;
  city?: string | null;
  state?: string | null;
  subsection?: string | null;
  deductibility?: string | null;
  status?: string;
  revoked?: boolean;
  revoked_on?: string | null;
  in_pub78?: boolean;
  name_match?: "exact" | "partial" | "different" | "not_checked";
  data_loaded_at?: string | null;
  detail?: string;
};

const MATCH: Record<string, string> = {
  exact: "The name matches",
  partial: "The name is close (check it)",
  different: "The name is different",
  not_checked: "Name not checked",
};

/** The IRS lookup (app.irs_lookup) in plain words — shared by Setup and Platform › Verification. */
export function IrsResult({ result }: { result: IrsLookup | null }) {
  if (!result) return <p className="text-[13px] text-muted">No IRS result.</p>;
  return (
    <div className="flex flex-col gap-1.5 text-[13px]" data-irs-found={String(Boolean(result.found))} data-irs-ok={String(Boolean(result.ok))}>
      <p>
        {result.ok ? <StatusText tone="ok">Matches the IRS record</StatusText> : result.found ? <StatusText tone="bad">Check this</StatusText> : <StatusText tone="warn">Not found</StatusText>}
      </p>
      <p>{result.detail}</p>
      {result.found ? (
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-muted">EIN</dt>
          <dd className="font-mono">{result.ein}</dd>
          <dt className="text-muted">IRS name</dt>
          <dd>{result.name}</dd>
          <dt className="text-muted">Location</dt>
          <dd>{[result.city, result.state].filter(Boolean).join(", ") || "—"}</dd>
          <dt className="text-muted">Subsection</dt>
          <dd>{result.subsection ? `501(c)(${result.subsection.replace(/^0+/, "")})` : "—"}</dd>
          <dt className="text-muted">Deductible gifts</dt>
          <dd>{result.in_pub78 ? "Listed in Pub. 78" : result.deductibility === "1" ? "Yes (EO BMF)" : "Not listed as deductible"}</dd>
          <dt className="text-muted">Name</dt>
          <dd>{MATCH[result.name_match ?? "not_checked"]}</dd>
          <dt className="text-muted">Status</dt>
          <dd>{result.revoked ? `Revoked${result.revoked_on ? ` ${result.revoked_on}` : ""}` : result.status === "pub78_only" ? "Pub. 78 only" : "Active"}</dd>
        </dl>
      ) : null}
      {result.data_loaded_at ? <p className="crm-hint">IRS data loaded {result.data_loaded_at.slice(0, 10)}.</p> : null}
    </div>
  );
}
