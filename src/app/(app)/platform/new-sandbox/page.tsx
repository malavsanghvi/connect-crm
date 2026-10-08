import type { Metadata } from "next";
import Link from "next/link";

import { Card, PageHeader, QueryError } from "@/components/ui";
import { loadExperiences } from "@/lib/experiences-db";
import { getSession } from "@/lib/session";

import { PlatformNoAccess } from "../platform-no-access";
import { NewSandboxForm } from "./new-sandbox-form";

export const metadata: Metadata = { title: "New sandbox · Platform" };

/** Platform › Centers › New sandbox: Weaver creates a sandbox directly and invites its owner (f-sandbox). */
export default async function NewSandboxPage() {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Platform"
      eyebrow={
        <Link href="/platform" className="crm-link">
          Platform › Centers
        </Link>
      }
      description="New sandbox · created directly by Weaver, without a request or a sandbox code"
    />
  );
  if (!session.isPlatformAdmin) {
    return (
      <>
        {header}
        <PlatformNoAccess />
      </>
    );
  }
  const kinds = await loadExperiences(session.db);
  if (kinds.status !== "ok") {
    return (
      <>
        {header}
        <QueryError what="the kinds of organization" error={kinds.error} retryHref="/platform/new-sandbox" />
      </>
    );
  }
  return (
    <>
      {header}
      <Card
        title="New sandbox"
        description="Choose the kind of organization and the owner. Creates the <web name>-sandbox organization with that kind's modules, wording and Setup checklist (sandbox limits, a member-app join code), then invites its owner. Everything is in the audit log with your reason."
      >
        <NewSandboxForm experiences={kinds.experiences} />
      </Card>
    </>
  );
}
