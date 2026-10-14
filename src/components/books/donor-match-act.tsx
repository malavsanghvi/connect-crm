"use client";

// Approve one QuickBooks donor match in place (Giving › Today and Books), next to its household card. It calls the EXISTING
// approveMatchAction (accounting.manage, the 0242 RPC with its module check, a reason kept in the audit log). Enter in the
// reason field does not approve: only the button that names the customer and the household does. A result shows next to it.

import { useId, useState, useTransition } from "react";

import { approveMatchAction } from "@/app/(app)/accounting/qbo/matching/actions";
import { buttonClass } from "@/components/ui";

export function DonorMatchApprove({ matchId, label, onDone }: { matchId: string; label: string; onDone?: (text: string) => void }) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function approve() {
    setError(null);
    if (!reason.trim()) {
      setError("Could not approve: give a reason first (it is kept in the audit log).");
      return;
    }
    start(async () => {
      try {
        const f = new FormData();
        f.set("id", matchId);
        f.set("reason", reason.trim());
        const res = await approveMatchAction(null, f);
        if (!res.ok) {
          setError(res.error ?? "Could not approve the match.");
          return;
        }
        const text = `Done: ${res.message ?? "approved."}`;
        setDone(text);
        onDone?.(text);
      } catch (err) {
        console.error("[books] approve donor match failed:", err);
        setError("Could not approve the match: the server did not respond. Reload the page to see whether it went through before trying again.");
      }
    });
  }

  if (done) {
    return (
      <p role="status" className="m-0 mt-2 text-[13px] font-bold text-success">
        {done}
      </p>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="sr-only">
          Reason for approving
        </label>
        <input
          id={id}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          maxLength={500}
          placeholder="Reason (kept in the audit log)"
          className="crm-input min-h-[40px] min-w-[12rem] flex-1"
        />
        <button type="button" disabled={pending} onClick={approve} className={`${buttonClass("ok", "sm")} min-h-[40px] max-w-full whitespace-normal py-1.5 text-center`}>
          {pending ? "Approving…" : label}
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] leading-[1.45] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
