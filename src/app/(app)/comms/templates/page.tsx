import type { Metadata } from "next";
import Link from "next/link";

import { BlockGrid, Card, EmptyState, QueryError, TableWrap, buttonClass } from "@/components/ui";
import { channelsLine, TEMPLATE_NOTE, templateTokens, WHATSAPP_TEMPLATE_NOTE } from "@/lib/comms-templates";
import { loadTemplates } from "@/lib/data/comms-templates";
import { userNames } from "@/lib/data/lookups";
import { formatDate } from "@/lib/dates";
import { getSession } from "@/lib/session";

import { CommsHeader, commsGate } from "../shared";

import { TemplateRowActions } from "./template-row-actions";

export const metadata: Metadata = { title: "Communications · Saved templates" };

const SUB = "Saved starting points for the words of a communication · the audience and the results are never saved";

/**
 * Communications › Templates: the community's saved templates, who made each and when, with Use, Rename and Delete. A template is made
 * with "Save as template" on any communication, and used from "Start from" on the Newsletters tab. Only people who write communications
 * (comms.send) see it: reading a template follows the permission that creates a communication.
 */
export default async function TemplatesPage() {
  const session = await getSession();
  const gate = commsGate(session, "commsSend", SUB);
  if (gate) return gate;
  const { db, center } = session;
  const tz = center.time_zone;

  const templates = await loadTemplates(db, center.id);
  const list = templates.data;
  const people = await userNames(db, center.id, list.flatMap((t) => [t.created_by, t.updated_by]));
  const who = (id: string | null) => (id === session.userId ? "You" : (people.get(id ?? "")?.name ?? "Staff"));

  return (
    <>
      <CommsHeader
        sub={SUB}
        actions={
          <Link href="/comms/newsletters" className={buttonClass("ghost", "md")}>
            Start a communication
          </Link>
        }
      />
      <BlockGrid>
        <Card title="Saved templates" description={TEMPLATE_NOTE} span={12} padded={false}>
          {templates.error ? (
            <div className="p-4">
              <QueryError what="the saved templates" error={templates.error} retryHref="/comms/templates" />
            </div>
          ) : list.length === 0 ? (
            <EmptyState title="No saved templates yet">Open any communication and choose Save as template. It then appears under Start from › A saved template.</EmptyState>
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Channels</th>
                    <th>Subject</th>
                    <th>Merge fields</th>
                    <th>Made by</th>
                    <th>Last saved</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((t) => {
                    const tokens = templateTokens(t);
                    return (
                      <tr key={t.id}>
                        <td className="font-bold">{t.name}</td>
                        <td>
                          {channelsLine(t.channels)}
                          {t.channels.includes("whatsapp") ? <span className="block text-[12px] font-normal text-brown">Starting point for the words only. Not approved by WhatsApp.</span> : null}
                        </td>
                        <td>{t.title || "—"}</td>
                        <td className="font-mono text-[12px]">{tokens.length > 0 ? tokens.join(", ") : "—"}</td>
                        <td>{who(t.created_by)}</td>
                        <td className="whitespace-nowrap">
                          {formatDate(t.updated_at, tz)}
                          {t.updated_by && t.updated_by !== t.created_by ? <span className="block text-[12px] text-muted">by {who(t.updated_by)}</span> : null}
                        </td>
                        <td className="text-right">
                          <TemplateRowActions id={t.id} name={t.name} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        {list.some((t) => t.channels.includes("whatsapp")) ? (
          <p role="note" className="col-span-12 text-[13px] text-muted">
            {WHATSAPP_TEMPLATE_NOTE}
          </p>
        ) : null}
      </BlockGrid>
    </>
  );
}
