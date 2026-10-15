"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, type ReactNode } from "react";

import { formatDate } from "@/lib/dates";
import { tierLabel } from "@/lib/people";
import {
  detailSubline,
  householdLine,
  type MenuHrefs,
  type PersonDetailModel,
  type SectionPlan,
} from "@/lib/people-v2/slideover";

import { FamilyActionsProvider, type FamilyActions } from "../family/actions";
import { Avatar, Chip, NameLine, menuPerson, type PersonCtx } from "../family/person-card";
import { UndoProvider } from "../family/undo";

import { AccountSection, PrivacySection, ProfileSection, RolesSection } from "./detail-sections";
import { SlideOverFrame } from "./frame";
import { IdsSection } from "./ids-section";
import { PersonMenu } from "./person-menu";
import { LockIcon, PartNote, Section } from "./section";

// The person slide-over (docs/PEOPLE_REDESIGN.md section 4): a panel from the right on the Family page, a full-screen sheet on a
// phone, opened from a person's card or from the address (?person=<id>). Sections: Profile and Account and sign-in open, then Roles,
// Privacy, IDs, Memberships held, Giving at a glance (when the community reads giving by person), History. Places are kept for
// Custom fields (slice 2) and Notes (slices 10 to 13); they draw nothing until those slices fill the slots.
//
// On the person's own page (a person in no household) the same content is drawn on the page itself (`mode="page"`).

export type SlideOverSlots = {
  /** "Giving at a glance" for the person (server-rendered); null when the section is not there. */
  glance?: ReactNode;
  /** The person's history (the audit trail with the person filter). */
  history?: ReactNode;
  /** The Memberships section (server-rendered, with its Server Actions): memberships of the person and the family, and the staff actions. When absent, the older read-only list is drawn. */
  memberships?: ReactNode;
  /** "Events": this person's own tickets and the control that adds them to an event (server-rendered); null when the section is not there. */
  events?: ReactNode;
  /** "Gift matching" (CatchTheMatch, 0759): the employer on file for gift matching (server-rendered); only with CatchTheMatch on. */
  matching?: ReactNode;
  /** SLICE 2 (custom fields): the community's person fields, right under Profile. Not drawn until that slice passes a node. */
  customFields?: ReactNode;
  /** SLICES 10-13 (notes): that person's notes. Not drawn until those slices pass a node. */
  notes?: ReactNode;
};

export type SlideOverProps = {
  detail: PersonDetailModel;
  plan: SectionPlan[];
  slots: SlideOverSlots;
  /** Where "Done", the close button, the back arrow, the scrim and Esc go. */
  closeHref: string;
  closeLabel: string;
  /** The existing move and merge screens for this person. */
  hrefs: MenuHrefs;
  mode: "panel" | "page";
  /** The writes (the dev preview passes fakes for some of them). */
  actions?: Partial<FamilyActions>;
  undoWindowMs?: number;
};

export function PersonSlideOver(props: SlideOverProps) {
  const router = useRouter();
  const { detail, mode } = props;
  const close = () => router.push(props.closeHref, { scroll: false });
  if (mode === "panel") {
    // On the Family page the providers (writes, Undo) are the page's own: this sits inside them.
    return (
      <SlideOverFrame label={`Details for ${detail.person.name}`} onClose={close}>
        <SlideOverBody {...props} onClose={close} />
      </SlideOverFrame>
    );
  }
  // On the person's own page there is no Family page around it, so it brings its own.
  return (
    <FamilyActionsProvider actions={props.actions}>
      <UndoProvider windowMs={props.undoWindowMs}>
        <nav aria-label="Where you are" className="mx-auto mb-2 flex max-w-2xl items-center gap-1.5 text-[13.5px] text-muted">
          <Link href={props.closeHref} className="inline-flex min-h-8 items-center font-bold text-[var(--v2-blue)] no-underline hover:underline">
            <span aria-hidden="true" className="mr-1">
              ‹
            </span>
            {props.closeLabel}
          </Link>
          <span aria-hidden="true">›</span>
          <span dir="auto" className="truncate">
            {detail.person.name}
          </span>
        </nav>
        <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-line bg-white" data-testid="person-details-page">
          <SlideOverBody {...props} onClose={close} />
        </div>
      </UndoProvider>
    </FamilyActionsProvider>
  );
}

