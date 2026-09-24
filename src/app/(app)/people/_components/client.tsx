"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { Drawer } from "@/components/drawer";
import { Modal } from "@/components/modal";
import { buttonClass } from "@/components/ui";

/**
 * A record drawer whose open state lives in the URL (?hh=…, ?person=…,
 * ?app=…), so a drawer can be linked to, and the page behind it stays put.
 * Closing goes to `closeHref` without scrolling.
 */
export function UrlDrawer({
  closeHref,
  kicker,
  title,
  subtitle,
  children,
  footer,
}: {
  closeHref: string;
  kicker?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const router = useRouter();
  return (
    <Drawer open onClose={() => router.push(closeHref, { scroll: false })} kicker={kicker} title={title} subtitle={subtitle} footer={footer}>
      {children}
    </Drawer>
  );
}

/**
 * A table row that opens a record, as in the prototype: click anywhere on the
 * row (except its own links and buttons). Keyboard users use the row's Open
 * button, which is a real link.
 */
export function ClickableRow({ href, selected = false, children }: { href: string; selected?: boolean; children: ReactNode }) {
  const router = useRouter();
  function onClick(e: MouseEvent<HTMLTableRowElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("a,button,input,select,textarea,label,summary")) return;
    if (window.getSelection()?.toString()) return;
    router.push(href, { scroll: false });
  }
  return (
    <tr onClick={onClick} aria-selected={selected || undefined} className="cursor-pointer">
      {children}
    </tr>
  );
}

/**
 * Search box that filters as you type (debounced), keeping the other query
 * parameters. Enter also searches; without JavaScript the surrounding GET
 * form still works.
 */
export function LiveSearch({
  id,
  name = "q",
  label,
  placeholder,
  defaultValue = "",
}: {
  id: string;
  name?: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(defaultValue);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(defaultValue);

  function go(next: string) {
    if (next.trim() === last.current.trim()) return;
    last.current = next;
    const usp = new URLSearchParams(params.toString());
    if (next.trim()) usp.set(name, next.trim());
    else usp.delete(name);
    usp.delete("page");
    const q = usp.toString();
    startTransition(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (timer.current) clearTimeout(timer.current);
      go(value);
    }
  }

  return (
    <div>
      <label htmlFor={id} className="crm-label">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        aria-busy={pending || undefined}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => go(v), 300);
        }}
        className="crm-input"
      />
    </div>
  );
}

/**
 * The prototype's Export button with its step-up modal. Exports need a
 * data.export permission and a server-side export (watermark, 24-hour
 * expiry, audit, fresh code) that do not exist yet, so the button is shown
 * disabled with the reason; the modal path is kept for when they land.
 */
export function ExportButton({ label = "Export", what, enabled = false }: { label?: string; what: string; enabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const reason = "Exports are not available yet: they need a data.export permission and a watermarked, audited export on the server.";
  return (
    <>
      <button
        type="button"
        className={buttonClass(enabled ? "ghost" : "off")}
        disabled={!enabled}
        aria-disabled={!enabled || undefined}
        title={enabled ? undefined : reason}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {!enabled ? <span className="sr-only">{reason}</span> : null}
      <Modal
        open={open}
        kicker="Step-up verification"
        title={`Export ${what}?`}
        confirmLabel="Export"
        codeLabel="Verification code"
        error={reason}
        onCancel={() => setOpen(false)}
        onConfirm={() => setOpen(false)}
      >
        Exports are watermarked, expire in 24 hours and are recorded in the audit log.
      </Modal>
    </>
  );
}
