"use client";

import { useActionState } from "react";

import { leaveDemoAction } from "@/app/demo/actions";
import type { ActionResult } from "@/lib/errors";

/** "Leave the demo": ends this demo session and returns to the choice of people. A failure is shown next to the button. */
export function DemoLeaveButton({ className = "" }: { className?: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(() => leaveDemoAction(), null);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <button type="submit" disabled={pending} className={className || "font-bold underline underline-offset-2"}>
        {pending ? "Leaving…" : "Leave the demo"}
      </button>
      {state && !state.ok ? (
        <span role="alert" className="font-semibold text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
