"use client";

import { useState } from "react";

import { AddFamilySheet } from "./add-family-sheet";

// "Add a family" on the People home. It opens the sheet that looks for families that may already be here before anything is created
// (the sheet's own contract: the home mounts it and closes it). The page only shows this button to a role that may add a family;
// the database check in people.add_household is the real gate.

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full bg-navy px-[18px] text-[14px] font-bold text-white no-underline hover:bg-navy-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)]";

export function AddFamilyButton({ initialName }: { initialName?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={PRIMARY}>
        + Add a family
      </button>
      <AddFamilySheet open={open} onClose={() => setOpen(false)} initialName={initialName} />
    </>
  );
}
