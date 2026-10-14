"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { SparkIcon } from "@/components/people-v2/icons";
import { isRecordRow, type GivingRow } from "@/lib/find/giving";
import { selectable } from "@/lib/find/rows";
import type { UiRow } from "@/lib/find/types";

import { HomeIcon, ListIcon, LockIcon } from "./icons";

const TONES = [
  "bg-navy-50 text-navy",
  "bg-[var(--v2-teal-tint)] text-[var(--v2-teal-ink)]",
  "bg-[var(--v2-sun-tint)] text-[var(--v2-sun-ink)]",
  "bg-[var(--v2-lavender-tint)] text-[var(--v2-lavender)]",
  "bg-[var(--v2-green-tint)] text-[var(--v2-green-ink)]",
];

/** On Giving pages an adult with a family opens that family's giving in place; anyone else opens as a link. */
function opensInPlace(row: Extract<UiRow, { type: "person" }>): boolean {
  return !!row.row.householdId && !row.row.child;
}

function toneFor(id: string): string {
  let n = 0;
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[n % TONES.length];
}

/** Two letters from a name, in any script. */
export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const letters = (words.length > 1 ? [words[0], words[words.length - 1]] : [words[0] ?? ""]).map((w) => Array.from(w)[0] ?? "");
  return letters.join("").toUpperCase();
}

const ROW = "flex min-h-[58px] w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left no-underline";
const PILL = "ml-2 max-w-[42%] shrink-0 truncate rounded-lg border border-line bg-white px-2 py-0.5 text-[11px] font-bold text-ink-2";

function Heading({ children }: { children: ReactNode }) {
  return (
    <div role="presentation" className="px-3 pb-1 pt-2.5 text-[11px] font-bold uppercase tracking-[0.05em] text-muted">
      {children}
    </div>
  );
}

const GIVING_HEADING: Record<GivingRow["kind"], string | null> = {
  record: null,
  record_pledge: null,
  go: null,
  payment: "Payments",
  pledge: "Pledges",
  bank: "Bank lines",
  campaign: "Campaigns",
};

function headingFor(rows: readonly UiRow[], i: number): string | null {
  const cur = rows[i];
  const prev = rows[i - 1];
  if (cur.type === "giving") {
    if (prev && prev.type === "giving" && prev.row.kind === cur.row.kind) return null;
    if (i === 0 && (isRecordRow(cur.row) || cur.row.kind === "go")) return null;
    return GIVING_HEADING[cur.row.kind] ?? (isRecordRow(cur.row) ? "Record" : null);
  }
  if (i === 0 || cur.type === "message" || cur.type === "palette") return null;
  if (prev && prev.type === cur.type) return null;
  if (cur.type === "family") return "Families";
  if (cur.type === "person") return "People";
  if (cur.type === "filter") return "Or show as a list";
  if (cur.type === "niva") return "Or ask Niva";
  return null;
}

type Props = {
  listId: string;
  rows: readonly UiRow[];
  active: number;
  understood: string | null;
  /** On Giving pages a family (or an adult's family) opens its giving in place: the rows are buttons, not links. */
  inPlace?: boolean;
  onHover: (index: number) => void;
  onPick: (row: UiRow) => void;
  hints: ReactNode;
};

const GIVING_MARK: Record<GivingRow["kind"], string> = { record: "+", record_pledge: "+", go: "→", payment: "R", pledge: "P", bank: "B", campaign: "C" };
const GIVING_PILL: Record<GivingRow["kind"], string> = { record: "Opens the sheet", record_pledge: "Opens the sheet", go: "Opens the list", payment: "Payment", pledge: "Pledge", bank: "Bank line", campaign: "Campaign" };

/** A Giving row: what it is, its facts, and the household card line whenever a family is involved (never a name alone). */
function GivingBody({ row }: { row: GivingRow }) {
  const household = "household" in row ? row.household : null;
  const big = isRecordRow(row) && row.best;
  return (
    <>
      <span
        aria-hidden="true"
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold ${isRecordRow(row) ? "bg-navy text-white" : "bg-[var(--v2-sun-tint)] text-[var(--v2-sun-ink)]"}`}
      >
        {GIVING_MARK[row.kind]}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block font-bold text-ink ${big ? "text-[16px]" : "truncate text-[15px]"}`}>{row.title}</span>
        {household ? (
          <span className="block truncate text-[13px] text-muted">
            {household.name} · {household.cardLine}
          </span>
        ) : null}
        <span className={`block text-[13px] text-muted ${big ? "" : "truncate"}`}>{row.detail}</span>
      </span>
      <span className={`${PILL} hidden sm:inline`}>{GIVING_PILL[row.kind]}</span>
    </>
  );
}