function Banner({ tone, children }: { tone: "sun" | "grey"; children: ReactNode }) {
  return (
    <p
      role="status"
      className={`m-0 mt-2 rounded-xl px-3 py-2 text-[13px] ${tone === "sun" ? "border border-warning-200 bg-warning-50 text-warning-ink" : "bg-[var(--v2-ground)] text-ink-2"}`}
    >
      {children}
    </p>
  );
}

/** The slide-over's content, without its frame: what both the panel and the person's own page draw. */
export function SlideOverBody({ detail, plan, slots, hrefs, mode, closeLabel, onClose }: SlideOverProps & { onClose: () => void }) {
  const p = detail.person;
  const ctx: PersonCtx = {
    householdId: detail.household?.id ?? null,
    canEdit: detail.canEdit,
    check: detail.check,
    detailsHref: () => "",
  };
  const sub = detailSubline(p, detail.household !== null);
  const card = detail.household ? householdLine(detail.household) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-line px-5 pb-4 pt-3">
        {mode === "panel" ? (
          <div className="mb-2 flex items-center justify-between md:hidden">
            <button type="button" onClick={onClose} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-[14px] font-bold text-[var(--v2-blue)]">
              <span aria-hidden="true" className="text-[18px] leading-none">
                ‹
              </span>
              {closeLabel}
            </button>
          </div>
        ) : null}
        <div className={`flex items-start gap-3 ${mode === "panel" ? "md:pt-2" : "pt-2"}`}>
          <Avatar id={p.id} name={p.name} size={48} />
          <div className="min-w-0 flex-1">
            <NameLine person={p} ctx={ctx} large />
            {sub ? <p className="m-0 mt-0.5 text-[14px] text-ink-2">{sub}</p> : null}
            {card.length > 0 ? (
              <p data-testid="household-line" dir="auto" className="m-0 mt-0.5 text-[13px] leading-snug text-muted">
                {card.join(" · ")}
              </p>
            ) : (
              <p className="m-0 mt-0.5 text-[13px] text-muted">Not in a family yet</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5 empty:hidden">
              {p.isChild ? (
                <span className="inline-flex min-h-6 items-center gap-1.5 rounded-full bg-[var(--v2-indigo-tint)] px-2.5 text-[12px] font-bold text-[var(--v2-indigo-dark)]">
                  <LockIcon />
                  Staff only · never sent to Niva
                </span>
              ) : null}
              {!detail.canEdit ? <Chip tone="grey">View only</Chip> : null}
              {p.deceased ? <Chip tone="grey">In memory</Chip> : null}
              {p.onApp ? <Chip tone="green">On the app</Chip> : null}
            </div>
          </div>
          {mode === "panel" ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close details"
              className="-mr-2 -mt-1 hidden size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-[var(--v2-ground)] md:grid"
            >
              <span aria-hidden="true" className="text-[26px] leading-none">
                ×
              </span>
            </button>
          ) : null}
        </div>
        {detail.mergedIntoId ? (
          <Banner tone="sun">
            This record was merged into{" "}
            <Link href={`/people/${detail.mergedIntoId}`} className="font-bold underline">
              another person
            </Link>
            . Edit that one instead; this history is kept.
          </Banner>
        ) : null}
        {p.deceased ? (
          <Banner tone="grey">
            Recorded as deceased{detail.deceasedOn ? `, ${formatDate(detail.deceasedOn, detail.timeZone)}` : ""}. No messages are sent to them.
          </Banner>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5" data-testid="slideover-sections">
        {plan.map((s) =>
          // The reserved places keep their position in the structure and draw only what the slice that owns them passes in.
          s.reserved === "custom-fields" ? (
            <Fragment key={s.key}>{slots.customFields}</Fragment>
          ) : s.reserved === "notes" ? (
            <Fragment key={s.key}>{slots.notes}</Fragment>
          ) : (
            <SectionFor key={s.key} s={s} detail={detail} ctx={ctx} slots={slots} />
          ),
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-white px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <PersonMenu
          surface="panel"
          person={menuPerson(p, ctx)}
          canEdit={detail.canEdit}
          hasHousehold={detail.household !== null}
          hrefs={hrefs}
          today={detail.check.today}
          direction="up"
        />
        {mode === "panel" ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center rounded-full bg-navy px-7 text-[14.5px] font-bold text-white hover:bg-navy-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)]"
          >
            Done
          </button>
        ) : null}
      </footer>
    </div>
  );
}

function SectionFor({ s, detail, ctx, slots }: { s: SectionPlan; detail: PersonDetailModel; ctx: PersonCtx; slots: SlideOverSlots }) {
  switch (s.key) {
    case "profile":
      return (
        <Section id="profile" title={s.title} open={s.open}>
          <ProfileSection detail={detail} ctx={ctx} />
        </Section>
      );
    case "account":
      return (
        <Section id="account" title={s.title} open={s.open}>
          <AccountSection detail={detail} />
        </Section>
      );
    case "roles":
      return (
        <Section id="roles" title={s.title} open={s.open}>
          <RolesSection detail={detail} />
        </Section>
      );
    case "privacy":
      return (
        <Section id="privacy" title={s.title} open={s.open}>
          <PrivacySection detail={detail} ctx={ctx} />
        </Section>
      );
    case "ids":
      return (
        <Section id="ids" title={s.title} open={s.open}>
          {detail.ids.state === "ok" ? <IdsSection detail={detail} facts={detail.ids.data} /> : <PartNote part={detail.ids} what="the IDs" />}
        </Section>
      );
    case "memberships":
      return (
        <Section id="memberships" title={s.title} open={s.open}>
          {slots.memberships ?? <MembershipsHeld detail={detail} />}
        </Section>
      );
    case "events":
      return (
        <Section id="events" title={s.title} open={s.open}>
          {slots.events ?? <PartNote part={{ state: "no-access" }} what="the events" />}
        </Section>
      );
    case "matching":
      return (
        <Section id="matching" title={s.title} open={s.open}>
          {slots.matching ?? <PartNote part={{ state: "no-access" }} what="gift matching" />}
        </Section>
      );
    case "giving":
      return (
        <Section id="giving" title={s.title} open={s.open}>
          {slots.glance ? (
            // The panel is 520 px wide whatever the screen: the figures sit two to a row and the breakdown one under the other.
            <div className="[&_[data-testid=giving-glance]]:mb-0 [&_[data-testid=giving-glance-breakdown]]:grid-cols-1 [&_[data-testid=giving-glance-tiles]]:grid-cols-2">
              {slots.glance}
            </div>
          ) : (
            <PartNote part={{ state: "no-access" }} what="giving" />
          )}
        </Section>
      );
    case "history":
      return (
        <Section id="history" title={s.title} open={s.open}>
          {slots.history ?? <PartNote part={{ state: "no-access" }} what="the history" />}
        </Section>
      );
    default:
      return null;
  }
}

function MembershipsHeld({ detail }: { detail: PersonDetailModel }) {
  const m = detail.memberships;
  if (m.state !== "ok") return <PartNote part={m} what="the memberships" />;
  if (m.data.length === 0) return <p className="m-0 py-1 text-[14px] text-muted">{detail.person.firstName} is not the holder of a membership.</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {m.data.map((x) => (
        <li key={x.id} className="rounded-xl bg-[var(--v2-ground)] px-3 py-2 text-[14px] text-ink">
          <span className="font-semibold">{tierLabel(x.tier)}</span> · <span className="capitalize">{x.status}</span>
          <span className="block text-[13px] text-muted" dir="auto">
            {x.household ? `${x.household.name}${x.household.number ? ` · No. ${x.household.number}` : ""} · ` : ""}
            {formatDate(x.startsOn, detail.timeZone)} – {x.endsOn ? formatDate(x.endsOn, detail.timeZone) : "lifetime"}
          </span>
        </li>
      ))}
    </ul>
  );
}
