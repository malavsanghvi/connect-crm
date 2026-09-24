import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { bmfRecord, copyLine, irsDate, mergeSources, normalizeEin, parseCsvLine, pub78Record, revocationRecord } from "../tools/load-irs-eo.mjs";

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/irs/${name}`, import.meta.url)), "utf8").split(/\r?\n/).filter((l) => l.trim());

function loadFixtures() {
  const [head, ...rows] = fixture("eo-bmf-fixture.csv");
  const header = parseCsvLine(head).map((h) => h.toUpperCase());
  const bmf = rows.map((l) => bmfRecord(parseCsvLine(l), header)).filter((r) => r !== null);
  const pub78 = fixture("pub78-fixture.txt").map(pub78Record).filter((r) => r !== null);
  const revocations = fixture("revocations-fixture.txt").map(revocationRecord).filter((r) => r !== null);
  return { bmf, pub78, revocations };
}

describe("IRS exempt-organization loader", () => {
  it("normalizes EINs and refuses anything that is not nine digits", () => {
    expect(normalizeEin("76-0000001")).toBe("760000001");
    expect(normalizeEin(" 760000001 ")).toBe("760000001");
    expect(normalizeEin("bad-ein")).toBeNull();
    expect(normalizeEin("12345")).toBeNull();
  });

  it("splits quoted CSV fields", () => {
    expect(parseCsvLine('1,"SHANTI TEMPLE, INC",x')).toEqual(["1", "SHANTI TEMPLE, INC", "x"]);
    expect(parseCsvLine('"a ""b"" c",')).toEqual(['a "b" c', ""]);
  });

  it("reads IRS dates in their three shapes", () => {
    expect(irsDate("15-MAY-2020")).toBe("2020-05-15");
    expect(irsDate("2020-05-15")).toBe("2020-05-15");
    expect(irsDate("5/15/2020")).toBe("2020-05-15");
    expect(irsDate("")).toBeNull();
  });

  it("merges the BMF, Pub. 78 and revocations into one row per EIN", () => {
    const { bmf, pub78, revocations } = loadFixtures();
    expect(bmf).toHaveLength(3); // the row with a bad EIN is skipped
    const rows = mergeSources({ bmf, pub78, revocations });
    const by = new Map(rows.map((r) => [r.ein, r]));
    expect(by.get("760000001")).toMatchObject({ status: "active", in_pub78: true, source: "eo_bmf+pub78", subsection: "03", deductibility: "1" });
    expect(by.get("760000002")).toMatchObject({ name: "SHANTI TEMPLE, INC", status: "active", in_pub78: false });
    expect(by.get("760000009")).toMatchObject({ status: "pub78_only", deductibility: "PC" });
    expect(by.get("760000010")).toMatchObject({ status: "revoked", revoked_on: "2020-05-15" });
    expect(by.has("760000011")).toBe(false); // reinstated
    expect(rows).toHaveLength(5);
  });

  it("writes COPY lines with quoting and empty NULLs", () => {
    const line = copyLine({ ein: "760000002", name: "SHANTI TEMPLE, INC", city: null, state: "TX", subsection: "03", deductibility: null, status: "active", source: "eo_bmf", in_pub78: false, revoked_on: null });
    expect(line).toBe('760000002,"SHANTI TEMPLE, INC",,TX,03,,active,eo_bmf,f,');
  });
});
