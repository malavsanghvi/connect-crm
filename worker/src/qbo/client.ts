// One QuickBooks company, as the background service talks to it: the
// connection (app.qbo_worker_connection), its tokens from the vault (renewed
// when they are about to expire, or when QuickBooks says they are no good),
// and the three calls we use: query, read one, create.

import { PermanentError } from "../errors";
import { HttpError } from "../http";
import type { JobContext } from "../types";
import { apiBase, faultMessage, MINOR_VERSION, ReconnectNeededError, tokenRequest, type IntuitApp, type Tokens } from "./intuit";

export type QboConnection = {
  id: string;
  center_id: string;
  provider: "quickbooks_online" | "intuit_sandbox";
  status: string;
  realm_id: string | null;
  display_name: string | null;
  environment: string;
  settings: Record<string, unknown>;
  api: IntuitApp;
  read_only: boolean;
  module_on: boolean;
};

export async function loadConnection(ctx: JobContext, id: string): Promise<QboConnection> {
  const rows = await ctx.db.query<{ c: QboConnection }>("select app.qbo_worker_connection($1) as c", [id]);
  const c = rows[0]?.c;
  if (!c) throw new PermanentError(`QuickBooks connection ${id} was not found.`);
  return c;
}

/** A QuickBooks answer that is final (validation / business rule): retrying the same thing cannot help. */
export class QboRejectedError extends PermanentError {
  override name = "QboRejectedError";
}

export class QboClient {
  private access: string | null = null;
  private accessExpires: number;

  constructor(
    private readonly ctx: JobContext,
    readonly conn: QboConnection,
  ) {
    this.accessExpires = Date.parse(String(conn.settings.access_expires_at ?? "")) || 0;
  }

  static async open(ctx: JobContext, connectionId: string): Promise<QboClient> {
    const conn = await loadConnection(ctx, connectionId);
    if (conn.status === "disconnected") throw new PermanentError("QuickBooks is disconnected; connect it again to continue.");
    if (!conn.realm_id) throw new PermanentError("The QuickBooks company is not known yet; connect QuickBooks again.");
    if (!conn.module_on) throw new PermanentError("The Accounting module is switched off for this community.");
    return new QboClient(ctx, conn);
  }

  /** Swap the refresh token for new tokens, store them, and record the new expiries. */
  async refresh(): Promise<Tokens> {
    const rt = await this.ctx.secret(this.conn.id, "refresh_token");
    if (!rt) {
      await this.problem("No QuickBooks sign-in is stored for this company. Connect QuickBooks again.", true);
      throw new ReconnectNeededError("No QuickBooks sign-in is stored for this company. Connect QuickBooks again.");
    }
    let t: Tokens;
    try {
      t = await tokenRequest(this.ctx.http, this.ctx.env, this.conn.api, { grant_type: "refresh_token", refresh_token: rt });
    } catch (err) {
      if (err instanceof ReconnectNeededError) await this.problem(err.message, true);
      throw err;
    }
    await this.ctx.storeSecret(this.conn.id, "access_token", t.accessToken);
    await this.ctx.storeSecret(this.conn.id, "refresh_token", t.refreshToken);
    await this.ctx.db.query("select app.qbo_worker_tokens_refreshed($1, $2, $3)", [this.conn.id, t.accessExpiresAt, t.refreshExpiresAt]);
    this.access = t.accessToken;
    this.accessExpires = Date.parse(t.accessExpiresAt);
    return t;
  }

  async problem(text: string, reconnect: boolean): Promise<void> {
    try {
      await this.ctx.db.query("select app.qbo_worker_connection_problem($1, $2, $3)", [this.conn.id, text, reconnect]);
    } catch (err) {
      this.ctx.log.error("could not record the QuickBooks connection problem", { error: err, problem: text });
    }
  }

  private async token(): Promise<string> {
    if (this.access && this.accessExpires > Date.now() + 5 * 60000) return this.access;
    if (this.accessExpires > Date.now() + 5 * 60000) {
      const stored = await this.ctx.secret(this.conn.id, "access_token");
      if (stored) {
        this.access = stored;
        return stored;
      }
    }
    return (await this.refresh()).accessToken;
  }

  private url(path: string, params: Record<string, string> = {}): string {
    const u = new URL(`${apiBase(this.ctx.env, this.conn.api)}/v3/company/${encodeURIComponent(this.conn.realm_id!)}/${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set("minorversion", MINOR_VERSION);
    return u.toString();
  }

  /** One call; a 401 renews the sign-in once and tries again. */
  private async call<T>(method: "GET" | "POST", path: string, params: Record<string, string>, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.token();
      const res = await this.ctx.http.request(this.url(path, params), {
        method,
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        body,
        timeoutMs: 30000,
      });
      if (res.status === 401 && attempt === 0) {
        this.access = null;
        this.accessExpires = 0;
        continue;
      }
      let json: unknown = null;
      try {
        json = res.json();
      } catch {
        json = null;
      }
      if (res.ok) return json as T;
      const msg = faultMessage(json, res.status);
      if (res.status === 401 || res.status === 403) {
        await this.problem(msg, res.status === 401);
        throw new ReconnectNeededError(msg);
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw new QboRejectedError(msg);
      throw new HttpError(msg, res.status);
    }
    throw new ReconnectNeededError("QuickBooks refused the renewed sign-in. Connect QuickBooks again.");
  }

  /** Every row of an entity (paged, 1000 at a time), including inactive ones when asked. */
  async queryAll<T = Record<string, unknown>>(entity: string, where = "", pageSize = 1000): Promise<T[]> {
    const out: T[] = [];
    for (let start = 1; start < 1_000_000; start += pageSize) {
      const q = `select * from ${entity}${where ? ` where ${where}` : ""} STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
      const res = await this.call<{ QueryResponse?: Record<string, unknown> }>("GET", "query", { query: q });
      const rows = (res?.QueryResponse?.[entity] as T[] | undefined) ?? [];
      out.push(...rows);
      if (rows.length < pageSize) break;
    }
    return out;
  }

  async companyName(): Promise<string | null> {
    const res = await this.call<{ CompanyInfo?: { CompanyName?: string } }>("GET", `companyinfo/${encodeURIComponent(this.conn.realm_id!)}`, {});
    return res?.CompanyInfo?.CompanyName ?? null;
  }

  /** Create an entity; requestid makes a retry return the first result instead of posting twice. */
  async create(entity: string, doc: unknown, requestId: string): Promise<{ Id: string } & Record<string, unknown>> {
    const res = await this.call<Record<string, { Id?: string } & Record<string, unknown>>>("POST", entity.toLowerCase(), { requestid: requestId }, doc);
    const saved = res?.[entity];
    if (!saved?.Id) throw new HttpError(`QuickBooks did not return the new ${entity}'s id`, null);
    return saved as { Id: string } & Record<string, unknown>;
  }
}
