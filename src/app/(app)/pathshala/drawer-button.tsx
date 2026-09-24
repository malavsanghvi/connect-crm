"use client";

import { useState, type ReactNode } from "react";

import { Drawer } from "@/components/drawer";
import { buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui";

/** A pill button that opens the right-hand drawer with a form in it (e.g. "New class"). */
export function DrawerButton({
  label,
  title,
  kicker,
  subtitle,
  variant = "primary",
  size = "md",
  children,
}: {
  label: string;
  title: string;
  kicker?: string;
  subtitle?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonClass(variant, size)} onClick={() => setOpen(true)} aria-expanded={open}>
        {label}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} kicker={kicker} title={title} subtitle={subtitle}>
        {children}
      </Drawer>
    </>
  );
}
