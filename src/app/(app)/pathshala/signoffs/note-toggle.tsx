"use client";

import { useState } from "react";

/** "Note" link that reveals an optional note for the student (sent with either decision). */
export function NoteToggle({ student }: { student: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="crm-link text-[12px] font-semibold" onClick={() => setOpen(true)}>
        + Note
      </button>
    );
  }
  return (
    <input
      name="note"
      autoFocus
      maxLength={500}
      placeholder="Optional note for the family"
      aria-label={`Note for ${student}`}
      className="crm-input min-h-[30px] w-52 text-[13px]"
    />
  );
}
