"use client";

import { useId, useState } from "react";

import { buttonClass } from "@/components/ui";

/**
 * The message for a member (the steps from the library, our registered name, the dates), ready to copy and send in the office's own way.
 * Nothing is sent from here. When the browser will not copy, the text is open to select, and the screen says so.
 */
export function CopyMessage({ text, label = "Copy the message" }: { text: string; label?: string }) {
  const id = useId();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch (e) {
      console.error("[matching] could not copy the message:", e);
      setState("failed");
    }
  };
  return (
    <details className="text-[13px]" open={state === "failed"}>
      <summary className="cursor-pointer font-bold text-[var(--v2-blue)]">Message for the member</summary>
      <label htmlFor={id} className="sr-only">
        Message for the member
      </label>
      <textarea id={id} readOnly value={text} rows={10} className="crm-input mt-2 w-full font-mono text-[12.5px]" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={copy} className={buttonClass("secondary", "xs")}>
          {label}
        </button>
        {state === "copied" ? (
          <span role="status" className="text-success">
            Copied. Paste it into your email, text or letter.
          </span>
        ) : null}
        {state === "failed" ? (
          <span role="alert" className="text-danger">
            Could not copy it from here. Select the text above and copy it yourself.
          </span>
        ) : null}
      </div>
    </details>
  );
}
