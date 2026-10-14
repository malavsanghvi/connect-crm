import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewShell } from "@/app/dev/admin-giving/preview-shell";
import { StatementsView } from "@/components/giving-statements/statements-view";
import type { RailWorkspace } from "@/components/shell/workspace-rail";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { STATEMENTS_COMMUNITY, sampleStatementsModel, type StatementsSample } from "@/lib/giving-statements/fixtures";
import { WORKSPACES } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Giving Statements · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

function sampleRail(): RailWorkspace[] {
  return WORKSPACES.filter((w) => !["learning", "store", "platform"].includes(w.key)).map((w) => ({
    key: w.key,
    label: w.label,
    href: w.key === "giving" ? "/dev/giving-statements" : "/",
    icon: w.icon,
    placement: w.placement,
    paths: w.key === "giving" ? ["/dev/giving-statements"] : [`/__preview/${w.key}`],
    tabs: [],
  }));
}

const SAMPLES: readonly StatementsSample[] = ["ok", "off", "no_access", "error", "empty"];

/**
 * DEV ONLY. Giving › Statements (New look) with invented data for a neutral community club, drawn without a database or a
 * session. `?sample=off|no_access|error|empty` shows the other states of the review, `?show=fix` a filter, `?receipt=1` a copy of
 * one receipt (`&approved=0`: the templates are not approved, so printing is off), `?review=1` opens the sheet. Returns notFound()
 * in production.
 */
export default async function GivingStatementsPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const model = sampleStatementsModel({
    sample: SAMPLES.find((s) => s === one("sample")) ?? "ok",
    show: one("show"),
    receipt: one("receipt") !== undefined,
    templatesApproved: one("approved") !== "0",
    openReview: one("review") === "1",
  });
  return (
    <PreviewShell community={STATEMENTS_COMMUNITY} workspaces={sampleRail()}>
      <StatementsView model={model} />
    </PreviewShell>
  );
}
