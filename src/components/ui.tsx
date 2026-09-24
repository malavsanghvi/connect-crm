import Link from "next/link";
import type { ReactNode } from "react";

import { ModuleTabs } from "@/components/shell/module-tabs";
import { explainError } from "@/lib/errors";
import { ACCESS, type AccessKey } from "@/lib/permissions";

/**
 * Page title block, as in the prototype: Fraunces 28/600 ink title, 13px
 * muted sub-line, pill actions on the right, and the module's tab strip
 * underneath (only when the module has more than one page).
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  tabs = true,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  /** Show the module tab strip under the title (default on). */
  tabs?: boolean;
}) {
  return (
    <header className="mb-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          {eyebrow ? <div className="mb-1 text-[13px] text-muted">{eyebrow}</div> : null}
          <h1 className="cc-page-title">{title}</h1>
          {description ? <p className="cc-page-sub mt-0.5 max-w-4xl">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {tabs ? <ModuleTabs /> : null}
    </header>
  );
}

const SPAN: Record<number, string> = {
  3: "lg:col-span-3",
  4: "lg:col-span-4",
  5: "lg:col-span-5",
  6: "lg:col-span-6",
  7: "lg:col-span-7",
  8: "lg:col-span-8",
  9: "lg:col-span-9",
  12: "lg:col-span-12",
};
export type BlockSpan = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 12;

/** The prototype's content grid: 12 columns, 16px gap. Put <Card span={n}> blocks in it (7/5, 6/6, 8/4, 12). */
export function BlockGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-cols-12 items-start gap-4 ${className}`}>{children}</div>;
}

/**
 * A block: white, radius 16, #E3D9C8 border, padding 16/18. Header is a DM
 * Sans 16/700 title with a 12px hint and small pill actions — no divider.
 * `padded={false}` keeps a slim inset for tables. `span` sets the width
 * inside a <BlockGrid> (full width on small screens).
 */
export function Card({
  title,
  description,
  actions,
  children,
  className = "",
  padded = true,
  span,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
  span?: BlockSpan;
}) {
  const spanClass = span ? `col-span-12 ${SPAN[span]}` : "";
  const hasHead = Boolean(title || actions);
  return (
    <section className={`cc-card ${spanClass} ${className}`}>
      {hasHead ? (
        <div className="flex flex-wrap items-center gap-2.5 px-[18px] pt-4">
          <div className="min-w-0 flex-1">
            {title ? <h2 className="cc-card-title">{title}</h2> : null}
            {description ? <p className="cc-card-hint">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={padded ? `px-[18px] pb-4 ${hasHead ? "pt-3" : "pt-4"}` : `px-2 pb-2 ${hasHead ? "pt-3" : "pt-2"}`}>
        {children}
      </div>
    </section>
  );
}

/** Horizontal scroll wrapper so wide tables never break the layout. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export type Tone = "neutral" | "navy" | "success" | "warning" | "danger" | "purple";

const toneText: Record<Tone, string> = {
  neutral: "text-muted font-semibold",
  navy: "text-navy font-bold",
  success: "text-success font-bold",
  warning: "text-brown font-bold",
  danger: "text-danger font-bold",
  purple: "text-purple font-bold",
};

/**
 * Status in a table or line of text. The prototype shows status as bold
 * coloured text (green / amber / red), not as a pill. Always carries words,
 * never colour alone.
 */
export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`whitespace-nowrap ${toneText[tone]}`}>
      {children}
    </span>
  );
}

/** Bold coloured status text: ok (green #1F7A4D), warn (amber #8A4608), bad (red #B3261E). */
export function StatusText({ tone, children }: { tone: "ok" | "warn" | "bad"; children: ReactNode }) {
  return <span className={`cc-status-${tone} whitespace-nowrap`}>{children}</span>;
}

/** Module colours for solid tags (Home task rows and the like). */
export const TAG_COLOR = {
  danger: "bg-danger",
  brown: "bg-brown",
  navy: "bg-navy",
  purple: "bg-purple",
  store: "bg-store",
  maroon: "bg-maroon",
  muted: "bg-muted",
  success: "bg-success",
} as const;
export type TagColor = keyof typeof TAG_COLOR;

/** Solid tag: white 11/700 text on a module colour, radius 8 (e.g. "Refund", "Membership"). */
export function Tag({ color = "navy", children }: { color?: TagColor; children: ReactNode }) {
  return <span className={`cc-tag ${TAG_COLOR[color]}`}>{children}</span>;
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
    danger: "border-danger/30 bg-danger-50 text-danger",
    warning: "border-saffron/40 bg-saffron-50 text-brown-900",
    success: "border-success/30 bg-success-50 text-success-900",
    info: "border-navy/20 bg-navy-50 text-navy",
  }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`rounded-[10px] border px-4 py-3 text-[13px] ${styles}`}>
      {title ? <p className="font-bold">{title}</p> : null}
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
          <a href={retryHref} className={buttonClass("bad", "xs")}>
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
    <div className="cc-card px-6 py-10 text-center">
      <p className="font-display text-[22px] font-semibold text-ink">You don&apos;t have access to this area</p>
      <p className="mx-auto mt-2 max-w-lg text-[13px] text-muted">
        {area} needs one of these permissions: <strong className="text-ink">{need.join(", ")}</strong>. Ask your center
        admin to grant you a role that includes it (Settings → Roles &amp; entitlements).
      </p>
      {extra ? <div className="mt-4 text-[13px]">{extra}</div> : null}
    </div>
  );
}

/** Plain 13px faint text, as in the prototype ("Nothing here right now"). */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="cc-empty">
      <p>{title}</p>
      {children ? <div className="mt-1 max-w-2xl">{children}</div> : null}
    </div>
  );
}

export type StatTone = "navy" | "saffron" | "brown" | "success" | "danger" | "maroon" | "purple" | "store" | "ink";

const statValue: Record<StatTone, string> = {
  navy: "text-navy",
  saffron: "text-saffron",
  brown: "text-brown",
  success: "text-success",
  danger: "text-danger",
  maroon: "text-maroon",
  purple: "text-purple",
  store: "text-store",
  ink: "text-ink",
};

/**
 * KPI tile, as in the prototype: #FBF7F0 fill, radius 12, 12/600 label, 24/800
 * value in the metric's colour, 11px sub-line. Links when `href` is given.
 */
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
  tone?: StatTone;
}) {
  const body = (
    <>
      <p className="cc-kpi-label">{label}</p>
      <p className={`cc-kpi-value ${statValue[tone]}`}>{value}</p>
      {hint ? <p className="cc-kpi-sub">{hint}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="cc-kpi h-full transition-colors hover:bg-highlight">
      {body}
    </Link>
  ) : (
    <div className="cc-kpi h-full">{body}</div>
  );
}

/** Grid of KPI tiles (10px gap). `cols` is the column count on wide screens. */
export function KpiGrid({ children, cols = 4 }: { children: ReactNode; cols?: 1 | 2 | 3 | 4 | 5 }) {
  const c = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 xl:grid-cols-4", 5: "sm:grid-cols-2 xl:grid-cols-5" }[cols];
  return <div className={`grid grid-cols-1 gap-2.5 ${c}`}>{children}</div>;
}

/**
 * Views inside one page (a status filter, a household's sections). The
 * prototype has one tab row per module (ModuleTabs, under the title); views
 * inside a page are chips — navy outline pills, the current one filled.
 */
export function Tabs({ tabs, active }: { tabs: { key: string; label: ReactNode; href: string }[]; active: string }) {
  return <ChipLinks label="Views" items={tabs} active={active} />;
}

/** A row of link chips (filters that change the URL). */
export function ChipLinks({
  items,
  active,
  label = "Filter",
}: {
  items: { key: string; label: ReactNode; href: string }[];
  active: string;
  label?: string;
}) {
  return (
    <nav aria-label={label} className="mb-3 flex flex-wrap gap-1.5">
      {items.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === active ? "page" : undefined} className="cc-chip">
          {t.label}
        </Link>
      ))}
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
    <div className="flex flex-wrap items-center justify-between gap-3 px-2.5 pt-2.5 text-xs text-muted">
      <span>
        {total === null
          ? `Showing rows ${from}–${to}`
          : `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={buttonClass("ghost", "xs")}>
            Previous
          </Link>
        ) : null}
        {pages === null || page < pages ? (
          <Link href={hrefFor(page + 1)} className={buttonClass("ghost", "xs")}>
            Next
          </Link>
        ) : null}
      </span>
    </div>
  );
}

