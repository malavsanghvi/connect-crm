"use client";

import { useActionState } from "react";

import { signOutAction } from "@/app/auth-actions";
import { buttonClass } from "@/components/ui";

/**
 * The top bar's user block, as in the prototype: navy initial avatar, name
 * (13/700) and role (11px) inline, then a plain "Sign out" text button.
 * Email and every role are in the avatar's tooltip.
 */
export function UserMenu({
  name,
  email,
  role,
  roles,
  initials,
}: {
  name: string;
  email: string | null;
  role: string;
  roles: string[];
  initials: string;
}) {
  const [state, action, pending] = useActionState(async () => signOutAction(), null);
  const tooltip = [name, email, roles.length > 0 ? `Roles: ${roles.join(", ")}` : "No staff roles at this center"]
    .filter(Boolean)
    .join("\n");
  return (
    <div className="relative flex shrink-0 items-center gap-2">
      <span aria-hidden className="cc-avatar" title={tooltip}>
        {initials}
      </span>
      <span className="hidden min-w-0 leading-tight sm:block" title={tooltip}>
        <span className="block max-w-[11rem] truncate text-[13px] font-bold text-ink">{name}</span>
        <span className="block max-w-[11rem] truncate text-[11px] text-muted">{role}</span>
      </span>
      <form action={action}>
        <button type="submit" disabled={pending} className={`${buttonClass("plain")} min-h-9 text-[13px]`}>
          {pending ? "Signing out…" : "Sign out"}
        </button>
      </form>
      {state && !state.ok ? (
        <p role="alert" className="absolute right-0 top-[calc(100%+8px)] z-50 w-72 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
