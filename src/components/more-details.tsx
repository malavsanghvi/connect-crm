import Link from "next/link";
import type React from "react";

import { CustomFieldsEditor } from "@/components/custom-fields-editor";
import { Card, DrawerSection, KeyValueRow, capitalize } from "@/components/ui";
import { customRows, entityLabel } from "@/lib/custom-fields";
import { loadCustomFieldDefs, loadCustomValues } from "@/lib/data/custom-fields";
import { explainError } from "@/lib/errors";
import type { CrmSession } from "@/lib/session";

/**
 * "More details": a record's custom fields (the columns an import kept, and
 * fields added in Settings › Custom fields), editable in place by whoever may
 * edit the record. Renders nothing when the kind of record has no fields.
 */
export async function MoreDetails({
  session,
  entity,
  recordId,
  editable,
  path,
  title = "More details",
  variant = "section",
  className,
}: {
  session: CrmSession;
  entity: string;
  recordId: string;
  editable: boolean;
  path?: string;
  title?: string;
  /** "card" on full-record pages, "section" inside drawers. */
  variant?: "section" | "card";
  className?: string;
}) {
  const wrap = (children: React.ReactNode) =>
    variant === "card" ? (
      <Card title={title} className={className} description="Custom fields · kept from imports or added in Settings › Custom fields">
        {children}
      </Card>
    ) : (
      <DrawerSection title={title}>{children}</DrawerSection>
    );
  const loaded = await loadCustomFieldDefs(session.db, session.center.id, entity, true);
  if (loaded.missing) return null;
  if (loaded.error) {
    return (
      wrap(<KeyValueRow label="Could not load the custom fields" value={capitalize(explainError(loaded.error))} tone="bad" />)
    );
  }
  if (loaded.defs.length === 0) return null;
  // Always read through app.custom_values: the row's own `custom` column no longer holds the
  // staff-only values (0401), so a value the caller already has may be incomplete.
  const v = await loadCustomValues(session.db, entity, recordId);
  if (v.error) {
    return (
      wrap(<KeyValueRow label="Could not load these details" value={capitalize(explainError(v.error))} tone="bad" />)
    );
  }
  const rows = customRows(loaded.defs, v.custom);
  if (rows.length === 0) return null;
  return (
    wrap(
      <>
      <CustomFieldsEditor rows={rows} entity={entity} recordId={recordId} editable={editable} currency={session.center.currency} path={path} />
      {session.permissions.includes("settings.manage") || session.isPlatformAdmin ? (
        <Link href="/settings/custom-fields" className="text-[12px] text-muted underline">
          Manage the {entityLabel(entity).toLowerCase()} custom fields
        </Link>
      ) : null}
      </>,
    )
  );
}
