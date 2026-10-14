import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FrontDoor } from "@/components/onboarding-front/front-door";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { sampleContext, sampleFiles, sampleModel, SAMPLE_PEOPLE_LABEL } from "@/lib/onboarding-front/fixtures";

export const metadata: Metadata = { title: "Bring your data in · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * DEV ONLY. The onboarding front door with invented sample data for a neutral community, drawn without a database or a
 * session so its look can be checked and screenshotted. `?sample=empty` shows a community that has loaded nothing yet.
 * Returns notFound() in production (and the proxy lets /dev through without a session only outside production).
 */
export default async function OnboardingStartPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const empty = sp.sample === "empty";
  const ctx = sampleContext();
  const peopleWord = SAMPLE_PEOPLE_LABEL.toLowerCase();
  return (
    <div className="min-h-screen bg-canvas">
      <div className="flex justify-center bg-white pb-1 pt-[5px]">
        <span className="rounded-[10px] bg-danger px-2.5 py-0.5 text-[10px] font-bold tracking-[0.08em] text-white">DEV PREVIEW · SAMPLE DATA</span>
      </div>
      <FrontDoor
        model={sampleModel(empty ? "empty" : "full")}
        recognise={ctx}
        peopleWord={peopleWord}
        initialFiles={empty ? [] : sampleFiles(ctx)}
        links={{
          self: "/dev/onboarding-start",
          setup: "/setup",
          guided: "/setup/onboarding",
          dataImport: "/settings/import/new",
          bank: "/giving/payments/bank",
          qboSetup: "/accounting/qbo/setup",
          peopleTemplate: "/setup/onboarding/template?kind=people&format=xlsx",
          donationsTemplate: "/setup/onboarding/template?kind=donations&format=xlsx",
        }}
      />
    </div>
  );
}
