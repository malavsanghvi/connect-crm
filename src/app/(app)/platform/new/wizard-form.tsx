"use client";

import Link from "next/link";
import { useState } from "react";

import { ActionForm } from "@/components/action-form";
import { ChipGroup } from "@/components/controls";
import { InfoBox, buttonClass } from "@/components/ui";
import { IMPORT_SOURCES, PRIMARY_COLORS, slugify, TIME_ZONES, TRADITIONS } from "@/lib/center-wizard";

import { goLiveAction, saveWizardStepAction } from "../actions";

export type WizardCenter = {
  id: string;
  name: string;
  slug: string;
  primary: string;
  logoUrl: string;
  timeZone: string;
  tradition: string;
  stateRegion: string;
  basis: string;
  importSource: string;
};

function Field({ label, wide = false, hint, children }: { label: string; wide?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <p className="crm-label">{label}</p>
      {children}
      {hint ? <p className="crm-hint">{hint}</p> : null}
    </div>
  );
}

export function WizardForm({ step, center, roleCount, locked }: { step: number; center: WizardCenter | null; roleCount: number | null; locked: boolean }) {
  const [name, setName] = useState(center?.name ?? "");
  const [slug, setSlug] = useState(center?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(center));
  const back =
    step > 1 ? (
      <Link href={`/platform/new?${center ? `center=${center.id}&` : ""}step=${step - 1}`} className={`${buttonClass("ghost")} order-first`}>
        Back
      </Link>
    ) : null;
  const needsCenter = step > 1 && !center;
  const blocked = needsCenter || locked;

  const hidden = (
    <>
      <input type="hidden" name="step" value={step} />
      <input type="hidden" name="center" value={center?.id ?? ""} />
    </>
  );

  if (step === 6) {
    return (
      <ActionForm
        action={goLiveAction}
        submitLabel="Go live"
        pendingLabel="Going live…"
        confirmKicker="Go live"
        confirmMessage={`Take ${center?.name ?? "this center"} live?\nIts members can find it and sign in. The app does not run the checks above — confirm the platform team has done them.`}
        buttonsClassName="mt-4 justify-end"
        submitDisabled={blocked}
        extraButtons={back}
      >
        {hidden}
        <div className="grid grid-cols-1 gap-3">
          <Field label="Checks" wide>
            <InfoBox>Login success above 95% · check-in rehearsal · test QuickBooks posts approved · pilot with 30–50 families</InfoBox>
          </Field>
        </div>
        {needsCenter ? <p className="crm-hint mt-3">Start with step 1, where the center is created.</p> : null}
      </ActionForm>
    );
  }

  return (
    <ActionForm
      action={saveWizardStepAction}
      submitLabel="Continue"
      pendingLabel="Saving…"
      buttonsClassName="mt-4 justify-end"
      submitDisabled={blocked}
      extraButtons={back}
    >
      {hidden}
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {step === 1 ? (
          <>
            <Field label="Center name">
              <input
                name="name"
                className="crm-input"
                aria-label="Center name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                placeholder="Design partner center A"
                required
              />
            </Field>
            <Field label="Public URL" hint="Letters, digits and hyphens. Members find the center here.">
              <div className="flex items-center gap-1">
                <span className="text-[14px] text-muted">/c/</span>
                <input
                  name="slug"
                  aria-label="Public URL"
                  className="crm-input font-mono"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                  placeholder="partner-a"
                  required
                />
              </div>
            </Field>
            <Field label="Logo" hint="Upload PNG or SVG to your file host, then paste its https address. Optional.">
              <input name="logo_url" aria-label="Logo address" className="crm-input" defaultValue={center?.logoUrl ?? ""} placeholder="https://…" />
            </Field>
            <Field label="Primary color">
              <ChipGroup
                name="primary"
                label="Primary color"
                defaultValue={center?.primary || PRIMARY_COLORS[0].value}
                options={PRIMARY_COLORS.map((c) => ({ value: c.value, label: c.label }))}
              />
            </Field>
            <Field label="Time zone">
              <select name="time_zone" aria-label="Time zone" className="crm-input" defaultValue={center?.timeZone ?? "America/Chicago"}>
                {TIME_ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z.replace("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Field label="Tradition" wide>
              <ChipGroup
                name="tradition"
                label="Tradition"
                defaultValue={center?.tradition && center.tradition !== "other" ? center.tradition : "sthanakvasi"}
                options={TRADITIONS.map((t) => ({ value: t.value, label: t.label }))}
              />
            </Field>
            <Field label="Includes" wide>
              <InfoBox>Sutras and audio, pachchakhan, Gyan Path goals, panchang tables · center can override</InfoBox>
            </Field>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Field label="Payments">
              <InfoBox>Connect account · business verification — set up by the center after it is created</InfoBox>
            </Field>
            <Field label="QuickBooks">
              <InfoBox>Sign in and authorize · map accounts — from the center&apos;s Accounting › QuickBooks page</InfoBox>
            </Field>
            <Field label="Accounting basis">
              <ChipGroup
                name="basis"
                label="Accounting basis"
                defaultValue={center?.basis || "cash"}
                options={[
                  { value: "cash", label: "Cash" },
                  { value: "accrual", label: "Accrual" },
                ]}
              />
            </Field>
            <Field label="Sales tax" hint="Sales tax follows the center's state (two letters).">
              <input name="state_region" aria-label="State" className="crm-input w-24 uppercase" maxLength={2} defaultValue={center?.stateRegion ?? ""} placeholder="TX" />
            </Field>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <Field label="Source system" wide>
              <ChipGroup
                name="import_source"
                label="Source system"
                defaultValue={center?.importSource || "spreadsheet"}
                options={IMPORT_SOURCES.map((s) => ({ value: s.value, label: s.label }))}
              />
            </Field>
            <Field label="Mapping" wide>
              <InfoBox>Households, people and gifts are mapped in a dry run first, with duplicates flagged. The import tool is run by the platform team; it is not in the portal yet.</InfoBox>
            </Field>
          </>
        ) : null}

        {step === 5 ? (
          <>
            <Field label="Center admin">
              <input aria-label="Center admin email" className="crm-input" placeholder="admin@partner-a.org" disabled />
            </Field>
            <Field label="Treasurer">
              <input aria-label="Treasurer email" className="crm-input" placeholder="treasurer@partner-a.org" disabled />
            </Field>
            <Field label="Default roles" wide>
              <InfoBox>
                {roleCount === null ? "The default roles" : `${roleCount} default roles`} are shared by every center and ready to grant; custom roles later.
              </InfoBox>
            </Field>
            <p className="crm-hint sm:col-span-2">
              Inviting admins by email is not available yet. Once the center admin has signed in once, grant them Center admin from that
              center&apos;s Settings › Roles & entitlements.
            </p>
          </>
        ) : null}
      </div>
      {needsCenter ? <p className="crm-hint mt-3">Start with step 1, where the center is created.</p> : null}
    </ActionForm>
  );
}