/** The rows under the find box: "I understood", the best match first, then families, then people; each with the household card line. */
export function FindRows({ listId, rows, active, understood, inPlace = false, onHover, onPick, hints }: Props) {
  const items = selectable(rows);
  const indexOf = (row: UiRow) => items.indexOf(row);
  return (
    <div id={listId} role="listbox" aria-label="Search results" className="max-h-[min(70vh,640px)] overflow-y-auto p-2">
      {understood ? (
        <p className="m-0 px-3 pb-1.5 pt-1 text-[12px] text-muted">
          I understood: <strong className="font-bold text-ink">{understood}</strong>
        </p>
      ) : null}
      {rows.map((row, i) => {
        const heading = headingFor(rows, i);
        const idx = indexOf(row);
        const selected = idx === active;
        const common = {
          id: idx >= 0 ? `${listId}-o-${idx}` : undefined,
          role: "option" as const,
          "aria-selected": selected,
          onMouseEnter: () => onHover(idx),
        };
        const bg = selected ? "bg-navy-50" : "hover:bg-ground";
        let body: ReactNode = null;
        if (row.type === "message") {
          return (
            <p key={row.key} role={row.tone === "problem" ? "alert" : "status"} className={`m-0 px-3 py-2.5 text-[13px] ${row.tone === "problem" ? "text-danger" : "text-ink-2"}`}>
              {row.text}
            </p>
          );
        }
        if (row.type === "giving") {
          const big = isRecordRow(row.row) && row.row.best;
          body = (
            <button type="button" {...common} onClick={() => onPick(row)} className={`${ROW} ${bg} ${big ? "border border-navy-300" : ""}`}>
              <GivingBody row={row.row} />
            </button>
          );
        } else if (row.type === "family") {
          const r = row.row;
          const inner = (
            <>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy">
                <HomeIcon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-ink">{r.title}</span>
                <span className="block truncate text-[13px] text-muted">{r.cardLine}</span>
              </span>
              <span className={PILL}>{r.why.label}</span>
            </>
          );
          body = inPlace ? (
            <button type="button" {...common} onClick={() => onPick(row)} className={`${ROW} ${bg}`}>
              {inner}
            </button>
          ) : (
            <Link href={r.href} {...common} onClick={() => onPick(row)} className={`${ROW} ${bg}`}>
              {inner}
            </Link>
          );
        } else if (row.type === "person" && inPlace && opensInPlace(row)) {
          const r = row.row;
          body = (
            <button type="button" {...common} onClick={() => onPick(row)} className={`${ROW} ${bg}`}>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${toneFor(r.id)}`} aria-hidden="true">
                {initialsOf(r.title)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-ink">{r.title}</span>
                <span className="block truncate text-[13px] text-muted">
                  {r.subtitle}
                  {r.familyName ? ` · in ${r.familyName}` : ""}
                  {r.cardLine ? ` · ${r.cardLine}` : ""}
                </span>
              </span>
              <span className={PILL}>{r.why.label}</span>
            </button>
          );
        } else if (row.type === "person") {
          const r = row.row;
          body = (
            <Link href={r.href} {...common} onClick={() => onPick(row)} className={`${ROW} ${bg}`}>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${toneFor(r.id)}`} aria-hidden="true">
                {initialsOf(r.title)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-ink">{r.title}</span>
                <span className="flex items-center gap-1 truncate text-[13px] text-muted">
                  {r.child ? <LockIcon /> : null}
                  <span className="truncate">
                    {r.subtitle}
                    {r.familyName ? ` · in ${r.familyName}` : ""}
                    {r.cardLine ? ` · ${r.cardLine}` : ""}
                  </span>
                </span>
              </span>
              <span className={PILL}>{r.why.label}</span>
            </Link>
          );
        } else if (row.type === "filter") {
          body = (
            <Link href={row.filter.href} {...common} onClick={() => onPick(row)} className={`${ROW} ${bg}`}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy">
                <ListIcon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-ink">{row.filter.label ?? `Show these families: ${row.filter.understood}`}</span>
                <span className="block truncate text-[13px] text-muted">
                  {row.filter.list === "people" ? "As a list of adults, with the filters as chips you can change. You can export it there." : "The same words as a list, with the filters as chips you can change."}
                </span>
              </span>
              <span className={PILL}>List</span>
            </Link>
          );
        } else if (row.type === "niva") {
          body = (
            <button type="button" {...common} onClick={() => onPick(row)} className={`${ROW} ${bg}`}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--v2-sun-tint)]">
                <SparkIcon size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-ink">Ask Niva: “{row.text}”</span>
                <span className="block text-[13px] text-muted">Niva answers from your own data and shows the household card for every family it names. Nothing about children is sent to it.</span>
              </span>
              <span className={`${PILL} border-[var(--v2-sun-ink)]/30 bg-[var(--v2-sun-tint)] text-[var(--v2-sun-ink)]`}>Question</span>
            </button>
          );
        } else {
          body = (
            <button type="button" {...common} onClick={() => onPick(row)} className={`${ROW} ${bg} border-t border-line-soft`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold text-ink-2">All actions…</span>
                <span className="block text-[13px] text-muted">Open the command palette to do something, not just find it.</span>
              </span>
            </button>
          );
        }
        return (
          <div key={row.key}>
            {heading ? <Heading>{heading}</Heading> : null}
            {body}
          </div>
        );
      })}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft px-3 pb-1 pt-2 text-[12px] text-muted">{hints}</div>
    </div>
  );
}
