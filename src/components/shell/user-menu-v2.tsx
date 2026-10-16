"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { signOutAction } from "@/app/auth-actions";
import { LookSwitch } from "@/components/shell/look-switch";
import { TourMenuItem } from "@/components/spotlight/tour-menu";

/** The open panel of the account menu (separate so it can be rendered on its own). */
export function AccountPanel({
  id,
  name,
  email,
  role,
  roles,
  action,
  pending,
  error,
  onNavigate,
  links = [],
}: {
  id: string;
  name: string;
  email: string | null;
  role: string;
  roles: string[];
  action: (payload: FormData) => void;
  pending: boolean;
  error: string | null;
  onNavigate: () => void;
  /** Places that have no room in the top bar (Platform), listed above Account. */
  links?: { label: string; href: string }[];
}) {
  return (
    <div id={id} role="group" aria-label="Account" className="v2-usermenu">
      <div className="px-3 pb-2 pt-2">
        <p className="truncate text-[14px] font-bold text-ink">{name}</p>
        {email ? <p className="truncate text-[12px] text-muted">{email}</p> : null}
        <p className="mt-1 text-[12px] text-muted">{roles.length > 0 ? roles.join(", ") : role}</p>
      </div>
      <div className="border-t border-line-soft pt-1">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="v2-menu-item" data-spotlight={l.href === "/platform" ? "nav-platform" : undefined} onClick={onNavigate}>
            {l.label}
          </Link>
        ))}
        <Link href="/account/security" className="v2-menu-item" title="Two-step verification, phone and sessions" onClick={onNavigate}>
          Account and security
        </Link>
        <LookSwitch look="v2" block item />
        {/* Replay or turn off the guided tours; renders nothing for a person who has no tour. */}
        <TourMenuItem variant="menu" onStarted={onNavigate} />
        <form action={action}>
          <button type="submit" disabled={pending} className="v2-menu-item">
            {pending ? "Signing out…" : "Sign out"}
          </button>
        </form>
      </div>
      {error ? (
        <p role="alert" className="mx-1 mb-1 mt-1 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The account menu of the redesigned top bar: one avatar button that opens a small panel with the person's name and roles, Account,
 * "Classic look" (the way back to the classic portal) and Sign out. Escape or a click elsewhere closes it.
 */
export function UserMenuV2({
  name,
  email,
  role,
  roles,
  initials,
  links,
}: {
  name: string;
  email: string | null;
  role: string;
  roles: string[];
  initials: string;
  links?: { label: string; href: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async () => signOutAction(), null);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        className="v2-avatar-btn"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${name}, account menu`}
        title={name}
        onClick={() => setOpen((o) => !o)}
      >
        {initials}
      </button>
      {open ? (
        <AccountPanel
          id={panelId}
          name={name}
          email={email}
          role={role}
          roles={roles}
          action={action}
          pending={pending}
          error={state && !state.ok ? state.error : null}
          onNavigate={() => setOpen(false)}
          links={links}
        />
      ) : null}
    </div>
  );
}
