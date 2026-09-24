import type { Metadata } from "next";
import Link from "next/link";

import { dismissDuplicateAction, mergeHouseholdsAction } from "@/app/(app)/households/actions";
import { mergePeopleAction } from "@/app/(app)/people/actions";
import { ActionForm } from "@/components/action-form";
import { Alert, Card, EmptyState, NoAccess, PageHeader, QueryError, TableWrap, buttonClass } from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import { personName } from "@/lib/data/lookups";
import { formatDate } from "@/lib/dates";
import { canAccess } from "@/lib/permissions";
import { genderLabel, languageLabel, toUsDate } from "@/lib/people";
import { isUuid, param, safeFilterText, type RawSearchParams } from "@/lib/search-params";
import { getSession, type CrmSession } from "@/lib/session";

import { HouseholdMergePicker } from "./picker";

export const metadata: Metadata = { title: "People · Merge duplicates" };

// Merge-duplicate wizard: 1) pick the duplicate (from app.merge_candidates or
// a search), 2) compare the two records field by field and choose what the
// kept record takes, 3) confirm. Backed by app.merge_people / merge_households.

const PERSON_FIELDS = [
  ["first_name", "First name"],
  ["last_name", "Last name"],
  ["preferred_name", "Preferred name"],
  ["date_of_birth", "Date of birth"],
  ["gender", "Gender"],
  ["email", "Email"],
  ["phone_e164", "Mobile"],
  ["profession", "Profession"],
  ["employer", "Employer"],
] as const;

type PersonCmp = Record<(typeof PERSON_FIELDS)[number][0], string | null> & {
  id: string;
  first_name: string;
  last_name: string;
  member_number: string | null;
  language: string;
  created_at: string;
  merged_into_id: string | null;
};

function show(key: string, v: string | null): string {
  if (!v) return "—";
  if (key === "date_of_birth") return toUsDate(v);
  if (key === "gender") return genderLabel(v);
  return v;
}