/**
 * Button kinds from the prototype's btn(): primary (navy), ghost (navy
 * outline), ok (green), warn (amber-brown), bad (red outline), off (disabled
 * look). "bad-solid" is the filled red confirm of a destructive modal;
 * "plain" is a text button (e.g. "Sign out"). The older names still work:
 * secondary → ghost, danger → bad, success → ok.
 */
export type ButtonVariant =
  | "primary"
  | "ghost"
  | "ok"
  | "warn"
  | "bad"
  | "bad-solid"
  | "off"
  | "plain"
  | "secondary"
  | "danger"
  | "success";

/** lg 52 (login) · md 40 (page and form buttons) · modal 42 · sm 36 (card headers) · xs 30 (table rows). */
export type ButtonSize = "lg" | "md" | "modal" | "sm" | "xs";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "cc-btn-primary",
  ghost: "cc-btn-ghost",
  ok: "cc-btn-ok",
  warn: "cc-btn-warn",
  bad: "cc-btn-bad",
  "bad-solid": "cc-btn-bad-solid",
  off: "cc-btn-off",
  plain: "cc-btn-plain",
  secondary: "cc-btn-ghost",
  danger: "cc-btn-bad",
  success: "cc-btn-ok",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  lg: "cc-btn-lg",
  md: "",
  modal: "min-h-[42px] px-[18px]",
  sm: "cc-btn-sm",
  xs: "cc-btn-xs",
};

