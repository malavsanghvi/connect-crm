import type { Metadata } from "next";

import { Alert, BlockGrid, NoAccess, PageHeader, QueryError, buttonClass } from "@/components/ui";
import { moduleOffNote } from "@/lib/access";
import { isPermissionError, loadAccessSettings } from "@/lib/access-db";
import { moduleLabelFor } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { AreasCard, LevelsCard } from "./access-forms";

export const metadata: Metadata = { title: "Access levels · Settings" };

/**
 * Settings › Access levels (migration 0586): who can use each area of the member app (live darshan, virtual
 * puja, listen, look, learn, Niva …) in this community, and the ladder of levels that choice is made from
 * (Public, Community member, and the community's own membership levels). Needs settings.manage; every change
 * needs a reason and a fresh 2FA check and is audited. docs/ACCESS_LEVELS.md.
 */
export default async function AccessLevelsPage() {
  const session = await getSession();
  const center = session.center.short_name || session.center.name;
  const header = (
    <PageHeader
      title="Settings"
      description={`Who can use each area of the member app in ${center}: anyone, community members, or a membership level you define · the levels can differ for every organization`}
    />
  );
  if (!canAccess(session, "centerSettings")) {
    return (
      <>
        {header}
        <NoAccess area="Access levels" access="centerSettings" />
      </>
    );
  }

  const loaded = await loadAccessSettings(session.db, session.center.id);
  if (loaded.status === "missing") {
    return (
      <>
        {header}
        <Alert tone="warning">
          Access levels arrive with the next database update, which has not been applied yet. Until then every area keeps the rules it had before, and nothing can
          be changed here.
        </Alert>
      </>
    );
  }
  if (loaded.status === "error") {
    return (
      <>
        {header}
        {isPermissionError(loaded.error) ? (
          <NoAccess area="Access levels" access="centerSettings" />
        ) : (
          <QueryError what="the access levels" error={loaded.error} retryHref="/settings/access" />
        )}
      </>
    );
  }
  if (loaded.status === "shape") {
    return (
      <>
        {header}
        <Alert
          tone="danger"
          title="Could not read the access levels"
          action={
            <a href="/settings/access" className={buttonClass("bad", "xs")}>
              Try again
            </a>
          }
        >
          {loaded.message}
        </Alert>
      </>
    );
  }

  const { levels, features, membershipTypes, membershipOn } = loaded.settings;
  const moduleNotes: Record<string, string> = {};
  for (const f of features) {
    const note = moduleOffNote(f, moduleLabelFor(f.moduleKey));
    if (note) moduleNotes[f.key] = note;
  }

  return (
    <>
      {header}
      <BlockGrid>
        <AreasCard centerName={center} levels={levels} features={features} types={membershipTypes} moduleNotes={moduleNotes} />
        <LevelsCard centerName={center} levels={levels} features={features} types={membershipTypes} membershipOn={membershipOn} />
      </BlockGrid>
    </>
  );
}
