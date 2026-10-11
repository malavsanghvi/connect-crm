import type { Metadata } from "next";

import { QueryError } from "@/components/ui";
import { getSession } from "@/lib/session";

import { SetupHeader, setupGate } from "../_components/setup-ui";
import { loadSnapshot } from "./load";
import { WebsiteForm } from "./website-form";

export const metadata: Metadata = { title: "Your website · Setup" };

const SUB = "what Weaver finds on your current website, and on websites you like · the step before drafting a new one";

export default async function YourWebsitePage() {
  const session = await getSession();
  const gate = setupGate(session, SUB, "Your website");
  if (gate) return gate;
  const { db, center } = session;

  const loaded = await loadSnapshot(db, center.id, []);
  if (!loaded.ok) {
    return (
      <>
        <SetupHeader session={session} sub={SUB} />
        <QueryError what="your website's details" error={loaded.cause} retryHref="/setup/website" />
      </>
    );
  }
  return (
    <>
      <SetupHeader session={session} sub={SUB} />
      <WebsiteForm initial={loaded.data} />
    </>
  );
}
