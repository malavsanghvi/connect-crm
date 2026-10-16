import type { Metadata } from "next";

import { PageHeader } from "@/components/ui";
import { NO_ACCESS } from "@/lib/care/model";
import { loadThanksSettings } from "@/lib/data/care";
import { kindName } from "@/lib/kind";
import { getSession } from "@/lib/session";

import { ThanksSettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Thank-you rules" };

// The thank-you rules (DonorDelight slice 3, 0881): how fast a gift is thanked, which gifts need a personal thank-you, and the first
// day thank-yous begin. Whoever manages DonorDelight may change them; Weaver support may too while the owner's support grant names the
// care.settings area (W8), settings only, never the records. The page asks the database and shows what it answers: the portal does not
// decide who is let in (a platform admin with no grant is refused there, in words, never an empty form).

export default async function CareSettingsPage() {
  const session = await getSession();
  const label = kindName(session.kind, "care", "DonorDelight");
  const header = <PageHeader title={`${label}: thank-you rules`} description="How fast each gift is thanked, and which gifts need a personal thank-you. Nothing is thanked until these are saved." />;
  const res = await loadThanksSettings(session);
  if (res.status === "no_access" || res.status === "off") {
    return (
      <>
        {header}
        <div className="cc-card px-6 py-10 text-center">
          <p className="font-display text-[22px] font-semibold text-ink">{res.status === "off" ? res.message : NO_ACCESS}</p>
        </div>
      </>
    );
  }
  if (res.status === "error") {
    return (
      <>
        {header}
        <div role="alert" className="rounded-field border border-danger/30 bg-danger-50 px-4 py-3 text-[14px] text-danger">
          Could not load the thank-you rules — {res.error.replace(/\.?$/, ".")} Reload the page to try again.
        </div>
      </>
    );
  }
  const symbol = (0).toLocaleString("en-US", { style: "currency", currency: session.center.currency, minimumFractionDigits: 0 }).replace(/[\d\s.,]/g, "") || session.center.currency;
  return (
    <>
      {header}
      <div className="cc-card px-5 py-5">
        <ThanksSettingsForm initial={res.data} currencySymbol={symbol} />
      </div>
    </>
  );
}
