"use client";

import { useMemo, useState } from "react";

import { ActionForm } from "@/components/action-form";
import { validateRulesJson } from "@/lib/center-rules";

import { saveCenterSettingsAction } from "./actions";

type Obj = Record<string, unknown>;

const BRANDING_FIELDS = [
  { key: "primary", label: "Primary colour", color: true },
  { key: "accent", label: "Accent colour", color: true },
  { key: "background", label: "Background colour", color: true },
  { key: "display_font", label: "Display font", color: false },
  { key: "body_font", label: "Body font", color: false },
  { key: "logo_url", label: "Logo URL (https)", color: false },
] as const;

const KNOWN_FLAGS: Record<string, string> = {
  store: "Satvik Store",
  bolis: "Bolis",
  pathshala: "Pathshala",
  gyan_path: "Gyan Path",
  my_jain_way: "My Jain Way",
  saathi: "Saathi",
  niva: "Niva assistant",
  recurring_giving: "Recurring giving",
  surveys: "Surveys",
};

export function CenterSettingsForm({ branding, flags, rules }: { branding: Obj; flags: Obj; rules: Obj }) {
  const [brand, setBrand] = useState<Obj>(branding);
  const [flagState, setFlagState] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const k of new Set([...Object.keys(KNOWN_FLAGS), ...Object.keys(flags)])) out[k] = flags[k] === true;
    return out;
  });
  const [rulesText, setRulesText] = useState(() => JSON.stringify(rules, null, 2));
  const validation = useMemo(() => validateRulesJson(rulesText), [rulesText]);

  return (
    <ActionForm action={saveCenterSettingsAction} submitLabel="Save settings" pendingLabel="Saving…">
      <input type="hidden" name="branding" value={JSON.stringify(brand)} />
      <input type="hidden" name="feature_flags" value={JSON.stringify(flagState)} />

      <fieldset className="mb-6">
        <legend className="mb-2 font-display text-lg font-semibold">Branding</legend>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {BRANDING_FIELDS.map((f) => {
            const value = typeof brand[f.key] === "string" ? (brand[f.key] as string) : "";
            return (
              <div key={f.key}>
                <label htmlFor={`b-${f.key}`} className="crm-label">
                  {f.label}
                </label>
                <div className="flex gap-2">
                  {f.color ? (
                    <input
                      type="color"
                      aria-label={`${f.label} picker`}
                      value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
                      onChange={(e) => setBrand({ ...brand, [f.key]: e.target.value.toUpperCase() })}
                      className="h-11 w-14 cursor-pointer rounded-lg border border-line-strong bg-white"
                    />
                  ) : null}
                  <input
                    id={`b-${f.key}`}
                    value={value}
                    onChange={(e) => setBrand({ ...brand, [f.key]: e.target.value })}
                    className="crm-input"
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="crm-hint">Other branding keys already stored are kept unchanged.</p>
      </fieldset>

      <fieldset className="mb-6">
        <legend className="mb-2 font-display text-lg font-semibold">Features</legend>
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
          {Object.keys(flagState).map((k) => (
            <label key={k} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={flagState[k]}
                onChange={(e) => setFlagState({ ...flagState, [k]: e.target.checked })}
                className="h-5 w-5"
              />
              {KNOWN_FLAGS[k] ?? k}
              <span className="font-mono text-xs text-muted">{k}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mb-4">
        <legend className="mb-2 font-display text-lg font-semibold">Rules</legend>
        <p className="mb-2 text-sm text-muted">
          The center&apos;s rule bag: membership references, voting eligibility, lunch slots, boli steps, points, identifier labels, bank format and more.
          Unknown keys are allowed; known keys are type-checked.
        </p>
        <label htmlFor="rules" className="sr-only">
          Rules JSON
        </label>
        <textarea
          id="rules"
          name="rules"
          value={rulesText}
          onChange={(e) => setRulesText(e.target.value)}
          spellCheck={false}
          rows={24}
          className="crm-input mono"
          aria-invalid={!validation.ok}
          aria-describedby="rules-status"
        />
        <div id="rules-status" aria-live="polite" className="mt-2 text-sm">
          {validation.ok ? (
            <p className="text-success">Valid rules.</p>
          ) : (
            <ul className="list-disc pl-5 text-danger">
              {validation.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      </fieldset>
    </ActionForm>
  );
}
