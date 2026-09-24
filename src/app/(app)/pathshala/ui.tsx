import Link from "next/link";
import type { ReactNode } from "react";

import { ActionForm, type FormAction } from "@/components/action-form";
import { Alert, Badge, ChipLinks, PageHeader, Stat, buttonClass, type ButtonSize, type ButtonVariant, type StatTone, type Tone } from "@/components/ui";

// Small building blocks shared by the Pathshala pages (moved from
// connect-admin), drawn with the portal's prototype components: pill
// buttons, chip filters, coloured status text, #F6F2EA-header tables.

/** The module title block. Every Pathshala page is titled "Pathshala" (prototype), unless it is one record's page. */
export function PathshalaHeader({
  title = "Pathshala",
  description,
  actions,
  back,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** A record page: "← {label}" above the title, and no module tabs. */
  back?: { href: string; label: string };
}) {
  return (
    <PageHeader
      title={title}
      description={description}
      actions={actions}
      tabs={!back}
      eyebrow={
        back ? (
          <Link href={back.href} className="crm-link font-semibold">
            ← {back.label}
          </Link>
        ) : undefined
      }
    />
  );
}

/** connect-admin badge tones → the portal's coloured status text. */
export type PTone = Tone | "muted" | "maroon" | "caution" | "ok";
const TONE: Record<PTone, Tone> = {
  neutral: "neutral",
  navy: "navy",
  success: "success",
  warning: "warning",
  danger: "danger",
  purple: "purple",
  muted: "neutral",
  maroon: "danger",
  caution: "warning",
  ok: "success",
};

export function PBadge({ tone = "neutral", children }: { tone?: PTone; children: ReactNode }) {
  return <Badge tone={TONE[tone]}>{children}</Badge>;
}

const STAT_TONE: Record<string, StatTone> = {
  navy: "navy",
  purple: "purple",
  maroon: "maroon",
  success: "success",
  danger: "danger",
  warning: "brown",
};

export function PStat({ label, value, sub, tone = "navy" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: keyof typeof STAT_TONE }) {
  return <Stat label={label} value={value} hint={sub} tone={STAT_TONE[tone] ?? "navy"} />;
}

/** A labelled form control (the label wraps the control, so no ids are needed). */
export function PField({ label, hint, children, className = "" }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="crm-label">{label}</span>
      {children}
      {hint ? <span className="crm-hint block">{hint}</span> : null}
    </label>
  );
}

export function Checkbox({
  name,
  label,
  defaultChecked,
  value = "on",
  hint,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  value?: string;
  hint?: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="mt-0.5 h-5 w-5 shrink-0 accent-navy" />
      <span>
        <span className="text-[13px] font-bold text-ink">{label}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) {
  const c = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[cols];
  return <div className={`grid grid-cols-1 gap-4 ${c}`}>{children}</div>;
}

export function Select({
  name,
  options,
  defaultValue,
  required,
  placeholder,
  id,
}: {
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string | null;
  required?: boolean;
  placeholder?: string;
  id?: string;
}) {
  return (
    <select id={id} name={name} defaultValue={defaultValue ?? ""} required={required} className="crm-input">
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A collapsible section (a secondary form under a row). */
export function Details({ summary, children, open }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-[10px] border border-line bg-white">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[13px] font-bold text-navy">
        <span>{summary}</span>
        <span aria-hidden className="text-muted transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="border-t border-line-soft p-3">{children}</div>
    </details>
  );
}

export function Notice({ tone = "navy", children }: { tone?: "navy" | "warning" | "danger" | "success"; children: ReactNode }) {
  const t = { navy: "info", warning: "warning", danger: "danger", success: "success" } as const;
  return <Alert tone={t[tone]}>{children}</Alert>;
}

/** A page's data could not be read: say what and why, and offer a retry. Never an empty table. */
export function LoadProblem({ message, retryHref }: { message: string; retryHref?: string }) {
  return (
    <Alert
      tone="danger"
      title="Something went wrong"
      action={
        <a href={retryHref ?? ""} className={buttonClass("bad", "xs")}>
          Try again
        </a>
      }
    >
      {message}
    </Alert>
  );
}

/** Shown instead of a page when the user's roles don't reach it. */
export function PNoAccess({ area, children }: { area?: string; children?: ReactNode }) {
  return (
    <div className="cc-card px-6 py-10 text-center">
      <p className="font-display text-[22px] font-semibold text-ink">You don&apos;t have access to this area</p>
      <p className="mx-auto mt-2 max-w-lg text-[13px] text-muted">
        {children ?? (
          <>
            Your role doesn&apos;t include {area ?? "this area"}. Ask your center admin to grant you a role that includes it (Settings →
            Roles and access).
          </>
        )}
      </p>
    </div>
  );
}

/** Key/value summary (label above value). */
export function PDefinitionList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted">{k}</dt>
          <dd className="mt-0.5 text-[13px] text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Filter chips with counts ("Requested 4"). */
export function ViewChips({ tabs, active, label = "Views" }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string; label?: string }) {
  return (
    <ChipLinks
      label={label}
      active={active}
      items={tabs.map((t) => ({
        key: t.key,
        href: t.href,
        label: t.count === undefined ? t.label : `${t.label} ${t.count}`,
      }))}
    />
  );
}

/** One pill button bound to a Server Action, with optional hidden fields and a confirmation modal. */
export function ActionButton({
  action,
  label,
  fields,
  variant = "ghost",
  size = "xs",
  confirm,
  pendingLabel,
}: {
  action: FormAction;
  label: string;
  fields?: Record<string, string>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  confirm?: string;
  pendingLabel?: string;
}) {
  return (
    <ActionForm
      action={action}
      submitLabel={label}
      variant={variant}
      size={size}
      confirmMessage={confirm}
      pendingLabel={pendingLabel ?? "Working…"}
      className="inline-block max-w-full align-middle"
    >
      {fields ? Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
    </ActionForm>
  );
}

/** Chips to switch between terms (hidden when there is only one). */
export function TermSwitcher({
  terms,
  activeId,
  basePath,
}: {
  terms: { id: string; name: string; status: string }[];
  activeId: string | null;
  basePath: string;
}) {
  if (terms.length <= 1) return null;
  return (
    <ChipLinks
      label="Term"
      active={activeId ?? ""}
      items={terms.map((t) => ({
        key: t.id,
        href: `${basePath}?term=${t.id}`,
        label: (
          <>
            {t.name}
            <span className="ml-1.5 text-[11px] font-normal opacity-80">{t.status}</span>
          </>
        ),
      }))}
    />
  );
}

/** The whole page when the user's roles don't reach it: module header + the no-access card. */
export function PNoAccessPage({ area, children }: { area?: string; children?: ReactNode }) {
  return (
    <>
      <PathshalaHeader />
      <PNoAccess area={area}>{children}</PNoAccess>
    </>
  );
}

/** The whole page when its data could not be read: module header + the plain-English reason and a retry. */
export function LoadProblemPage({ message, retryHref }: { message: string; retryHref?: string }) {
  return (
    <>
      <PathshalaHeader />
      <LoadProblem message={message} retryHref={retryHref} />
    </>
  );
}

/** A heading inside a Pathshala tab (e.g. the Committee's sections): 20px title, sub-line, pill actions. */
export function SectionHeading({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 flex-1">
        {back ? (
          <Link href={back.href} className="crm-link text-[13px] font-semibold">
            ← {back.label}
          </Link>
        ) : null}
        <h2 className="font-display text-[20px] font-semibold text-ink">{title}</h2>
        {description ? <div className="mt-0.5 text-[13px] text-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
