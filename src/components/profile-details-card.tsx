import { Card, DefinitionList, QueryError } from "@/components/ui";
import type { ProfileDetailsView } from "@/lib/data/profile-details";
import { explainError, type DbErrorLike } from "@/lib/errors";
import { formatPhone, toUsDate } from "@/lib/people";
import { emergencyContactLine, telHref } from "@/lib/profile-details";

const NOT_GIVEN = <span className="text-muted">Not given</span>;

/**
 * What the member told the community in the app (migration 0546), read-only for staff. The emergency
 * contact is set apart and labelled, with a tap-to-call number; dietary needs and the emergency
 * contact are sensitive, so the card says what they are for.
 */
export function ProfileDetailsCard({
  firstName,
  minor,
  result,
  retryHref,
  className,
}: {
  firstName: string;
  minor: boolean;
  result: { ok: true; data: ProfileDetailsView } | { ok: false; error: DbErrorLike | string };
  retryHref: string;
  className?: string;
}) {
  const title = "About this member";
  const description = "Optional details given in the app · dietary and emergency details are private: use them only for the event or emergency in hand";
  if (!result.ok) {
    return (
      <Card title={title} description={description} className={className}>
        <QueryError what="the details this member gave" error={result.error} retryHref={retryHref} />
      </Card>
    );
  }
  const v = result.data;
  const phoneHref = v.emergency ? telHref(v.emergency.phone) : null;
  const items = [
    ...(minor ? [] : [{ label: "Wedding anniversary", value: v.anniversary ? toUsDate(v.anniversary) : NOT_GIVEN }]),
    {
      label: "Dietary needs",
      value: v.dietary.length ? (
        <span>
          {v.dietary.map((d) => (d.retired ? `${d.label} (no longer offered)` : d.label)).join(", ")}
        </span>
      ) : (
        NOT_GIVEN
      ),
    },
    { label: "Interests", value: v.interests.length ? v.interests.join(", ") : NOT_GIVEN },
    ...(minor
      ? []
      : [
          {
            label: "Volunteering interests",
            value:
              v.volunteering === null ? (
                <span className="text-muted">Needs a volunteers permission</span>
              ) : !v.volunteering.ok ? (
                <span className="text-danger">Could not load</span>
              ) : v.volunteering.data.length ? (
                v.volunteering.data.join(", ")
              ) : (
                NOT_GIVEN
              ),
          },
        ]),
  ];
  return (
    <Card title={title} description={description} className={className}>
      <DefinitionList items={items} />
      <div className="mt-4 rounded-[10px] border border-line bg-[#FBF7F0] px-4 py-3" data-section="emergency-contact">
        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-danger">Emergency contact{minor ? ` for ${firstName}` : ""}</p>
        {v.emergency ? (
          <p className="mt-1 text-sm text-ink">
            <strong>{emergencyContactLine(v.emergency.name, v.emergency.relationship)}</strong>
            {" · "}
            {phoneHref ? (
              <a href={phoneHref} className="crm-link font-semibold">
                {formatPhone(v.emergency.phone)}
              </a>
            ) : (
              <span>{formatPhone(v.emergency.phone)}</span>
            )}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted">Not given{minor ? ". A parent adds it in the app." : "."}</p>
        )}
      </div>
      {v.labelsNote ? <p className="mt-2 text-[12px] text-muted">{v.labelsNote}</p> : null}
      {v.volunteering && v.volunteering.ok === false ? (
        <p className="mt-2 text-[12px] text-danger">Could not load the volunteering interests: {explainError(v.volunteering.error)}. Reload the page to try again.</p>
      ) : null}
    </Card>
  );
}
