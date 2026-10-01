import { describe, expect, it } from "vitest";

import {
  checkMediaFile,
  contentKindLabel,
  explainUploadFailure,
  formatDuration,
  isMediaKind,
  isMediaObjectPath,
  linkPlaysAs,
  mediaContentType,
  mediaFileLabel,
  mediaFileRole,
  mediaObjectPath,
  mediaReadyProblem,
  mediaSourceOf,
  parseDuration,
  parseMediaForm,
  parseMediaLink,
  parseTextList,
  parseYouTubeUrl,
  youtubeEmbedUrl,
} from "@/lib/content";
import { visibleNav } from "@/lib/permissions";

const CENTER = "11111111-2222-4333-8444-555555555555";
const FILE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const form = (values: Record<string, string>) => (name: string) => (name in values ? values[name] : null);

describe("YouTube links", () => {
  const canonical = { youtubeId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" };
  it("normalizes watch, youtu.be, shorts, embed and live links to one canonical address", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123",
      "http://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?si=abcDEF123",
      "youtu.be/dQw4w9WgXcQ",
      "www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ?start=10",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ?feature=shared",
      "  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ",
    ]) {
      expect(parseYouTubeUrl(link), link).toEqual(canonical);
    }
  });
  it("says why a YouTube link that names no single video is refused", () => {
    expect(parseYouTubeUrl("https://www.youtube.com/playlist?list=PL123")).toEqual({ error: expect.stringContaining("playlist") });
    expect(parseYouTubeUrl("https://www.youtube.com/@JainSocietyHouston")).toEqual({ error: expect.stringContaining("one video") });
    expect(parseYouTubeUrl("https://www.youtube.com/watch?v=short")).toEqual({ error: expect.stringContaining("does not name a video") });
    expect(parseYouTubeUrl("https://youtu.be/")).toEqual({ error: expect.stringContaining("does not name a video") });
  });
  it("is null for anything that is not YouTube", () => {
    expect(parseYouTubeUrl("https://vimeo.com/12345")).toBeNull();
    expect(parseYouTubeUrl("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeUrl("javascript:alert(1)")).toBeNull();
    expect(parseYouTubeUrl("")).toBeNull();
    expect(parseYouTubeUrl("two words")).toBeNull();
  });
  it("embeds through youtube-nocookie", () => {
    expect(youtubeEmbedUrl("dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });
});

describe("media links", () => {
  it("turns a YouTube link into its id and canonical address", () => {
    expect(parseMediaLink("https://youtu.be/dQw4w9WgXcQ")).toEqual({ ok: true, source: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", youtubeId: "dQw4w9WgXcQ" });
  });
  it("keeps other secure links as they are", () => {
    expect(parseMediaLink(" https://cdn.example.org/stavans/navkar.mp3 ")).toEqual({ ok: true, source: "link", url: "https://cdn.example.org/stavans/navkar.mp3" });
  });
  it("refuses insecure, broken and empty links in plain English", () => {
    expect(parseMediaLink("http://example.org/a.mp3")).toEqual({ ok: false, error: expect.stringContaining("https://") });
    expect(parseMediaLink("example.org/a.mp3")).toEqual({ ok: false, error: expect.stringContaining("https://") });
    expect(parseMediaLink("https://localhost/a.mp3")).toEqual({ ok: false, error: expect.stringContaining("https://") });
    expect(parseMediaLink("")).toEqual({ ok: false, error: "paste the YouTube or web link" });
    expect(parseMediaLink("https://www.youtube.com/playlist?list=PL1")).toEqual({ ok: false, error: expect.stringContaining("playlist") });
  });
  it("knows which links play directly", () => {
    expect(linkPlaysAs("https://cdn.example.org/a/Navkar.MP3?x=1")).toBe("audio");
    expect(linkPlaysAs("https://cdn.example.org/talk.mp4")).toBe("video");
    expect(linkPlaysAs("https://example.org/stavans")).toBeNull();
    expect(linkPlaysAs("not a url")).toBeNull();
  });
});

describe("media files", () => {
  it("gives each kind its file role", () => {
    expect(mediaFileRole("stavan")).toBe("audio");
    expect(mediaFileRole("podcast")).toBe("audio");
    expect(mediaFileRole("video")).toBe("video");
    expect(mediaFileRole("recipe")).toBe("image");
    expect(isMediaKind("stavan")).toBe(true);
    expect(isMediaKind("sutra")).toBe(false);
  });
  it("stores browser aliases and type-less files under the standard type", () => {
    expect(mediaContentType("audio", { name: "a.mp3", type: "audio/mp3" })).toBe("audio/mpeg");
    expect(mediaContentType("audio", { name: "a.m4a", type: "audio/x-m4a" })).toBe("audio/mp4");
    expect(mediaContentType("audio", { name: "a.wav", type: "audio/x-wav" })).toBe("audio/wav");
    expect(mediaContentType("audio", { name: "Navkar.M4A", type: "" })).toBe("audio/mp4");
    expect(mediaContentType("audio", { name: "a.webm", type: "video/webm" })).toBe("audio/webm");
    expect(mediaContentType("video", { name: "talk.mov", type: "application/octet-stream" })).toBe("video/quicktime");
    expect(mediaContentType("image", { name: "a.jpg", type: "image/jpg" })).toBe("image/jpeg");
  });
  it("refuses files of the wrong kind", () => {
    expect(mediaContentType("audio", { name: "talk.mp4", type: "video/mp4" })).toBeNull();
    expect(mediaContentType("image", { name: "photo.heic", type: "image/heic" })).toBeNull();
    expect(mediaContentType("audio", { name: "x", type: "constructor" })).toBeNull();
    expect(checkMediaFile("audio", { name: "notes.pdf", type: "application/pdf", size: 10 })).toEqual({ ok: false, error: expect.stringContaining("MP3, M4A") });
    expect(checkMediaFile("image", { name: "photo.heic", type: "image/heic", size: 10 })).toEqual({ ok: false, error: expect.stringContaining("HEIC") });
    expect(checkMediaFile("audio", { name: "a.mp3", type: "audio/mpeg", size: 0 })).toEqual({ ok: false, error: expect.stringContaining("empty") });
  });
  it("enforces 50 MB and sends big videos to YouTube", () => {
    expect(checkMediaFile("audio", { name: "a.mp3", type: "audio/mpeg", size: 50 * 1024 * 1024 })).toEqual({ ok: true, contentType: "audio/mpeg" });
    const big = checkMediaFile("video", { name: "pravachan.mp4", type: "video/mp4", size: 300 * 1024 * 1024 });
    expect(big).toEqual({ ok: false, error: "This video is 300 MB, over the 50 MB limit. Upload big videos to YouTube (unlisted is fine) and paste the link instead." });
    const audio = checkMediaFile("audio", { name: "a.mp3", type: "audio/mpeg", size: 51 * 1024 * 1024 });
    expect(audio.ok === false && audio.error).toContain("YouTube");
  });
  it("names uploads <center>/media/<kind>/<uuid>-<safe-name>.<ext> and accepts only those", () => {
    const path = mediaObjectPath(CENTER, "stavan", FILE_ID, "Navkār Mantra (live).MP3", "audio/mpeg");
    expect(path).toBe(`${CENTER}/media/stavan/${FILE_ID}-navkar-mantra-live.mp3`);
    expect(mediaObjectPath(CENTER, "podcast", FILE_ID, "ep 1.m4a", "audio/mp4")).toBe(`${CENTER}/media/podcast/${FILE_ID}-ep-1.m4a`);
    expect(mediaObjectPath(CENTER, "recipe", FILE_ID, "!!!.jpeg", "image/jpeg")).toBe(`${CENTER}/media/recipe/${FILE_ID}-file.jpg`);
    expect(isMediaObjectPath(CENTER, "stavan", path)).toBe(true);
    expect(isMediaObjectPath(CENTER, "podcast", path)).toBe(false);
    expect(isMediaObjectPath("99999999-2222-4333-8444-555555555555", "stavan", path)).toBe(false);
    expect(isMediaObjectPath(CENTER, "stavan", `${CENTER}/media/stavan/../../x.mp3`)).toBe(false);
    expect(isMediaObjectPath(CENTER, "stavan", "audio/navkar.mp3")).toBe(false);
    expect(mediaFileLabel(path)).toBe("navkar-mantra-live.mp3");
  });
});

describe("lengths and lists", () => {
  it("reads lengths as m:ss, h:mm:ss or whole minutes", () => {
    expect(parseDuration("4:05")).toBe(245);
    expect(parseDuration("1:02:03")).toBe(3723);
    expect(parseDuration("75:30")).toBe(4530);
    expect(parseDuration("12")).toBe(720);
    expect(parseDuration(" ")).toBeNull();
    expect(parseDuration("4:5")).toBe("bad");
    expect(parseDuration("1:75:00")).toBe("bad");
    expect(parseDuration("0:00")).toBe("bad");
    expect(parseDuration("four")).toBe("bad");
    expect(formatDuration(245)).toBe("4:05");
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(null)).toBe("");
    expect(formatDuration("245")).toBe("");
  });
  it("splits comma lists without repeats and ingredient lines without bullets", () => {
    expect(parseTextList("Navkar, Navkaar,navkar ,  Namokar  mantra", "comma")).toEqual(["Navkar", "Navkaar", "Namokar mantra"]);
    expect(parseTextList("- 1 cup moong dal, washed\n• salt\n\n2. 1.5 cups water\nsalt", "line")).toEqual(["1 cup moong dal, washed", "salt", "1.5 cups water", "salt"]);
  });
});

describe("the media drawer's form", () => {
  it("reads a stavan with a YouTube link", () => {
    const r = parseMediaForm(
      "stavan",
      form({ language: "gu", artist: " Lata ", aliases: "Navkar, Navkaar", tags: "daily", duration: "4:05", source: "link", media_url: "https://youtu.be/dQw4w9WgXcQ", body_md: "Namo arihantanam" }),
      CENTER,
    );
    expect(r).toEqual({
      ok: true,
      fields: {
        language: "gu",
        bodyMd: "Namo arihantanam",
        mediaUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        mediaPath: null,
        set: { aliases: ["Navkar", "Navkaar"], tags: ["daily"], artist: "Lata", duration_seconds: 245, source: "youtube", youtube_id: "dQw4w9WgXcQ" },
        clear: [],
      },
    });
  });
  it("reads an uploaded podcast and clears what was emptied", () => {
    const path = mediaObjectPath(CENTER, "podcast", FILE_ID, "ep.mp3", "audio/mpeg");
    const r = parseMediaForm("podcast", form({ source: "upload", media_path: path, series: "Jain philosophy", episode: "3", media_url: "https://ignored.example/x" }), CENTER);
    expect(r.ok && r.fields.mediaPath).toBe(path);
    expect(r.ok && r.fields.mediaUrl).toBeNull();
    expect(r.ok && r.fields.set).toEqual({ series: "Jain philosophy", episode: 3, source: "upload" });
    expect(r.ok && r.fields.clear).toEqual(["youtube_id", "duration_seconds", "artist", "aliases", "tags"]);
  });
  it("keeps a stored file that is not in the new folder layout, but refuses a new one from elsewhere", () => {
    const legacy = "videos/old-talk.mp4";
    expect(parseMediaForm("video", form({ source: "upload", media_path: legacy }), CENTER, { mediaPath: legacy, photoPath: null }).ok).toBe(true);
    const r = parseMediaForm("video", form({ source: "upload", media_path: legacy }), CENTER);
    expect(r).toEqual({ ok: false, error: expect.stringContaining("Upload it again") });
  });
  it("reads a recipe", () => {
    const photo = mediaObjectPath(CENTER, "recipe", FILE_ID, "dal.jpg", "image/jpeg");
    const r = parseMediaForm(
      "recipe",
      form({ fully_jain: "on", ingredients: "1 cup moong dal\n- salt\n", servings: "4", prep_minutes: "10", cook_minutes: "25", photo_path: photo, body_md: "Boil." }),
      CENTER,
    );
    expect(r.ok && r.fields.set).toEqual({ fully_jain: true, ingredients: ["1 cup moong dal", "salt"], servings: 4, prep_minutes: 10, cook_minutes: 25, photo_path: photo });
    expect(r.ok && r.fields.clear).toEqual(["aliases", "tags"]);
    const off = parseMediaForm("recipe", form({}), CENTER);
    expect(off.ok && off.fields.set).toEqual({ fully_jain: false });
  });
  it("explains each bad value", () => {
    expect(parseMediaForm("stavan", form({ duration: "4:5" }), CENTER)).toEqual({ ok: false, error: expect.stringContaining("4:05") });
    expect(parseMediaForm("podcast", form({ episode: "two" }), CENTER)).toEqual({ ok: false, error: expect.stringContaining("episode") });
    expect(parseMediaForm("recipe", form({ servings: "0" }), CENTER)).toEqual({ ok: false, error: expect.stringContaining("1 to 100") });
    expect(parseMediaForm("video", form({ source: "link", media_url: "http://example.org/v.mp4" }), CENTER)).toEqual({ ok: false, error: expect.stringContaining("https://") });
    expect(parseMediaForm("video", form({ source: "camera" }), CENTER)).toEqual({ ok: false, error: expect.stringContaining("recording comes from") });
    expect(parseMediaForm("recipe", form({ photo_path: `${CENTER}/media/stavan/${FILE_ID}-a.jpg` }), CENTER)).toEqual({ ok: false, error: expect.stringContaining("photo") });
  });
  it("lets drafts be incomplete but not what goes for approval", () => {
    const empty = { bodyMd: null, mediaUrl: null, mediaPath: null, set: {} };
    expect(mediaReadyProblem("stavan", empty)).toContain("recording or the lyrics");
    expect(mediaReadyProblem("stavan", { ...empty, bodyMd: "lyrics" })).toBeNull();
    expect(mediaReadyProblem("video", { ...empty, bodyMd: "about" })).toContain("upload a file or paste a link");
    expect(mediaReadyProblem("podcast", { ...empty, mediaUrl: "https://x.example/a.mp3" })).toBeNull();
    expect(mediaReadyProblem("recipe", { ...empty, bodyMd: "Boil." })).toContain("ingredients");
    expect(mediaReadyProblem("recipe", { ...empty, bodyMd: "Boil.", set: { ingredients: ["dal"] } })).toBeNull();
  });
});

describe("media labels and sources", () => {
  it("labels the new kinds in the approval queue", () => {
    expect(contentKindLabel("stavan")).toBe("Stavan");
    expect(contentKindLabel("podcast")).toBe("Podcast");
    expect(contentKindLabel("recipe")).toBe("Recipe");
  });
  it("works out where a recording comes from", () => {
    expect(mediaSourceOf({ media_path: null, media_url: null, metadata: { source: "youtube" } })).toBe("youtube");
    expect(mediaSourceOf({ media_path: "a/b.mp3", media_url: null, metadata: {} })).toBe("upload");
    expect(mediaSourceOf({ media_path: null, media_url: "https://youtu.be/dQw4w9WgXcQ", metadata: null })).toBe("youtube");
    expect(mediaSourceOf({ media_path: null, media_url: "https://example.org/a.mp3", metadata: [] })).toBe("link");
    expect(mediaSourceOf({ media_path: null, media_url: null, metadata: {} })).toBeNull();
  });
});

describe("Content › Media library tab", () => {
  it("shows to anyone with a content permission, and to no one else", () => {
    for (const p of ["content.view", "content.draft", "content.manage", "content.approve"]) {
      const content = visibleNav({ permissions: [p], isPlatformAdmin: false }).find((m) => m.key === "content");
      expect(content?.tabs.map((t) => t.href), p).toContain("/content/media");
    }
    expect(visibleNav({ permissions: ["giving.view"], isPlatformAdmin: false }).some((m) => m.key === "content")).toBe(false);
  });
});

describe("upload failures", () => {
  it("explains storage answers in plain English", () => {
    expect(explainUploadFailure(0, "")).toContain("could not reach");
    expect(explainUploadFailure(400, JSON.stringify({ statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" }))).toContain("YouTube");
    expect(explainUploadFailure(400, JSON.stringify({ statusCode: "415", error: "invalid_mime_type", message: "mime type audio/flac is not supported" }))).toContain("type of file");
    expect(explainUploadFailure(400, JSON.stringify({ statusCode: "403", error: "Unauthorized", message: "invalid signature" }))).toContain("expired or was refused");
    expect(explainUploadFailure(409, JSON.stringify({ message: "The resource already exists" }))).toContain("try again");
    expect(explainUploadFailure(502, "<html>Bad gateway</html>")).toContain("try again in a moment");
    expect(explainUploadFailure(400, JSON.stringify({ message: "Something odd." }))).toBe("Something odd");
  });
});
