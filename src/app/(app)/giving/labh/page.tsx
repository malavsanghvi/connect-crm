import type { Metadata } from "next";

import { NoAccess, PageHeader } from "@/components/ui";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { LabhFulfilment } from "./fulfilment";

export const metadata: Metadata = { title: "Labh fulfillment" };

export default async function LabhPage() {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Giving"
      description="Special-day labh taken in the app · schedule the puja, tell the Pathshala teacher, show the dedication"
    />
  );
  if (!canAccess(session, "labh")) {
    return (
      <>
        {header}
        <NoAccess area="Labh fulfillment" access="labh" />
      </>
    );
  }
  return <LabhFulfilment session={session} header={header} retryHref="/giving/labh" />;
}
