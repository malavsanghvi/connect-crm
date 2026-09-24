import Link from "next/link";
import type { ReactNode } from "react";

import { explainError } from "@/lib/errors";
import { ACCESS, type AccessKey } from "@/lib/permissions";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-sm text-muted">{eyebrow}</div> : null}
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-[0.9375rem] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className = "",
  padded = true,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`rounded-xl border border-line bg-card shadow-[0_1px_0_rgba(30,28,24,0.03)] ${className}`}>
      {title || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            {title ? <h2 className="font-display text-lg font-semibold text-ink">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}

/** Horizontal scroll wrapper so wide tables never break the layout. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export type Tone = "neutral" | "navy" | "success" | "warning" | "danger" | "purple";

const toneClass: Record<Tone, string> = {
  neutral: "bg-subtle text-muted border-line",
  navy: "bg-navy-50 text-navy border-navy/20",
  success: "bg-success-50 text-success border-success/25",
  warning: "bg-saffron-50 text-brown border-saffron/30",
  danger: "bg-maroon-50 text-maroon border-maroon/25",
  purple: "bg-purple-50 text-purple border-purple/25",
};

/** Status chip. Always carries text, never colour alone. */
export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone = "danger",
  title,
  children,
  action,
}: {
  tone?: "danger" | "warning" | "success" | "info";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const styles = {
    danger: "border-maroon/30 bg-maroon-50 text-maroon",
    warning: "border-saffron/40 bg-saffron-50 text-brown",
    success: "border-success/30 bg-success-50 text-success",
    info: "border-navy/20 bg-navy-50 text-navy",
  }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "mt-1" : ""}>{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** A read failed: say what, why, and offer a retry. Never an empty table. */
export function QueryError({ what, error, retryHref }: { what: string; error: unknown; retryHref?: string }) {
  return (
    <Alert
      tone="danger"
      title={`Could not load ${what}`}
      action={
        retryHref ? (
          <a href={retryHref} className="crm-link font-semibold">
            Try again
          </a>
        ) : null
      }
    >
      {capitalize(explainError(error))}.
    </Alert>
  );
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Shown instead of an empty table when the user's roles don't reach this data. */
export function NoAccess({ area, access, extra }: { area: string; access: AccessKey; extra?: ReactNode }) {
  const need = ACCESS[access];
  return (
    <div className="rounded-xl border border-line bg-card px-6 py-10 text-center">
      <p className="font-display text-xl font-semibold text-navy">You don&apos;t have access to this area</p>
      <p className="mx-auto mt-2 max-w-lg text-sm text-muted">
        {area} needs one of these permissions: <strong className="text-ink">{need.join(", ")}</strong>. Ask your center
        admin to grant you a role that includes it (Settings → Roles and access).
      </p>
      {extra ? <div className="mt-4 text-sm">{extra}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-lg text-sm text-muted">{children}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  href,
  hint,
  tone = "navy",
}: {
  label: string;
  value: ReactNode;
  href?: string;
  hint?: ReactNode;
  tone?: "navy" | "saffron" | "success" | "maroon" | "purple";
}) {
  const accent = {
    navy: "border-t-navy",
    saffron: "border-t-saffron",
    success: "border-t-success",
    maroon: "border-t-maroon",
    purple: "border-t-purple",
  }[tone];
  const body = (
    <div className={`h-full rounded-xl border border-line border-t-4 ${accent} bg-card p-5 transition-colors hover:bg-[#fffdf9]`}>
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="mt-2 font-display text-3xl font-semibold tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block min-h-11 rounded-xl focus-visible:outline-2">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: ReactNode; href: string }[]; active: string }) {
  return (
    <nav aria-label="Sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`-mb-px inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3.5 text-sm font-semibold ${
              on ? "border-navy text-navy" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number | null;
  hrefFor: (page: number) => string;
}) {
  const pages = total === null ? null : Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = total === null ? page * pageSize : Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2 text-sm text-muted">
      <span>
        {total === null ? `Rows ${from}–${to}` : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={buttonClass("secondary", "sm")}>
            Previous
          </Link>
        ) : null}
        {pages === null || page < pages ? (
          <Link href={hrefFor(page + 1)} className={buttonClass("secondary", "sm")}>
            Next
          </Link>
        ) : null}
      </span>
    </div>
  );
}

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "success";

/** Button styling shared by <button> and <Link>. Always ≥44px tall except "sm" inside dense tables. */
export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "sm" = "md"): string {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
  const sizes = size === "md" ? "min-h-11 px-4 text-sm" : "min-h-9 px-3 text-[0.8125rem]";
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-navy text-white hover:bg-navy-700",
    secondary: "border border-line-strong bg-white text-ink hover:bg-subtle",
    danger: "border border-maroon/40 bg-white text-maroon hover:bg-maroon-50",
    ghost: "text-navy hover:bg-navy-50",
    success: "bg-success text-white hover:brightness-110",
  };
  return `${base} ${sizes} ${variants[variant]}`;
}

export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{i.label}</dt>
          <dd className="mt-0.5 break-words text-[0.9375rem] text-ink">{i.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** GET filter form; submitting reloads the page with the query string. */
export function FilterBar({ children, action }: { children: ReactNode; action: string }) {
  return (
    <form method="get" action={action} className="mb-4 flex flex-wrap items-end gap-3">
      {children}
      <button type="submit" className={buttonClass("secondary")}>
        Apply
      </button>
    </form>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className = "",
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="crm-label">
        {label}
      </label>
      {children}
      {hint ? <p className="crm-hint">{hint}</p> : null}
    </div>
  );
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}
