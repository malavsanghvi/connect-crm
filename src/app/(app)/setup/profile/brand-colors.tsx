"use client";

import { useState } from "react";

import { ActionForm } from "@/components/action-form";
import { contrastVerdict, parseHexColor, textOn } from "@/lib/setup";

import { saveBrandColorsAction } from "../actions";

type Logos = { logo: string | null; mark: string | null; logoDark: string | null; emailHeader: string | null };

function ColorField({ name, label, value, onChange }: { name: string; label: string; value: string; onChange: (v: string) => void }) {
  const valid = parseHexColor(value) !== null;
  return (
    <div>
      <label className="crm-label" htmlFor={`color-${name}`}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={valid ? `#${value.replace(/^#/, "").toLowerCase()}` : "#000000"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-10 w-12 cursor-pointer rounded-[8px] border border-line-input bg-white p-1"
        />
        <input id={`color-${name}`} name={name} className="crm-input w-32 font-mono uppercase" value={value} onChange={(e) => onChange(e.target.value)} maxLength={7} />
      </div>
      {!valid ? <p className="crm-hint text-danger">Use a hex code like #1B2C5C.</p> : null}
    </div>
  );
}

function Verdict({ fg, bg, what }: { fg: string; bg: string; what: string }) {
  const v = contrastVerdict(fg, bg, what);
  if (!v) return null;
  return (
    <li className={v.ok ? "text-success-900" : v.level === "AA large" ? "text-brown-900" : "text-danger"} data-contrast={v.level}>
      {v.ok ? "✓" : "!"} {v.text}
    </li>
  );
}

function Mark({ url, name, bg, fg, size }: { url: string | null; name: string; bg: string; fg: string; size: number }) {
  if (url) {
    // A tenant-uploaded file on the Supabase host.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={`${name} logo`} style={{ height: size, width: "auto" }} />;
  }
  return (
    <span style={{ height: size, minWidth: size, background: bg, color: fg, fontSize: Math.round(size * 0.34) }} className="inline-flex items-center justify-center rounded-[8px] px-1 font-extrabold">
      {name.slice(0, 4).toUpperCase()}
    </span>
  );
}

/**
 * Brand colors with a live WCAG contrast check and a live preview of the
 * portal header, the member app header, an email header and a statement header.
 */
export function BrandColors({ initial, logos, name, shortName }: { initial: { primary: string; accent: string }; logos: Logos; name: string; shortName: string }) {
  const [primary, setPrimary] = useState(initial.primary);
  const [accent, setAccent] = useState(initial.accent);
  const p = parseHexColor(primary) ? `#${primary.replace(/^#/, "")}` : "#1B2C5C";
  const a = parseHexColor(accent) ? `#${accent.replace(/^#/, "")}` : "#C9731C";
  const onP = textOn(p);
  const onA = textOn(a);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ActionForm action={saveBrandColorsAction} submitLabel="Save colors" pendingLabel="Saving…" buttonsClassName="mt-3">
        <div className="flex flex-wrap gap-4">
          <ColorField name="primary" label="Primary color" value={primary} onChange={setPrimary} />
          <ColorField name="accent" label="Accent color" value={accent} onChange={setAccent} />
        </div>
        <p className="crm-label mt-4">Readability (WCAG)</p>
        <ul className="flex flex-col gap-1 text-[12px]" aria-live="polite">
          <Verdict fg={onP} bg={p} what={`${onP === "#FFFFFF" ? "White" : "Dark"} text on the primary color`} />
          <Verdict fg={p} bg="#FFFFFF" what="Primary color as text on white" />
          <Verdict fg={onA} bg={a} what={`${onA === "#FFFFFF" ? "White" : "Dark"} text on the accent color`} />
          <Verdict fg={a} bg="#FFFFFF" what="Accent color as text on white" />
        </ul>
      </ActionForm>

      <div className="flex flex-col gap-3" aria-label="Brand preview">
        <p className="crm-label">Preview</p>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Portal header</p>
          <div className="flex items-center gap-3 rounded-[10px] border border-line bg-white px-3 py-2">
            <Mark url={logos.mark ?? logos.logo} name={shortName} bg={p} fg={onP} size={30} />
            <span className="text-[14px] font-bold text-ink">Community Connect</span>
            <span className="ml-auto rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: p, color: onP }}>
              {shortName}
            </span>
          </div>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Member app header</p>
          <div className="flex max-w-[320px] items-center gap-2.5 rounded-[18px] px-3 py-3" style={{ background: p, color: onP }}>
            <Mark url={logos.logoDark ?? logos.mark ?? logos.logo} name={shortName} bg={a} fg={onA} size={34} />
            <div className="leading-tight">
              <p className="text-[13px] font-extrabold uppercase tracking-wide">{name}</p>
              <p className="text-[11px] opacity-80">Jai Jinendra</p>
            </div>
          </div>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Email header</p>
          <div className="max-w-[420px] overflow-hidden rounded-[10px] border border-line bg-white">
            {logos.emailHeader ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logos.emailHeader} alt={`${name} email header`} className="block w-full" />
            ) : (
              <div className="flex items-center gap-2 px-4 py-3" style={{ background: p, color: onP }}>
                <Mark url={logos.logoDark ?? logos.logo} name={shortName} bg={a} fg={onA} size={26} />
                <span className="text-[14px] font-bold">{name}</span>
              </div>
            )}
            <div className="px-4 py-2 text-[12px] text-ink-2">
              Your RSVP is confirmed. <span style={{ color: a, fontWeight: 700 }}>View tickets</span>
            </div>
          </div>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Statement header</p>
          <div className="max-w-[420px] rounded-[4px] border border-line bg-white px-4 py-3 shadow-sm">
            <div className="flex items-center justify-between border-b-2 pb-2" style={{ borderColor: p }}>
              <Mark url={logos.logo} name={shortName} bg={p} fg={onP} size={28} />
              <span className="text-[12px] font-bold" style={{ color: p }}>
                Year-end giving statement
              </span>
            </div>
            <p className="mt-2 text-[11px] text-muted">{name} · Tax year {new Date().getFullYear() - 1}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
