"use client";

import { useState, type ReactNode } from "react";

import { Drawer } from "@/components/drawer";
import { buttonClass, type ButtonVariant } from "@/components/ui";

/** A row button that opens the verification review in the right-hand drawer. */
export function ReviewButton({ label, variant, title, subtitle, children }: { label: string; variant: ButtonVariant; title: string; subtitle: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass(variant, "xs")}>
        {label}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} kicker="Non-profit verification" title={title} subtitle={subtitle}>
        {children}
      </Drawer>
    </>
  );
}
