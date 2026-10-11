"use client";

import { Component, type ReactNode } from "react";

const reported = new Set<string>();

/** Logs the first failure of each named part once, so one broken part cannot flood the console. */
export function reportNivaFailure(name: string, error: unknown): void {
  if (reported.has(name)) return;
  reported.add(name);
  console.error(`[niva] the ${name} hit an error and was hidden for this page. The rest of the portal is not affected.`, error);
}

/** Forget what was reported (tests). */
export function resetNivaReports(): void {
  reported.clear();
}

/**
 * Keeps a failure inside Niva's interface from reaching the portal: if anything under it throws while rendering, it shows nothing
 * (not an error page) and logs once. Wrap each separate part (top bar button, panel, command list) in its own.
 */
export class NivaBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    reportNivaFailure(this.props.name, error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
