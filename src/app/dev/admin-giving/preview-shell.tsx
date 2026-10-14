"use client";

// DEV ONLY. The New look's frame (top bar, rail, phone bar) drawn with invented props and a stand-in Niva that is "on" but
// answers nothing, so the Giving page can be screenshotted inside the shell without a session or a database.

import type { ReactNode } from "react";

import { WeaverMark } from "@/components/brand/weaver-mark";
import { NivaContext, type NivaApi } from "@/components/niva/niva-context";
import { NivaTopButton } from "@/components/niva/niva-top-button";
import { NivaSunButton } from "@/components/shell/niva-sun-button";
import { PhoneBar } from "@/components/shell/phone-bar";
import { TenantMark } from "@/components/shell/tenant-mark";
import { WorkspaceRail, type RailWorkspace } from "@/components/shell/workspace-rail";
import { initialChatState } from "@/lib/assistant/chat-state";
import { PRODUCT_NAME } from "@/lib/brand";

const noop = () => {};

const PREVIEW_NIVA: NivaApi = {
  enabled: true,
  aiReady: true,
  aiOff: false,
  commands: [],
  nav: [],
  context: { path: "/giving" },
  dockOpen: false,
  paletteOpen: false,
  paletteQuery: "",
  openDock: noop,
  closeDock: noop,
  toggleDock: noop,
  openPalette: noop,
  closePalette: noop,
  chat: initialChatState,
  send: noop,
  stop: noop,
  retry: noop,
  newChat: noop,
  ask: noop,
  showResult: noop,
  showProposal: noop,
};

export function PreviewShell({ community, workspaces, children }: { community: string; workspaces: RailWorkspace[]; children: ReactNode }) {
  return (
    <NivaContext.Provider value={PREVIEW_NIVA}>
      <div data-look="v2" className="v2-shell flex min-h-screen flex-col">
        <header className="v2-topbar sticky top-0 z-30">
          <span className="v2-topbar-home">
            <TenantMark branding={{ logoUrl: null, monogram: "LCC", shortName: "LCC" }} name={community} size={40} />
          </span>
          <span className="v2-product hidden items-center gap-2 xl:inline-flex" aria-hidden="true">
            <WeaverMark className="h-7 w-7" />
            {PRODUCT_NAME}
          </span>
          <span className="cc-center-pill hidden lg:inline-flex">{community}</span>
          <span className="rounded-field bg-danger px-2.5 py-0.5 text-[10px] font-bold tracking-[0.08em] text-white">DEV PREVIEW · SAMPLE DATA</span>
          <div className="hidden min-w-0 flex-1 justify-center md:flex">
            <span className="cc-search flex max-w-[520px] items-center text-muted">Search a name, phone, email or any ID</span>
          </div>
          <div className="flex-1 md:hidden" />
          <div className="hidden md:contents">
            <NivaTopButton />
          </div>
          <span className="v2-avatar-btn" aria-label="Grace Lindqvist">
            <span aria-hidden="true" className="cc-avatar">
              G
            </span>
          </span>
        </header>
        <div className="flex flex-1">
          <WorkspaceRail
            workspaces={workspaces}
            todayBadge="4"
            todayBadgeLabel="4 tasks waiting"
            account={
              <span className="v2-rail-avatar" aria-label="Your account">
                <span aria-hidden="true" className="cc-avatar">
                  G
                </span>
              </span>
            }
          >
            <NivaSunButton variant="rail" />
          </WorkspaceRail>
          <main id="v2-main" tabIndex={-1} className="v2-main min-w-0 flex-1 px-4 pb-28 pt-[22px] sm:px-7 md:pb-10">
            {children}
          </main>
        </div>
        <PhoneBar workspaces={workspaces} todayBadge="4" todayBadgeLabel="4 tasks waiting" footer="Treasurer · sample data">
          <NivaSunButton variant="bar" />
        </PhoneBar>
      </div>
    </NivaContext.Provider>
  );
}