export default async function MergePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = <PageHeader title="People" description="Merge duplicates · pick the duplicate, compare fields, confirm" />;
  if (!canAccess(session, "householdsEdit")) {
    return (
      <>
        {header}
        <NoAccess area="Merging duplicates" access="householdsEdit" />
      </>
    );
  }
  const sp = await searchParams;
  const hh = param(sp, "household");
  const person = param(sp, "person");
  const other = param(sp, "other");
  return (
    <>
      {header}
      {isUuid(person) ? (
        <PersonMerge session={session} id={person} other={isUuid(other) ? other : undefined} q={param(sp, "q")} />
      ) : isUuid(hh) ? (
        <HouseholdMerge session={session} id={hh} other={isUuid(other) ? other : undefined} />
      ) : (
        <CandidateQueue session={session} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Queue of suggested duplicates
// ---------------------------------------------------------------------------
async function CandidateQueue({ session }: { session: CrmSession }) {
  const { db, center } = session;
  const res = await db.from("merge_candidates").select("id, kind, left_id, right_id, score, created_at").eq("center_id", center.id).eq("status", "open").order("created_at").limit(100);
  if (res.error) return <QueryError what="suggested duplicates" error={res.error} retryHref="/people/merge" />;
  const rows = res.data ?? [];
  const personIds = rows.filter((r) => r.kind === "person").flatMap((r) => [r.left_id, r.right_id]);
  const hhIds = rows.filter((r) => r.kind === "household").flatMap((r) => [r.left_id, r.right_id]);
  const [people, hhs] = await Promise.all([
    personIds.length ? db.from("people").select("id, first_name, last_name, preferred_name").in("id", personIds) : null,
    hhIds.length ? db.from("households").select("id, display_name").in("id", hhIds) : null,
  ]);
  const names = new Map<string, string>([...(people?.data ?? []).map((p) => [p.id, personName(p)] as const), ...(hhs?.data ?? []).map((h) => [h.id, h.display_name] as const)]);
  const lookupError = people?.error ?? hhs?.error;
  return (
    <Card title="Suggested duplicates" description="Found when a new sign-in or import looks like an existing record. Open one to compare." padded={false}>
      {lookupError ? (
        <div className="p-2.5">
          <QueryError what="names for some suggestions" error={lookupError} retryHref="/people/merge" />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title="Nothing here right now">Open a household or person and choose Merge duplicate to compare two records yourself.</EmptyState>
      ) : (
        <TableWrap>
          <table className="crm-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Record</th>
                <th>Possible duplicate</th>
                <th>Found</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.kind === "person" ? "Person" : "Household"}</td>
                  <td className="font-bold">{names.get(r.left_id) ?? "Not visible"}</td>
                  <td className="font-bold">{names.get(r.right_id) ?? "Not visible"}</td>
                  <td>{formatDate(r.created_at, session.center.time_zone)}</td>
                  <td className="row-actions">
                    <Link href={`/people/merge?${r.kind === "person" ? "person" : "household"}=${r.left_id}&other=${r.right_id}`} className={buttonClass("primary", "xs")}>
                      Compare
                    </Link>
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

function Steps({ step }: { step: 1 | 2 }) {
  return (
    <ol className="mb-3 flex flex-wrap gap-2 text-[12px] font-bold text-muted">
      {["Pick the duplicate", "Compare and confirm"].map((s, i) => (
        <li key={s} className={`rounded-full border px-3 py-1 ${i + 1 === step ? "border-navy bg-navy text-white" : "border-line"}`}>
          {i + 1}. {s}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
async function PersonMerge({ session, id, other, q }: { session: CrmSession; id: string; other?: string; q?: string }) {
  const { db, center } = session;
  const cols = "id, first_name, last_name, preferred_name, date_of_birth, gender, email, phone_e164, profession, employer, member_number, language, created_at, merged_into_id";
  const [a, b, candidates] = await Promise.all([
    db.from("people").select(cols).eq("id", id).eq("center_id", center.id).maybeSingle(),
    other ? db.from("people").select(cols).eq("id", other).eq("center_id", center.id).maybeSingle() : null,
    db.from("merge_candidates").select("id, left_id, right_id").eq("center_id", center.id).eq("kind", "person").eq("status", "open").or(`left_id.eq.${id},right_id.eq.${id}`),
  ]);
  const err = a.error ?? b?.error ?? candidates.error;
  if (err) return <QueryError what="the records to compare" error={err} retryHref={`/people/merge?person=${id}`} />;
  if (!a.data) return <EmptyState title="That person was not found" />;
  const left = a.data as PersonCmp;

  if (!b?.data) {
    // Step 1: pick the duplicate.
    const suggested = (candidates.data ?? []).map((c) => (c.left_id === id ? c.right_id : c.left_id));
    const safe = q ? safeFilterText(q) : "";
    const [sugg, found] = await Promise.all([
      suggested.length ? db.from("people").select("id, first_name, last_name, preferred_name, member_number, email").in("id", suggested).is("merged_into_id", null) : null,
      safe
        ? db
            .from("people")
            .select("id, first_name, last_name, preferred_name, member_number, email")
            .eq("center_id", center.id)
            .is("merged_into_id", null)
            .neq("id", id)
            .or(`first_name.ilike.*${safe}*,last_name.ilike.*${safe}*,email.ilike.*${safe}*,member_number.ilike.*${safe}*`)
            .limit(20)
        : null,
    ]);
    const list = [...(sugg?.data ?? []).map((p) => ({ ...p, suggested: true })), ...(found?.data ?? []).map((p) => ({ ...p, suggested: false }))];
    return (
      <Card title={`Merge a duplicate of ${personName(left)}`} description="Pick the other record for the same person">
        <Steps step={1} />
        {sugg?.error || found?.error ? <QueryError what="possible duplicates" error={sugg?.error ?? found?.error} /> : null}
        <form method="get" action="/people/merge" className="mb-3 flex flex-wrap items-end gap-2.5">
          <input type="hidden" name="person" value={id} />
          <div className="min-w-[16rem] flex-1">
            <label htmlFor="merge-q" className="crm-label">
              Search by name, email or member number
            </label>
            <input id="merge-q" name="q" type="search" defaultValue={q ?? ""} className="crm-input" />
          </div>
          <button type="submit" className={buttonClass("primary")}>
            Search
          </button>
        </form>
        {list.length === 0 ? (
          <EmptyState title={q ? "No one matches that search" : "No suggested duplicates — search for the other record"} />
        ) : (
          <div className="flex flex-col gap-1.5">
            {list.map((p) => (
              <Link key={p.id} href={`/people/merge?person=${id}&other=${p.id}`} className="cc-kv">
                <span>
                  <strong>{personName(p)}</strong>
                  {p.suggested ? <span className="ml-2 text-xs font-bold text-brown">Suggested</span> : null}
                  <span className="block text-xs text-muted">{[p.member_number, p.email].filter(Boolean).join(" · ") || "No member number or email"}</span>
                </span>
                <span className="font-bold text-navy">Compare</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    );
  }

  // Step 2: compare. `left` is kept, `right` is the duplicate; swap to change.
  const right = b.data as PersonCmp;
  const [logins] = await Promise.all([db.from("center_users").select("person_id").eq("center_id", center.id).in("person_id", [left.id, right.id])]);
  if (logins.error) console.error("[merge] sign-in lookup failed; the database still checks it:", logins.error);
  const signsIn = new Set((logins.data ?? []).map((l) => l.person_id));
  const candidate = (candidates.data ?? []).find((c) => c.left_id === right.id || c.right_id === right.id);
  const differing = PERSON_FIELDS.filter(([k]) => (left[k] ?? "") !== (right[k] ?? ""));
  const blocked = signsIn.has(right.id);
  return (
    <Card title="Compare the two records" description="The kept record stays; tick any value to take from the duplicate. Everything is audited.">
      <Steps step={2} />
      {left.merged_into_id || right.merged_into_id ? <Alert tone="warning">One of these records was already merged.</Alert> : null}
      {blocked ? (
        <Alert tone="warning" title="The duplicate signs in to the app">
          Keep the record that signs in.{" "}
          <Link href={`/people/merge?person=${right.id}&other=${left.id}`} className="crm-link font-bold">
            Swap which record is kept
          </Link>
          {signsIn.has(left.id) ? " — both sign in, so the platform team has to merge the sign-ins first." : null}
        </Alert>
      ) : null}
      <ActionForm
        action={mergePeopleAction}
        submitLabel="Merge records"
        pendingLabel="Merging…"
        variant="warn"
        className="mt-3"
        confirmKicker="Merge duplicate"
        confirmMessage={`Merge ${personName(right)} into ${personName(left)}? Household links, identifiers and held memberships move to the kept record. Pledges, payments and the audit history stay on the duplicate, which is marked as merged. This cannot be undone here.`}
        extraButtons={
          <>
            <Link href={`/people/merge?person=${right.id}&other=${left.id}`} className={buttonClass("ghost")}>
              Swap kept record
            </Link>
            <Link href={`/people/merge?person=${left.id}`} className={buttonClass("ghost")}>
              Back
            </Link>
          </>
        }
      >
        <input type="hidden" name="keep" value={left.id} />
        <input type="hidden" name="drop" value={right.id} />
        <TableWrap>
          <table className="crm-table mb-3">
            <thead>
              <tr>
                <th>Field</th>
                <th>Kept record</th>
                <th>Duplicate</th>
                <th>Take from duplicate</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Member number</td>
                <td className="font-mono">{left.member_number ?? "—"}</td>
                <td className="font-mono">{right.member_number ?? "—"}</td>
                <td className="text-xs text-muted">The kept number stays</td>
              </tr>
              {PERSON_FIELDS.map(([k, label]) => {
                const diff = differing.some(([d]) => d === k);
                return (
                  <tr key={k} data-highlight={diff || undefined}>
                    <td>{label}</td>
                    <td>{show(k, left[k])}</td>
                    <td>{show(k, right[k])}</td>
                    <td>
                      {diff && right[k] ? (
                        <label className="inline-flex items-center gap-2">
                          <input type="checkbox" name="take" value={k} defaultChecked={!left[k]} />
                          <span className="text-xs">Use this</span>
                        </label>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td>Language</td>
                <td>{languageLabel(left.language)}</td>
                <td>{languageLabel(right.language)}</td>
                <td className="text-faint">—</td>
              </tr>
              <tr>
                <td>Signs in to the app</td>
                <td>{signsIn.has(left.id) ? "Yes" : "No"}</td>
                <td>{signsIn.has(right.id) ? "Yes" : "No"}</td>
                <td className="text-faint">—</td>
              </tr>
            </tbody>
          </table>
        </TableWrap>
      </ActionForm>
      {candidate ? (
        <ActionForm action={dismissDuplicateAction} submitLabel="Not a duplicate" variant="ghost" className="mt-2" confirmMessage="Mark these two records as different people? The suggestion is closed.">
          <input type="hidden" name="candidate" value={candidate.id} />
        </ActionForm>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Households
// ---------------------------------------------------------------------------
async function HouseholdMerge({ session, id, other }: { session: CrmSession; id: string; other?: string }) {
  const { db, center } = session;
  const rules = identifierRules(center.rules);
  const [cards, candidates] = await Promise.all([
    Promise.all([db.rpc("household_card", { p_household: id }), other ? db.rpc("household_card", { p_household: other }) : null]),
    db.from("merge_candidates").select("id, left_id, right_id").eq("center_id", center.id).eq("kind", "household").eq("status", "open").or(`left_id.eq.${id},right_id.eq.${id}`),
  ]);
  const [a, b] = cards;
  const err = a.error ?? b?.error ?? candidates.error;
  if (err) return <QueryError what="the households to compare" error={err} retryHref={`/people/merge?household=${id}`} />;
  const left = a.data?.[0];
  if (!left) return <EmptyState title="That household was not found" />;
  const right = b?.data?.[0];
  const suggested = (candidates.data ?? []).map((c) => (c.left_id === id ? c.right_id : c.left_id));

  if (!right) {
    const sugg = suggested.length ? await db.from("households").select("id, display_name, household_number").in("id", suggested).is("merged_into_id", null) : null;
    return (
      <Card title={`Merge a duplicate of ${left.household_name}`} description="Pick the other record for the same family — compare the IDs and members, never the name alone">
        <Steps step={1} />
        {sugg?.error ? <QueryError what="suggested duplicates" error={sugg.error} /> : null}
        {(sugg?.data ?? []).length ? (
          <div className="mb-4 flex flex-col gap-1.5">
            {(sugg?.data ?? []).map((h) => (
              <Link key={h.id} href={`/people/merge?household=${id}&other=${h.id}`} className="cc-kv">
                <span>
                  <strong>{h.display_name}</strong> <span className="ml-2 text-xs font-bold text-brown">Suggested</span>
                  <span className="block font-mono text-xs text-muted">{h.household_number ?? ""}</span>
                </span>
                <span className="font-bold text-navy">Compare</span>
              </Link>
            ))}
          </div>
        ) : null}
        <HouseholdMergePicker
          keepId={id}
          labels={{ orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel }}
          timeZone={center.time_zone}
          currency={center.currency}
        />
      </Card>
    );
  }

  const candidate = (candidates.data ?? []).find((c) => c.left_id === other || c.right_id === other);
  const rows: [string, string | null | undefined, string | null | undefined][] = [
    ["Household no.", left.household_number, right.household_number],
    [rules.orgHouseholdLabel, left.org_household_id, right.org_household_id],
    ["Members", left.members, right.members],
    ["Primary member", left.primary_member, right.primary_member],
    ["Zone", left.zone, right.zone],
    ["City", left.city, right.city],
    ["Last gift", left.last_gift_on ? formatDate(left.last_gift_on, center.time_zone) : null, right.last_gift_on ? formatDate(right.last_gift_on, center.time_zone) : null],
  ];
  return (
    <Card title="Compare the two households" description="Current members of the duplicate move to the kept household. Its pledges, payments and memberships stay on it (its record says where it went).">
      <Steps step={2} />
      <TableWrap>
        <table className="crm-table mb-3">
          <thead>
            <tr>
              <th>Field</th>
              <th>Kept · {left.household_name}</th>
              <th>Duplicate · {right.household_name}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, l, r]) => (
              <tr key={label} data-highlight={(l ?? "") !== (r ?? "") || undefined}>
                <td>{label}</td>
                <td>{l || "—"}</td>
                <td>{r || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <ActionForm
        action={mergeHouseholdsAction}
        submitLabel="Merge households"
        pendingLabel="Merging…"
        variant="warn"
        confirmKicker="Merge duplicate"
        confirmMessage={`Merge ${right.household_name} into ${left.household_name}? Its current members move over. Its pledges, payments and memberships stay on the merged record. This cannot be undone here.`}
        extraButtons={
          <>
            <Link href={`/people/merge?household=${other}&other=${id}`} className={buttonClass("ghost")}>
              Swap kept household
            </Link>
            <Link href={`/people/merge?household=${id}`} className={buttonClass("ghost")}>
              Back
            </Link>
          </>
        }
      >
        <input type="hidden" name="keep" value={id} />
        <input type="hidden" name="drop" value={other} />
      </ActionForm>
      {candidate ? (
        <ActionForm action={dismissDuplicateAction} submitLabel="Not a duplicate" variant="ghost" className="mt-2" confirmMessage="Mark these as two different households? The suggestion is closed.">
          <input type="hidden" name="candidate" value={candidate.id} />
        </ActionForm>
      ) : null}
    </Card>
  );
}
