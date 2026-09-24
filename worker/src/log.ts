// Structured logs: one JSON object per line on stdout (journald keeps them).
// Secrets never reach a log line: any field whose name looks like a secret is
// replaced, whatever its value, and URLs lose their query strings.

export type Level = "debug" | "info" | "warn" | "error";
export type Fields = Record<string, unknown>;
export type Logger = {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(fields: Fields): Logger;
};

const SECRET_KEY = /(secret|token|password|passwd|api[_-]?key|authorization|cookie|credential|private[_-]?key|^code$|authorization_code|database_url|dsn)/i;
const URL_WITH_QUERY = /\b(https?:\/\/[^\s?#"']+)\?[^\s"']*/gi;
const CONN_STRING_PASSWORD = /\b(postgres(?:ql)?:\/\/[^:/\s@]+):[^@\s]+@/gi;

/** Strip anything that could carry a secret out of free text (error messages, URLs). */
export function scrubText(text: string): string {
  return text.replace(CONN_STRING_PASSWORD, "$1:[redacted]@").replace(URL_WITH_QUERY, "$1?[redacted]");
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return scrubText(value);
  if (value instanceof Error) return { name: value.name, message: scrubText(value.message) };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  return value;
}

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(base: Fields = {}, opts: { level?: Level; write?: (line: string) => void } = {}): Logger {
  const min = ORDER[opts.level ?? "info"];
  const write = opts.write ?? ((line: string) => process.stdout.write(line + "\n"));
  const emit = (level: Level, msg: string, fields?: Fields) => {
    if (ORDER[level] < min) return;
    const record = { ts: new Date().toISOString(), level, msg: scrubText(msg), ...(redact({ ...base, ...fields }) as Fields) };
    write(JSON.stringify(record));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (fields) => createLogger({ ...base, ...fields }, opts),
  };
}