/** Pill button styling shared by <button> and <Link>. */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md"): string {
  return `cc-btn ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]}`.trim();
}

export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted">{i.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink">{i.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** GET filter form; submitting reloads the page with the query string. */
export function FilterBar({ children, action }: { children: ReactNode; action: string }) {
  return (
    <form method="get" action={action} className="mb-3 flex flex-wrap items-end gap-3">
      {children}
      <button type="submit" className={buttonClass("ghost")}>
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

/** Read-only value styled like a field (prototype "info" box, #F6F2EA). */
export function InfoBox({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`cc-info ${className}`}>{children}</div>;
}

/** Caps section label (12/800), used in drawers and forms: "MEMBERS · TAP TO OPEN". */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="cc-section">{children}</p>;
}

/** A titled group of key/value rows in a drawer. */
export function DrawerSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </section>
  );
}

/**
 * One key/value row (#FBF7F0, radius 10). With `href` it becomes a white,
 * bordered link row, as the prototype does for clickable rows.
 */
export function KeyValueRow({
  label,
  value,
  href,
  tone = "ink",
}: {
  label: ReactNode;
  value?: ReactNode;
  href?: string;
  tone?: "ink" | "ok" | "warn" | "bad" | "navy";
}) {
  const valueClass = {
    ink: "text-ink",
    ok: "text-success",
    warn: "text-brown",
    bad: "text-danger",
    navy: "text-navy",
  }[tone];
  const inner = (
    <>
      <span className="min-w-0">{label}</span>
      {value !== undefined ? <span className={`whitespace-nowrap font-bold ${valueClass}`}>{value}</span> : null}
    </>
  );
  return href ? (
    <Link href={href} className="cc-kv">
      {inner}
    </Link>
  ) : (
    <div className="cc-kv">{inner}</div>
  );
}

/** Loading placeholder block (#E9E1D2, shimmer). */
export function Skeleton({ height, className = "" }: { height: number; className?: string }) {
  return <div aria-hidden className={`cc-skeleton ${className}`} style={{ height }} />;
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}
