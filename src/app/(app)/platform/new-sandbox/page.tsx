import type { Metadata } from "next";
import Link from "next/link";

import { Card, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";

import { PlatformNoAccess } from "../platform-no-access";
import { NewSandboxForm } from "./new-sandbox-form";

export const metadata: Metadata = { title: "New sandbox · Platform" };

/** Platform › Centers › New sandbox: Community Connect creates a sandbox directly and invites its owner (f-sandbox). */
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
      description="New sandbox · created directly by Community Connect, without a request or a sandbox code"
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
  return (
    <>
      {header}
      <Card
        title="New sandbox"
        description="Creates the <web name>-sandbox organization (sandbox limits, every module on, the Setup checklist, a member-app join code), then invites its owner. Everything is in the audit log with your reason."
      >
        <NewSandboxForm />
      </Card>
    </>
  );
}
