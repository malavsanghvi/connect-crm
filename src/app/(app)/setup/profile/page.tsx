import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { BlockGrid, Card, InfoBox, QueryError } from "@/components/ui";
import { isPlainObject } from "@/lib/center-rules";
import { TIME_ZONES } from "@/lib/center-wizard";
import { readPublicEnv } from "@/lib/env";
import { getSession } from "@/lib/session";
import { BRAND_FILES, LANGUAGES, MONTHS, osmEmbedUrl, osmLinkUrl, publicObjectUrl, SOCIAL_KEYS } from "@/lib/setup";

import { removeBrandFileAction, saveProfileAction, uploadBrandFileAction } from "../actions";
import { SetupHeader, setupGate } from "../_components/setup-ui";
import { BrandColors } from "./brand-colors";

export const metadata: Metadata = { title: "Profile & brand · Setup" };

const SUB = "Step 0.3 · profile, map pin and brand kit · members see these in the app, emails and statements";

function Text({ name, label, value, hint, ...rest }: { name: string; label: string; value?: string | null; hint?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value">) {
  return (
    <div>
      <label className="crm-label" htmlFor={`p-${name}`}>
        {label}
      </label>
      <input id={`p-${name}`} name={name} className="crm-input" defaultValue={value ?? ""} {...rest} />
      {hint ? <p className="crm-hint">{hint}</p> : null}
    </div>
  );
}

export default async function ProfilePage() {
  const session = await getSession();
  const gate = setupGate(session, SUB, "Profile & brand");
  if (gate) return gate;
  const { db, center } = session;
  const res = await db
    .from("org_profiles")
    .select("mission, about, website, social, public_email, public_email_verified_at, public_phone, public_phone_verified_at, office_hours, latitude, longitude, languages, fiscal_year_start_month")
    .eq("center_id", center.id)
    .maybeSingle();
  if (res.error) {
    return (
      <>
        <SetupHeader session={session} sub={SUB} />
        <QueryError what="the profile" error={res.error} retryHref="/setup/profile" />
      </>
    );
  }
  const p = res.data;
  const b = isPlainObject(center.branding) ? center.branding : {};
  const bstr = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
  const social = isPlainObject(p?.social) ? p.social : {};
  const env = readPublicEnv();
  const fileUrl = (key: string) => {
    const path = bstr(key);
    return path && env.ok ? publicObjectUrl(env.env.supabaseUrl, "branding", path) : null;
  };
  const colors = isPlainObject(b.colors) ? b.colors : {};
  const lat = p?.latitude ?? null;
  const lon = p?.longitude ?? null;
  const langs = p?.languages ?? ["en"];

  return (
    <>
      <SetupHeader session={session} sub={SUB} />
      <BlockGrid>
        <Card span={12} title="Profile" description="Display name, contact, map pin and languages">
          <ActionForm action={saveProfileAction} submitLabel="Save profile" pendingLabel="Saving…" buttonsClassName="mt-4">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
              <Text name="name" label="Display name" value={center.name} required maxLength={120} />
              <Text name="short_name" label="Short name" value={center.short_name} maxLength={20} hint={`Shown as "${center.short_name || "JSH"} points" and in tight spaces.`} />
              <div>
                <p className="crm-label">Web address</p>
                <InfoBox>
                  <span className="font-mono">/c/{center.slug}</span>
                </InfoBox>
                <p className="crm-hint">Community Connect changes the address if needed.</p>
              </div>
              <div>
                <label className="crm-label" htmlFor="p-time_zone">
                  Time zone
                </label>
                <select id="p-time_zone" name="time_zone" className="crm-input" defaultValue={center.time_zone}>
                  {TIME_ZONES.map((z) => (
                    <option key={z} value={z}>
                      {z.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
              <Text name="currency" label="Currency" value={center.currency} maxLength={3} className="crm-input w-24 uppercase" />
              <div>
                <label className="crm-label" htmlFor="p-fy">
                  Fiscal year starts in
                </label>
                <select id="p-fy" name="fiscal_year_start_month" className="crm-input" defaultValue={String(p?.fiscal_year_start_month ?? 1)}>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
                <p className="crm-hint">Accounting periods and year-end statements follow it.</p>
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="crm-label" htmlFor="p-mission">
                  Mission
                </label>
                <textarea id="p-mission" name="mission" className="crm-input min-h-[60px]" maxLength={1000} defaultValue={p?.mission ?? ""} />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="crm-label" htmlFor="p-about">
                  About
                </label>
                <textarea id="p-about" name="about" className="crm-input min-h-[90px]" maxLength={5000} defaultValue={p?.about ?? ""} />
              </div>
              <Text name="website" label="Website" value={p?.website} placeholder="https://" />
              <Text
                name="public_email"
                label="Public email"
                type="email"
                value={p?.public_email}
                hint={p?.public_email_verified_at ? "Verified." : "Not verified yet — checking it by a code arrives with email sending (Setup step 1.3)."}
              />
              <Text
                name="public_phone"
                label="Public phone"
                value={p?.public_phone}
                placeholder="(713) 555-0100"
                hint={p?.public_phone_verified_at ? "Verified." : "Not verified yet — checking it by a code arrives with texting (Setup step 1.4)."}
              />
              <Text name="office_hours" label="Office hours" value={p?.office_hours} maxLength={500} placeholder="Sat–Sun 9 am – 1 pm" />
              <Text name="address" label="Address" value={bstr("address")} maxLength={300} placeholder="Street, city, state, ZIP" hint="Members see it in the app's Guide › Contact." />
              {SOCIAL_KEYS.map((s) => (
                <Text key={s.key} name={`social_${s.key}`} label={`${s.label} (optional)`} value={typeof social[s.key] === "string" ? (social[s.key] as string) : ""} placeholder="https://" />
              ))}
              <fieldset className="md:col-span-2 xl:col-span-3">
                <legend className="crm-label">Languages offered</legend>
                <div className="flex flex-wrap gap-3">
                  {LANGUAGES.map((l) => (
                    <label key={l.value} className="flex items-center gap-1.5 text-[13px]">
                      <input type="checkbox" name="languages" value={l.value} defaultChecked={langs.includes(l.value)} />
                      {l.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="md:col-span-2 xl:col-span-3">
                <legend className="crm-label">Map pin</legend>
                <p className="crm-hint mb-2">
                  The pin drives the daily timings (sunrise, navkarsi, chauvihar). Find the building on{" "}
                  <a href={lat !== null && lon !== null ? osmLinkUrl(lat, lon) : "https://www.openstreetmap.org/"} target="_blank" rel="noreferrer" className="crm-link">
                    OpenStreetMap
                  </a>
                  , right-click it and choose “Show address” to copy its latitude and longitude.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Text name="latitude" label="Latitude" value={lat === null ? "" : String(lat)} placeholder="29.7604" inputMode="decimal" className="crm-input w-40" />
                  <Text name="longitude" label="Longitude" value={lon === null ? "" : String(lon)} placeholder="-95.3698" inputMode="decimal" className="crm-input w-40" />
                </div>
                {lat !== null && lon !== null ? (
                  <iframe
                    title={`Map pin for ${center.name}`}
                    src={osmEmbedUrl(lat, lon)}
                    className="mt-3 h-[240px] w-full max-w-[560px] rounded-[10px] border border-line"
                    loading="lazy"
                  />
                ) : (
                  <p className="crm-hint mt-2">No pin yet. Save a latitude and longitude to see it on the map.</p>
                )}
              </fieldset>
            </div>
          </ActionForm>
        </Card>

        <div id="brand" className="col-span-12 scroll-mt-20">
          <Card title="Brand kit · logos" description="Uploaded, not linked · PNG, JPEG, SVG or WebP up to 5 MB">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {BRAND_FILES.map((f) => {
                const url = fileUrl(f.key);
                return (
                  <div key={f.key} className="rounded-[12px] border border-line-soft bg-ground p-3" data-brand-file={f.key} data-has-file={String(Boolean(url))}>
                    <p className="text-[13px] font-bold">{f.label}</p>
                    <p className="crm-hint">{f.hint}</p>
                    <div className={`my-2 flex h-20 items-center justify-center rounded-[8px] border border-line ${f.key === "logo_dark_path" ? "bg-navy" : "bg-white"}`}>
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={`${f.label} of ${center.name}`} className="max-h-16 max-w-[90%]" />
                      ) : (
                        <span className="text-[12px] text-faint">Not uploaded</span>
                      )}
                    </div>
                    <ActionForm action={uploadBrandFileAction} submitLabel={url ? "Replace" : "Upload"} pendingLabel="Uploading…" size="sm" resetOnSuccess buttonsClassName="mt-2">
                      <input type="hidden" name="key" value={f.key} />
                      <input name="file" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" aria-label={`${f.label} file`} className="crm-input text-[12px]" required />
                    </ActionForm>
                    {url ? (
                      <ActionForm
                        action={removeBrandFileAction}
                        submitLabel="Remove"
                        variant="ghost"
                        size="xs"
                        buttonsClassName="mt-1"
                        confirmMessage={`Stop using the ${f.label.toLowerCase()}?\nThe file is kept; the brand kit just stops showing it.`}
                      >
                        <input type="hidden" name="key" value={f.key} />
                      </ActionForm>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <Card span={12} title="Brand kit · colors and preview" description="Automatic readability check · the preview updates as you choose">
          <BrandColors
            initial={{
              primary: typeof colors.primary === "string" ? colors.primary : typeof b.primary === "string" ? (b.primary as string) : "#1B2C5C",
              accent: typeof colors.accent === "string" ? colors.accent : "#C9731C",
            }}
            logos={{ logo: fileUrl("logo_path"), mark: fileUrl("mark_path"), logoDark: fileUrl("logo_dark_path"), emailHeader: fileUrl("email_header_path") }}
            name={center.name}
            shortName={center.short_name || center.slug.toUpperCase()}
          />
        </Card>
      </BlockGrid>
    </>
  );
}
