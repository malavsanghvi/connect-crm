"use client";

// Flyers v3: choosing the picture a layout shows (the "hero"): an approved photo from the community's own albums, the same photos and
// the same rules as a photo background (approved, no children, not from a staff-only album, a format the renderer can draw). Weaver
// never makes this picture: no people, faces or sacred figures are drawn by AI. The renderer places and frames it.

import { useRef, useState } from "react";

import { buttonClass } from "@/components/ui";

import { listFlyerPhotosAction, type FlyerPhotoList } from "./flyer-actions";
import { InlineError } from "./flyer-fields";

export function HeroPicker({
  eventId,
  value,
  onChange,
  disabled,
  isGuestVisible,
}: {
  eventId: string;
  /** The chosen photo's id, or null. */
  value: string | null;
  onChange: (photoId: string | null) => void;
  disabled: boolean;
  /** Anyone who sees this flyer sees the picture, guests included. */
  isGuestVisible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<FlyerPhotoList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  async function load(albumId: string | null) {
    setLoading(true);
    setError(null);
    try {
      const res = await listFlyerPhotosAction(eventId, albumId);
      if (!res.ok) setError(res.error);
      else setPhotos(res.data ?? { albums: [], albumId: null, photos: [] });
    } catch (err) {
      console.error("[events/flyer] loading the photo albums for the picture failed:", err);
      setError("Could not load the photo albums — the server did not respond. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {value && thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="The picture you chose" className="h-14 w-14 rounded-[8px] border border-line object-cover" />
        ) : null}
        <button
          type="button"
          className={buttonClass("ghost", "xs")}
          disabled={disabled}
          aria-expanded={open}
          onClick={() => {
            setOpen((o) => !o);
            if (!loadedOnce.current) {
              loadedOnce.current = true;
              void load(null);
            }
          }}
        >
          {value ? "Choose another picture" : "Choose a picture from your albums"}
        </button>
        {value ? (
          <button
            type="button"
            className={buttonClass("ghost", "xs")}
            disabled={disabled}
            onClick={() => {
              onChange(null);
              setThumb(null);
            }}
          >
            Remove the picture
          </button>
        ) : null}
      </div>
      {value && !thumb ? <p className="crm-hint">A picture is chosen; it shows in the preview.</p> : null}
      {open ? (
        <div>
          {isGuestVisible ? <p className="mb-2 rounded-[10px] border border-saffron/40 bg-saffron-50 px-3 py-2 text-[13px] text-brown-900">Anyone who sees this flyer will see this picture, including guests.</p> : null}
          {error ? <InlineError onRetry={() => void load(photos?.albumId ?? null)}>{error}</InlineError> : null}
          {photos && photos.albums.length ? (
            <>
              <label htmlFor="layout-hero-album" className="crm-label">
                Album
              </label>
              <select id="layout-hero-album" className="crm-input" value={photos.albumId ?? ""} disabled={disabled || loading} onChange={(e) => void load(e.target.value)}>
                {photos.albums.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                    {a.isEventAlbum ? " (this event)" : ""}
                    {a.visibility === "members" ? " · members" : ""}
                  </option>
                ))}
              </select>
              {photos.photos.length ? (
                <div className="mt-2 grid max-h-[240px] grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5" role="radiogroup" aria-label="Picture">
                  {photos.photos.map((p, i) => {
                    const on = value === p.id;
                    const albumTitle = photos.albums.find((a) => a.id === photos.albumId)?.title ?? "Album";
                    const name = `${p.caption ? `${p.caption} — ` : ""}${albumTitle}, photo ${i + 1} of ${photos.photos.length}${p.problem ? ` (${p.problem})` : ""}`;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={name}
                        title={p.problem ?? undefined}
                        disabled={disabled || !p.thumbUrl}
                        onClick={() => {
                          setThumb(p.thumbUrl);
                          onChange(p.id);
                        }}
                        className={`aspect-square overflow-hidden rounded-[8px] border bg-ground ${on ? "border-navy ring-2 ring-navy/40" : "border-line"}`}
                      >
                        {p.thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumbUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="block p-1 text-[10px] leading-tight text-danger">{p.problem ?? "No preview"}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="crm-hint mt-2">{loading ? "Loading photos…" : "This album has no approved photos the flyer maker can use (photos showing children, videos, WebP and HEIC are left out)."}</p>
              )}
            </>
          ) : photos && !error ? (
            <p className="crm-hint">No photo albums yet. Add one in Content › Photos.</p>
          ) : loading ? (
            <p className="crm-hint">Loading the albums…</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
