"use client";

import { useState, useTransition, type KeyboardEvent } from "react";

import { ActionForm } from "@/components/action-form";
import { buttonClass } from "@/components/ui";

import { grantRoleAction, searchPeopleAction, type PersonOption } from "./actions";

export type RoleOption = { key: string; name: string; tier: string; default_scope: string };
export type ScopeOption = { id: string; label: string };

const SCOPE_LABEL: Record<string, string> = { center: "Whole center", event: "One event", class: "One Pathshala class", zone: "One zone" };

function defaultScopeFor(role: RoleOption | undefined): string {
  if (!role) return "center";
  return ["event", "class", "zone"].includes(role.default_scope) ? role.default_scope : "center";
}

export function GrantForm({
  roles,
  scopes,
  orgMemberLabel,
  today,
}: {
  roles: RoleOption[];
  scopes: Record<"event" | "class" | "zone", ScopeOption[]>;
  orgMemberLabel: string;
  today: string;
}) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<PersonOption[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [roleKey, setRoleKey] = useState(roles[0]?.key ?? "");
  const [scopeKind, setScopeKind] = useState(defaultScopeFor(roles[0]));
  const [pending, startTransition] = useTransition();
  const tiers = [...new Set(roles.map((r) => r.tier))];

  function search() {
    setSearchError(null);
    startTransition(async () => {
      try {
        const res = await searchPeopleAction(query);
        if (!res.ok) {
          setPeople(null);
          setSearchError(res.error);
        } else setPeople(res.data ?? []);
      } catch (err) {
        console.error("[roles] person search failed:", err);
        setSearchError("Could not search people — the server did not respond. Try again.");
      }
    });
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      search();
    }
  }

  return (
    <div className="space-y-4">
      {person ? (
        <div className="rounded-lg border border-navy bg-white px-4 py-3 ring-2 ring-navy/20">
          <p className="font-semibold">{person.name}</p>
          <p className="text-sm text-muted">
            {[person.member_number, person.org_member_ids.length ? `${orgMemberLabel} ${person.org_member_ids.join(", ")}` : null, person.email, person.household_name ? `${person.household_name} ${person.household_number ?? ""}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <button type="button" onClick={() => setPerson(null)} className={`${buttonClass("ghost", "sm")} mt-1`}>
            Choose someone else
          </button>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[14rem] flex-1">
              <label htmlFor="grant-search" className="crm-label">
                Person
              </label>
              <input
                id="grant-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder={`Name, email, member number or ${orgMemberLabel}`}
                className="crm-input"
                autoComplete="off"
              />
            </div>
            <button type="button" onClick={search} disabled={pending} className={buttonClass("secondary")}>
              {pending ? "Searching…" : "Search"}
            </button>
          </div>
          {searchError ? (
            <p role="alert" className="mt-2 text-sm text-maroon">
              {searchError}
            </p>
          ) : null}
          {people ? (
            people.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No one matches.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-white">
                {people.map((p) => (
                  <li key={p.person_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{p.name}</p>
                      <p className="text-xs text-muted">
                        {[p.member_number, p.org_member_ids.length ? `${orgMemberLabel} ${p.org_member_ids.join(", ")}` : null, p.email, p.household_name]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    {p.user_id ? (
                      <button type="button" onClick={() => setPerson(p)} className={buttonClass("primary", "sm")}>
                        Choose
                      </button>
                    ) : (
                      <span className="text-xs text-muted">No app login yet — they must sign in to Connect once first</span>
                    )}
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      )}

      {person ? (
        <ActionForm action={grantRoleAction} submitLabel={`Grant to ${person.name}`} pendingLabel="Granting…">
          <input type="hidden" name="user_id" value={person.user_id ?? ""} />
          <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="grant-role" className="crm-label">
                Role
              </label>
              <select
                id="grant-role"
                name="role_key"
                value={roleKey}
                onChange={(e) => {
                  setRoleKey(e.target.value);
                  setScopeKind(defaultScopeFor(roles.find((r) => r.key === e.target.value)));
                }}
                className="crm-input"
              >
                {tiers.map((t) => (
                  <optgroup key={t} label={`${t[0].toUpperCase()}${t.slice(1)} roles`}>
                    {roles
                      .filter((r) => r.tier === t)
                      .map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="grant-scope" className="crm-label">
                Scope
              </label>
              <select id="grant-scope" name="scope_kind" value={scopeKind} onChange={(e) => setScopeKind(e.target.value)} className="crm-input">
                {Object.entries(SCOPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              {scopeKind !== "center" ? (
                <p className="crm-hint">Scoped roles work only for that {scopeKind}; they never give center-wide permissions.</p>
              ) : null}
            </div>
            {scopeKind !== "center" ? (
              <div>
                <label htmlFor="grant-target" className="crm-label">
                  Which {scopeKind}
                </label>
                <select id="grant-target" name="scope_id" key={scopeKind} required className="crm-input">
                  <option value="">Choose…</option>
                  {(scopes[scopeKind as "event" | "class" | "zone"] ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div>
              <label htmlFor="grant-ends" className="crm-label">
                Ends on (optional)
              </label>
              <input id="grant-ends" name="ends_on" type="date" min={today} className="crm-input" />
              <p className="crm-hint">Leave empty for no end date. Event-day volunteers usually end the same day.</p>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="grant-reason" className="crm-label">
                Reason (optional, kept in the audit log)
              </label>
              <input id="grant-reason" name="reason" maxLength={500} className="crm-input" />
            </div>
          </div>
        </ActionForm>
      ) : null}
    </div>
  );
}
