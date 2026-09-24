"use client";

import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { buttonClass } from "@/components/ui";
import { ATTENDANCE_STATUSES, formatRate, summarizeAttendance, type AttendanceStatus } from "@/lib/logic/attendance";
import { attendanceQrPayload, randomToken, secondsLeft, tokenExpiry } from "@/lib/logic/tokens";

import { closeAttendanceQr, markAllPresent, markAttendance, openAttendanceQr } from "../../../actions";

type Student = { enrollmentId: string; name: string };
type Mark = { status: AttendanceStatus; note: string | null };
type RowState = { saving: boolean; error: string | null; savedAt: number | null };

const LABELS: Record<AttendanceStatus, string> = { present: "Present", late: "Late", absent: "Absent", excused: "Excused" };
const ON_STYLE: Record<AttendanceStatus, string> = {
  present: "bg-success text-white border-success",
  late: "bg-brown text-white border-brown",
  absent: "bg-danger text-white border-danger",
  excused: "bg-navy text-white border-navy",
};
const OFF_STYLE = "bg-white text-ink border-line hover:bg-ground";

export function AttendanceSheet({
  classId,
  heldOn,
  students,
  serverMarks,
  readOnly,
  qr,
}: {
  classId: string;
  heldOn: string;
  students: Student[];
  serverMarks: Record<string, Mark>;
  readOnly: boolean;
  qr: { token: string; expiresAt: string } | null;
}) {
  const router = useRouter();
  // Local edits overlay what the server sent; a refresh never clobbers a tap in flight.
  const [local, setLocal] = useState<Record<string, Mark>>({});
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});
  const [bulk, setBulk] = useState<{ pending: boolean; error: string | null; message: string | null }>({ pending: false, error: null, message: null });

  const marks = useMemo(() => ({ ...serverMarks, ...local }), [serverMarks, local]);
  const summary = summarizeAttendance(
    students.map((s) => s.enrollmentId),
    Object.entries(marks).map(([enrollment_id, m]) => ({ enrollment_id, status: m.status })),
  );

  const save = useCallback(
    async (enrollmentId: string, status: AttendanceStatus, note: string | null) => {
      setLocal((cur) => ({ ...cur, [enrollmentId]: { status, note } }));
      setRowState((cur) => ({ ...cur, [enrollmentId]: { saving: true, error: null, savedAt: null } }));
      let result;
      try {
        result = await markAttendance({ classId, heldOn, enrollmentId, status, note });
      } catch (error) {
        console.error("[attendance] save failed to reach the server", error);
        result = { ok: false as const, error: "Not saved — the server can't be reached. Check your connection and tap Try again." };
      }
      setRowState((cur) => ({
        ...cur,
        [enrollmentId]: result.ok ? { saving: false, error: null, savedAt: Date.now() } : { saving: false, error: result.error, savedAt: null },
      }));
    },
    [classId, heldOn],
  );

  async function markRestPresent() {
    const unmarked = students.filter((s) => !marks[s.enrollmentId]).map((s) => s.enrollmentId);
    if (!unmarked.length) return;
    setBulk({ pending: true, error: null, message: null });
    let result;
    try {
      result = await markAllPresent({ classId, heldOn, enrollmentIds: unmarked });
    } catch (error) {
      console.error("[attendance] bulk save failed to reach the server", error);
      result = { ok: false as const, error: "Not saved — the server can't be reached. Check your connection and try again." };
    }
    if (result.ok) {
      setLocal((cur) => ({ ...cur, ...Object.fromEntries(unmarked.map((id) => [id, { status: "present" as const, note: null }])) }));
      setBulk({ pending: false, error: null, message: `${unmarked.length} marked present.` });
    } else {
      setBulk({ pending: false, error: result.error, message: null });
    }
  }

  return (
    <div>
      <div className="sticky top-[60px] z-10 -mx-4 mb-4 border-b border-line bg-ground/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm" aria-live="polite">
            <strong className="text-lg">{summary.attended}</strong> of {summary.total} here
            <span className="text-muted">
              {" "}
              · {summary.present} present · {summary.late} late · {summary.absent} absent · {summary.excused} excused
              {summary.unmarked > 0 ? ` · ${summary.unmarked} not marked` : ""} · {formatRate(summary.rate)}
            </span>
          </p>
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass("ghost")} disabled={bulk.pending || summary.unmarked === 0} onClick={markRestPresent}>
                {bulk.pending ? "Saving…" : "Mark the rest present"}
              </button>
              <QrButton classId={classId} heldOn={heldOn} initial={qr} onVisibleChange={(open) => open && router.refresh()} />
            </div>
          )}
        </div>
        {bulk.message && (
          <p role="status" className="mt-1 text-sm font-semibold text-success">
            ✓ {bulk.message}
          </p>
        )}
        {bulk.error && (
          <p role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">
            {bulk.error}
            <button type="button" className={buttonClass("bad")} onClick={markRestPresent}>
              Try again
            </button>
          </p>
        )}
      </div>

      {students.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-muted">No students are placed in this class yet.</p>
      ) : (
        <ul className="space-y-3">
          {students.map((s) => {
            const m = marks[s.enrollmentId];
            const st = rowState[s.enrollmentId];
            return (
              <li key={s.enrollmentId} className="cc-card p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-lg font-semibold">{s.name}</p>
                  <span className="text-sm" aria-live="polite">
                    {st?.saving ? (
                      <span className="text-muted">Saving…</span>
                    ) : st?.error ? null : st?.savedAt ? (
                      <span className="font-semibold text-success">✓ Saved</span>
                    ) : m ? (
                      <span className="text-muted">{LABELS[m.status]}</span>
                    ) : (
                      <span className="text-muted">Not marked</span>
                    )}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label={`Attendance for ${s.name}`}>
                  {ATTENDANCE_STATUSES.map((status) => {
                    const on = m?.status === status;
                    return (
                      <button
                        key={status}
                        type="button"
                        disabled={readOnly || st?.saving}
                        aria-pressed={on}
                        onClick={() => save(s.enrollmentId, status, m?.note ?? null)}
                        className={`min-h-14 rounded-lg border-2 px-2 text-base font-semibold transition-colors disabled:opacity-60 ${on ? ON_STYLE[status] : OFF_STYLE}`}
                      >
                        {on ? "✓ " : ""}
                        {LABELS[status]}
                      </button>
                    );
                  })}
                </div>
                {st?.error && (
                  <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">
                    <span className="flex-1">{st.error}</span>
                    {m && (
                      <button type="button" className={buttonClass("bad")} onClick={() => save(s.enrollmentId, m.status, m.note)}>
                        Try again
                      </button>
                    )}
                  </div>
                )}
                {!readOnly && (
                  <div className="mt-2">
                    {noteOpen[s.enrollmentId] || m?.note ? (
                      <NoteEditor
                        disabled={!m || st?.saving}
                        initial={m?.note ?? ""}
                        onSave={(note) => m && save(s.enrollmentId, m.status, note)}
                      />
                    ) : (
                      <button type="button" className="crm-link min-h-11 text-[13px] font-semibold" onClick={() => setNoteOpen((c) => ({ ...c, [s.enrollmentId]: true }))}>
                        Add a note
                      </button>
                    )}
                  </div>
                )}
                {readOnly && m?.note && <p className="mt-2 text-sm text-muted">Note: {m.note}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NoteEditor({ initial, disabled, onSave }: { initial: string; disabled?: boolean; onSave: (note: string | null) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={disabled ? "Mark attendance first, then add a note" : "Note (e.g. left early at 11:30)"}
        className="crm-input"
        aria-label="Note"
        disabled={disabled}
      />
      <button type="button" className={buttonClass("ghost")} disabled={disabled || value === initial} onClick={() => onSave(value.trim() || null)}>
        Save note
      </button>
    </div>
  );
}

function QrButton({
  classId,
  heldOn,
  initial,
  onVisibleChange,
}: {
  classId: string;
  heldOn: string;
  initial: { token: string; expiresAt: string } | null;
  onVisibleChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(initial);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [pending, startTransition] = useTransition();
  const rotating = useRef(false);

  const rotate = useCallback(async () => {
    if (rotating.current) return;
    rotating.current = true;
    setError(null);
    const token = randomToken();
    const expiresAt = tokenExpiry();
    try {
      const res = await openAttendanceQr({ classId, heldOn, token, expiresAt });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const url = await QRCode.toDataURL(attendanceQrPayload(String((res.data as { sessionId?: string })?.sessionId ?? ""), token), {
        width: 480,
        margin: 2,
        errorCorrectionLevel: "M",
      });
      setCurrent({ token, expiresAt });
      setDataUrl(url);
      setLeft(secondsLeft(expiresAt));
    } catch (e) {
      console.error("[attendance-qr] could not create the QR code", e);
      setError("The QR code couldn't be created — check your connection and try again.");
    } finally {
      rotating.current = false;
    }
  }, [classId, heldOn]);

  // Countdown; rotate to a fresh token when it runs out while the QR is showing.
  useEffect(() => {
    if (!open || !current) return;
    const timer = setInterval(() => {
      const s = secondsLeft(current.expiresAt);
      setLeft(s);
      if (s <= 0) void rotate();
    }, 1000);
    return () => clearInterval(timer);
  }, [open, current, rotate]);

  // While the QR is up, pull in attendance marked by students scanning it.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(timer);
  }, [open, router]);

  function show() {
    setOpen(true);
    onVisibleChange(true);
    startTransition(() => rotate());
  }

  function turnOff() {
    startTransition(async () => {
      try {
        const res = await closeAttendanceQr({ classId, heldOn });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setOpen(false);
        setCurrent(null);
        setDataUrl(null);
      } catch (e) {
        console.error("[attendance-qr] turning off failed", e);
        setError("Couldn't turn off the QR code — check your connection and try again.");
      }
    });
  }

  return (
    <>
      <button type="button" className={buttonClass("primary")} onClick={show}>
        Show QR for this class
      </button>
      {open
        ? createPortal(
        <div role="dialog" aria-modal="true" aria-label="Class attendance QR code" className="fixed inset-0 z-50 flex items-center justify-center bg-navy-700/90 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 text-center">
            <p className="text-xs font-bold uppercase tracking-wider text-purple">Scan to mark attendance</p>
            <p className="mt-1 text-sm text-muted">Students or parents scan this with the member app. It changes every 10 minutes.</p>
            <div className="mx-auto mt-4 flex aspect-square w-full max-w-xs items-center justify-center rounded-xl border border-line bg-white">
              {dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={dataUrl} alt="Attendance QR code for this class" className="h-full w-full" />
              ) : (
                <span className="text-muted">{pending ? "Creating code…" : "No code yet"}</span>
              )}
            </div>
            {dataUrl && (
              <p className="mt-3 text-sm" aria-live="polite">
                Refreshes in <strong>{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</strong>
              </p>
            )}
            {error && (
              <div role="alert" className="mt-3 rounded-lg bg-danger-50 p-3 text-sm text-danger">
                {error}
                <button type="button" className={`${buttonClass("bad")} mt-2 w-full`} onClick={() => void rotate()}>
                  Try again
                </button>
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" className={buttonClass("ghost")} onClick={() => setOpen(false)}>
                Hide
              </button>
              <button type="button" className={buttonClass("bad")} onClick={turnOff} disabled={pending}>
                Turn off code
              </button>
            </div>
          </div>
        </div>,
          document.body,
        )
        : null}
    </>
  );
}
