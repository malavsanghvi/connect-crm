import type { Metadata } from "next";

import { BlockGrid, Card, DefinitionList, NoAccess, PageHeader } from "@/components/ui";
import { isPlainObject } from "@/lib/center-rules";
import { kindName, moduleNotOffered } from "@/lib/kind";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { lunchRulesText, readRuleSettings, rulesVersion } from "@/lib/settings-rules";

import { AdvancedRulesForm, BolisStoreForm, BrandingForm, GivingForm, LunchForm, MembershipForm, PointsForm } from "./rules-forms";

export const metadata: Metadata = { title: "Rules · Settings" };

const TIER_REACH: Record<string, string> = {
  community: "Any member",
  yearly: "Yearly or Life",
  life: "Life only",
};

export default async function RulesPage() {
  const session = await getSession();
  const header = <PageHeader title="Settings" description="Center rules · each change is versioned and audited" />;
  if (!canAccess(session, "centerSettings")) {
    return (
      <>
        {header}
        <NoAccess area="Center rules" access="centerSettings" />
      </>
    );
  }
  const { db, center } = session;
  const settings = readRuleSettings(center.rules);
  const version = rulesVersion(center.rules);

  // Reference tiers live on the membership types, not in the rule bag.
  const types = await db.from("membership_types").select("tier, reference_required, reference_tier_min, active").eq("center_id", center.id);
  if (types.error) console.error("[settings/rules] could not load membership types:", types.error);
  const tierInfo = (tier: "yearly" | "life"): string => {
    if (types.error) return "Could not load the membership types — reload to try again";
    const t = (types.data ?? []).find((x) => x.tier === tier && x.active);
    if (!t) return `No ${tier} membership type is set up`;
    if (!t.reference_required) return "No reference needed";
    return t.reference_tier_min ? (TIER_REACH[t.reference_tier_min] ?? t.reference_tier_min) : "Any member";
  };

  // Reaching this point means settings.manage, which is what saving needs.
  const readOnly = false;
  const common = { version, readOnly };

  // Parts of these rules belong to modules some kinds of organization never have (Bolis, My Jain Way, Gyan Path, Pathshala).
  // They are not shown for such a kind; what is stored for them goes back unchanged. A Jain Center has them all.
  const { kind } = session;
  const hasBolis = !moduleNotOffered(kind, "bolis");
  const hasStore = !moduleNotOffered(kind, "store");
  const hasPoints = !moduleNotOffered(kind, "jain_way") || !moduleNotOffered(kind, "gyan_path");
  const hiddenFlags = [
    ...(!hasBolis ? ["bolis"] : []),
    ...(!hasStore ? ["store"] : []),
    ...(moduleNotOffered(kind, "pathshala") ? ["pathshala"] : []),
    ...(moduleNotOffered(kind, "gyan_path") ? ["gyan_path"] : []),
    ...(moduleNotOffered(kind, "jain_way") ? ["my_jain_way", "saathi"] : []),
  ];

  return (
    <>
      {header}
      <BlockGrid>
        <Card span={6} title="Membership and references">
          <MembershipForm {...common} settings={settings} yearlyTier={tierInfo("yearly")} lifeTier={tierInfo("life")} />
        </Card>
        <Card span={6} title={hasBolis ? "Giving, bolis and privacy" : "Giving and privacy"}>
          <GivingForm {...common} settings={settings} showBolis={hasBolis} />
        </Card>
        <Card span={12} title="Lunch-slot rules">
          <p className="text-[13px] leading-relaxed text-ink-2">{lunchRulesText(settings)}</p>
        </Card>
        <Card span={6} title="Lunch and RSVP" description="Event defaults · each event can still set its own slot length and seats">
          <LunchForm {...common} settings={settings} />
        </Card>
        {hasBolis || hasStore ? (
          <Card span={6} title={hasBolis && hasStore ? "Bolis and store" : hasBolis ? "Bolis" : "Store"}>
            <BolisStoreForm {...common} settings={settings} currency={center.currency} showBolis={hasBolis} showStore={hasStore} />
          </Card>
        ) : null}
        {hasPoints ? (
          <Card span={6} title="Points, streaks and Saathi" description={moduleNotOffered(kind, "jain_way") ? "Standings stay private to the member" : "My Jain Way · standings stay private to the member"}>
            <PointsForm {...common} settings={settings} />
          </Card>
        ) : null}
        <Card span={6} title="Center" description="Set when the center was created · changed by the platform team">
          <DefinitionList
            items={[
              { label: "Name", value: center.name },
              { label: "Slug", value: <span className="font-mono">{center.slug}</span> },
              { label: "Short name", value: center.short_name ?? "—" },
              { label: "Time zone", value: center.time_zone },
              { label: "Currency", value: center.currency },
              { label: "Rules version", value: version === null ? "Not versioned yet" : `Version ${version}` },
            ]}
          />
        </Card>
        <Card span={12} title="Branding and features" description="The center's colours, fonts and logo, and which modules are switched on">
          <BrandingForm
            branding={isPlainObject(center.branding) ? center.branding : {}}
            flags={isPlainObject(center.feature_flags) ? center.feature_flags : {}}
            readOnly={readOnly}
            hiddenFlags={hiddenFlags}
            flagNames={{ store: kindName(kind, "store", "Satvik Store"), pathshala: kindName(kind, "pathshala", "Pathshala"), gyan_path: kindName(kind, "gyan_path", "Gyan Path") }}
          />
        </Card>
        <Card span={12}>
          <details>
            <summary className="cursor-pointer text-[14px] font-bold text-navy">Advanced · all rules as JSON</summary>
            <div className="mt-3">
              <AdvancedRulesForm rules={isPlainObject(center.rules) ? center.rules : {}} version={version} readOnly={readOnly} />
            </div>
          </details>
        </Card>
      </BlockGrid>
    </>
  );
}
