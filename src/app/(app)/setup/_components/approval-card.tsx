import { ActionForm, type FormAction } from "@/components/action-form";
import { Card, StatusText, type BlockSpan } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { approvalView, type ApprovalState } from "@/lib/setup";

/**
 * A go-live approval (readiness checks 8 and 12, migration 0300): what is being approved,
 * who approved it and when, whether it changed since, and — for the person allowed to —
 * the Approve button. Full versions of both checks come later; the card says so.
 */
export function ApprovalCard({
  testId,
  title,
  what,
  later,
  state,
  canApprove,
  whoMayApprove,
  action,
  timeZone,
  span = 12,
}: {
  testId: string;
  title: string;
  what: string;
  later: string;
  state: ApprovalState | null;
  canApprove: boolean;
  whoMayApprove: string;
  action: FormAction;
  timeZone: string;
  span?: BlockSpan;
}) {
  const v = approvalView(state);
  return (
    <Card
      span={span}
      title={title}
      description="Go-live readiness"
      actions={<StatusText tone={v.tone}>{v.label}</StatusText>}
    >
      <div className="flex flex-col gap-2 text-[13px]" data-testid={testId} data-approval={v.state}>
        <p>{what}</p>
        {state && v.state !== "none" && state.approved_at ? (
          <p className="text-muted">
            {v.state === "changed" ? "Last approved" : "Approved"} by {state.approved_by_name ?? "someone"}
            {state.approver_role ? ` (${state.approver_role})` : ""} on {formatDateTime(state.approved_at, timeZone)}
            {state.note ? ` · “${state.note}”` : ""}
            {v.state === "changed" ? " — it has changed since, so it needs approving again." : "."}
          </p>
        ) : null}
        <p className="text-[12px] text-muted">{later}</p>
        {canApprove && v.state !== "current" ? (
          <ActionForm action={action} submitLabel={v.state === "changed" ? "Approve the new version" : "Approve"} variant="ok" size="sm" className="mt-1 flex flex-wrap items-end gap-2">
            <input name="note" className="crm-input w-[320px]" maxLength={1000} placeholder="Note (optional, e.g. reviewed with the accountant)" aria-label={`Note for ${title}`} />
          </ActionForm>
        ) : !canApprove && v.state !== "current" ? (
          <p className="text-[12px] font-semibold text-muted">{whoMayApprove}</p>
        ) : null}
      </div>
    </Card>
  );
}
