"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setLookAction } from "@/app/look-actions";
import { buttonClass } from "@/components/ui";
import type { Look } from "@/lib/look";

/**
 * "New look" / "Classic look": the per-person switch between the classic portal and the redesigned shell. It only changes how
 * this browser draws the portal; permissions and data are the same either way. A failure is shown next to the button.
 * `item` draws it as a row of the redesigned account menu.
 */
export function LookSwitch({ look, className = "", block = false, item = false }: { look: Look; className?: string; block?: boolean; item?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const target: Look = look === "v2" ? "classic" : "v2";
  const label = look === "v2" ? "Classic look" : "New look";

  const switchLook = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await setLookAction(target);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.refresh();
      } catch (err) {
        console.error("[look] switching the look failed:", err);
        setError("Could not change the look — the portal could not be reached. Check your connection and try again.");
      }
    });
  };

  return (
    <span className={`relative ${block ? "block" : "inline-flex"} ${className}`}>
      <button
        type="button"
        onClick={switchLook}
        disabled={pending}
        title={look === "v2" ? "Go back to the classic look of the portal" : "Try the redesigned portal: a rail of workspaces and new colors"}
        className={item ? "v2-menu-item" : `${buttonClass("plain")} min-h-9 text-[13px] ${block ? "w-full justify-center" : ""}`}
      >
        {pending ? "Switching…" : label}
      </button>
      {error ? (
        <span
          role="alert"
          className={`${block ? "mt-2 block" : "absolute right-0 top-[calc(100%+8px)] z-50 w-72"} rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-left text-[13px] font-normal text-danger`}
        >
          {error}
        </span>
      ) : null}
    </span>
  );
}
