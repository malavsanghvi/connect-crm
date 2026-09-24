"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { QUICK_ADJUST } from "@/lib/store";

import { quickAdjustAction } from "./actions";

/** "−5" / "+10" on an inventory row; each press is an audited stock movement. */
export function QuickAdjust({ itemId, itemName }: { itemId: string; itemName: string }) {
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const router = useRouter();
  function adjust(delta: number) {
    startTransition(async () => {
      try {
        const res = await quickAdjustAction(itemId, delta);
        if (!res.ok) {
          toast?.show(res.error, "bad");
          if (!toast) window.alert(res.error);
          return;
        }
        toast?.show(res.message ?? "Stock adjusted.", "ok");
        router.refresh();
      } catch (err) {
        console.error("[store] quick adjust failed:", err);
        const msg = `Could not adjust ${itemName}'s stock — the server did not respond. Refresh and check the count before trying again.`;
        toast?.show(msg, "bad");
        if (!toast) window.alert(msg);
      }
    });
  }
  return (
    <span className="flex gap-1.5">
      {QUICK_ADJUST.map((d) => (
        <button
          key={d}
          type="button"
          disabled={pending}
          aria-label={`${d > 0 ? "Add" : "Remove"} ${Math.abs(d)} ${itemName}`}
          onClick={() => adjust(d)}
          className={buttonClass(d > 0 ? "primary" : "ghost", "xs")}
        >
          {d > 0 ? `+${d}` : `−${Math.abs(d)}`}
        </button>
      ))}
    </span>
  );
}
