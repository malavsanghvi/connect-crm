"use client";

import { useActionState } from "react";

import { signOutAction } from "@/app/auth-actions";

export function UserMenu({
  name,
  email,
  roles,
}: {
  name: string;
  email: string | null;
  roles: string[];
}) {
  const [state, action, pending] = useActionState(async () => signOutAction(), null);
  return (
    <details className="group relative">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm font-semibold text-ink hover:bg-subtle">
        <span
          aria-hidden
          className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-xs font-bold text-white"
        >
          {initials(name)}
        </span>
        <span className="hidden max-w-[12rem] truncate sm:inline">{name}</span>
        <span aria-hidden className="text-muted">
          ▾
        </span>
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-72 rounded-xl border border-line bg-card p-4 shadow-lg">
        <p className="font-semibold text-ink">{name}</p>
        {email ? <p className="truncate text-sm text-muted">{email}</p> : null}
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Roles</p>
        {roles.length > 0 ? (
          <ul className="mt-1 space-y-0.5 text-sm text-ink">
            {roles.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted">No staff roles at this center.</p>
        )}
        <form action={action} className="mt-4">
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 w-full rounded-lg border border-line-strong bg-white px-4 text-sm font-semibold text-ink hover:bg-subtle disabled:opacity-60"
          >
            {pending ? "Signing out…" : "Sign out"}
          </button>
        </form>
        {state && !state.ok ? (
          <p role="alert" className="mt-2 text-sm text-maroon">
            {state.error}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}
