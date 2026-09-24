"use client";

import { useState } from "react";

import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";

/** Copies a value (a DNS record) to the clipboard; says so plainly when the browser refuses. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  return (
    <button
      type="button"
      className={buttonClass("ghost", "xs")}
      aria-label={`${label}: ${value}`}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          (err) => {
            console.error("[copy] clipboard refused:", err);
            toast?.show("Could not copy — select the value and copy it by hand.", "bad");
          },
        );
      }}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
