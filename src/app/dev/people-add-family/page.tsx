import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { devPreviewAllowed } from "@/lib/dev-preview";

import { SCENARIOS, type Scenario } from "./fixtures";
import { PreviewHarness } from "./harness";

export const metadata: Metadata = { title: "Add a family · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * DEV ONLY. The AddFamilySheet with invented data for a neutral neighbourhood association (names from several cultures), drawn with
 * fake actions: no database, no session. ?scenario=default|matches|confirm|nomatch|error|adderror|noaccess|cjk   ?look=v2 (default)
 * Returns notFound() in production (and the proxy lets /dev through without a session only outside production).
 */
export default async function AddFamilyPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const scenario: Scenario = (SCENARIOS as readonly string[]).includes(one(sp.scenario) ?? "") ? (one(sp.scenario) as Scenario) : "default";
  return (
    <div data-look="v2" className="v2-shell min-h-screen">
      <PreviewHarness scenario={scenario} />
    </div>
  );
}
