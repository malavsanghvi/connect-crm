import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { DrawerForm } from "@/components/drawer-form";
import { Card, EmptyState, QueryError, TableWrap } from "@/components/ui";
import { personNames } from "@/lib/data/content-comms";
import { formatDate } from "@/lib/dates";
import { readPublicEnv } from "@/lib/env";
import { getSession } from "@/lib/session";
import { LEADER_BODIES, publicObjectUrl } from "@/lib/setup";

import { uploadLeaderPhotoAction, saveLeaderAction } from "../actions";
import { SetupHeader, setupGate } from "../_components/setup-ui";
import { LeaderFields, type LeaderView } from "./leader-fields";

export const metadata: Metadata = { title: "Leaders · Setup" };

const SUB = "Step 0.3 · key leaders · shown publicly in the member app's Guide › Administration";

export default async function LeadersPage() {
  const session = await getSession();
  const gate = setupGate(session, SUB, "Leaders");
  if (gate) return gate;
  const { db, center } = session;
  const res = await db
    .from("org_leaders")
    .select("id, person_id, full_name, title, body, term_start, term_end, photo_path, show_publicly, sort")
    .eq("center_id", center.id)
    .order("sort")
    .order("full_name");
  const addButton = (
    <DrawerForm label="Add leader" kicker="Leaders" title="Add a leader" action={saveLeaderAction} submitLabel="Add leader">
      <LeaderFields leader={null} />
    </DrawerForm>
  );
  if (res.error) {
    return (
      <>
        <SetupHeader session={session} sub={SUB} actions={addButton} />
        <QueryError what="the leaders" error={res.error} retryHref="/setup/leaders" />
      </>
    );
  }
  const leaders = res.data ?? [];
  const names = await personNames(db, leaders.map((l) => l.person_id));
  const env = readPublicEnv();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <SetupHeader session={session} sub={SUB} actions={addButton} />
      <Card
        title="Key leaders"
        description="President, Secretary, Treasurer, EC members, trustees · link each to their person record once people are imported"
        padded={false}
      >
        {leaders.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No leaders yet">Add the President, Secretary and Treasurer first. The authorized signer on statements is set in Legal identity.</EmptyState>
          </div>
        ) : (
          <TableWrap>
            <table className="crm-table" aria-label="Key leaders">
              <thead>
                <tr>
                  <th aria-label="Photo" />
                  <th>Name</th>
                  <th>Title</th>
                  <th>Group</th>
                  <th>Term</th>
                  <th>Person record</th>
                  <th>Public</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {leaders.map((l) => {
                  const photo = l.photo_path && env.ok ? publicObjectUrl(env.env.supabaseUrl, "branding", l.photo_path) : null;
                  const ended = l.term_end !== null && l.term_end < today;
                  const view: LeaderView = { ...l, person_name: l.person_id ? (names.get(l.person_id) ?? "Linked person") : null };
                  return (
                    <tr key={l.id} data-leader={l.full_name}>
                      <td>
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photo} alt={`Photo of ${l.full_name}`} className="h-9 w-9 rounded-full object-cover" />
                        ) : (
                          <span aria-hidden className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-navy-50 text-[12px] font-bold text-navy">
                            {l.full_name
                              .split(/\s+/)
                              .map((w) => w[0])
                              .slice(0, 2)
                              .join("")
                              .toUpperCase()}
                          </span>
                        )}
                      </td>
                      <td className="font-bold">{l.full_name}</td>
                      <td>{l.title}</td>
                      <td>{LEADER_BODIES.find((b) => b.value === l.body)?.label ?? l.body}</td>
                      <td className="text-[12px]">
                        {l.term_start ? formatDate(l.term_start, center.time_zone) : "—"} – {l.term_end ? formatDate(l.term_end, center.time_zone) : "ongoing"}
                        {ended ? <span className="ml-1 font-semibold text-faint">(ended)</span> : null}
                      </td>
                      <td>{view.person_name ?? <span className="text-faint">Not linked</span>}</td>
                      <td>{l.show_publicly && !ended ? "Shown" : <span className="text-faint">Hidden</span>}</td>
                      <td className="text-right">
                        <DrawerForm
                          label="Edit"
                          variant="ghost"
                          size="xs"
                          kicker="Leaders"
                          title={l.full_name}
                          subtitle={l.title}
                          action={saveLeaderAction}
                          submitLabel="Save leader"
                          resetOnSuccess={false}
                          intro={
                            <ActionForm action={uploadLeaderPhotoAction} submitLabel={photo ? "Replace photo" : "Upload photo"} pendingLabel="Uploading…" size="sm" resetOnSuccess buttonsClassName="mt-2">
                              <input type="hidden" name="id" value={l.id} />
                              <label className="crm-label" htmlFor={`photo-${l.id}`}>
                                Photo
                              </label>
                              <input id={`photo-${l.id}`} name="file" type="file" accept="image/png,image/jpeg,image/webp" className="crm-input text-[12px]" required />
                              <p className="crm-hint">Shown publicly with the leader. PNG, JPEG or WebP up to 5 MB.</p>
                            </ActionForm>
                          }
                        >
                          <LeaderFields leader={view} />
                        </DrawerForm>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <p className="crm-hint mt-3">
        Leaders marked public, whose term has not ended, appear in the member app&apos;s Administration list (they are kept in step with Content › Guide &amp; directory).
        Remove someone by ending their term or hiding them; nothing is deleted.
      </p>
    </>
  );
}
