"use client";

import { useState } from "react";

import { smsLengthText } from "@/lib/messaging/sms";

/** A text box that counts SMS segments as you type (Gujarati and Hindi use Unicode: 70 per segment). */
export function SegmentCounter({ name, label, defaultValue = "", rows = 2 }: { name: string; label: string; defaultValue?: string; rows?: number }) {
  const [text, setText] = useState(defaultValue);
  return (
    <label className="block">
      <span className="crm-label">{label}</span>
      <textarea name={name} className="crm-input min-h-[3.5rem]" rows={rows} value={text} onChange={(e) => setText(e.target.value)} />
      <span className="crm-hint" aria-live="polite">
        {smsLengthText(text)}
      </span>
    </label>
  );
}
