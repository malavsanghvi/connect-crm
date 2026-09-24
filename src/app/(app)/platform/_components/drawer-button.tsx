"use client";

import { useState, type ReactNode } from "react";

import { Drawer } from "@/components/drawer";
import { buttonClass, type ButtonVariant } from "@/components/ui";

/** A row button that opens its details and actions in the right-hand drawer (Platform console). */
export function DrawerButton({
  label,
  variant = "ghost",
  kicker,
  title,
  subtitle,
  children,
}: {
  label: string;
  variant?: ButtonVariant;
  kicker: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass(variant, "xs")}>
        {label}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} kicker={kicker} title={title} subtitle={subtitle}>
        {children}
      </Drawer>
    </>
  );
}
