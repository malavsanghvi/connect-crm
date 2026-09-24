"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";

import { lockMonthAction } from "./actions";

/** "Lock {Month}" (prototype L659): off until the checklist is done; confirms in the Modal. */
export function LockMonthButton({ month, monthLabel, shortLabel, ready, locked }: { month: string; monthLabel: string; shortLabel: string; ready: boolean; locked: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (locked) {
    return (
      <button type="button" disabled className={buttonClass("ok", "sm")}>
        {shortLabel} locked ✓
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        aria-disabled={!ready}
        onClick={() => (ready ? (setError(null), setOpen(true)) : toast?.show("Finish the checklist first", "bad"))}
        className={buttonClass(ready ? "primary" : "off", "sm")}
      >
        Lock {shortLabel}
      </button>
      <Modal
        open={open}
        kicker="PLEASE CONFIRM"
        title={`Lock ${monthLabel}?`}
        confirmLabel="Lock month"
        tone="primary"
        pending={pending}
        error={error}
        onCancel={() => setOpen(false)}
        onConfirm={() =>
          start(async () => {
            try {
              const res = await lockMonthAction(month);
              if (!res.ok) {
                setError(res.error);
                return;
              }
              setOpen(false);
              toast?.show(res.message ?? `${monthLabel} locked`, "ok");
              router.refresh();
            } catch (err) {
              console.error("[close] lock failed:", err);
              setError("Could not lock the month — the server did not respond. Reload to see whether it is locked before trying again.");
            }
          })
        }
      >
        No one can change {shortLabel} transactions after locking; later corrections post as adjustments. The prototype asks for a code sent to
        your phone here — step-up codes are not set up yet, so the lock is recorded under your name in the audit log.
      </Modal>
    </>
  );
}
