import { describe, expect, it } from "vitest";

import {
  COMMON_LANGUAGES,
  communityLanguages,
  communityLocale,
  countryCode,
  isKnownLanguage,
  isRtl,
  isValidLanguageCode,
  languageChoices,
  languageFromText,
  languageLabel,
  languageList,
  languageName,
  matchLanguage,
  nativeLanguageName,
  normalizeLanguageCode,
  primaryLanguage,
  textDirection,
} from "@/lib/languages";

describe("language codes", () => {
  it("accepts any language code and writes it in the standard way", () => {
    expect(normalizeLanguageCode("es")).toBe("es");
    expect(normalizeLanguageCode(" PT_br ")).toBe("pt-BR");
    expect(normalizeLanguageCode("zh-hant-tw")).toBe("zh-Hant-TW");
    expect(normalizeLanguageCode("fil")).toBe("fil");
    expect(normalizeLanguageCode("ar")).toBe("ar");
    expect(normalizeLanguageCode("gu")).toBe("gu");
  });

  it("refuses text that is not a language code", () => {
    for (const bad of ["", " ", "e", "english", "en US", "1234", "en-", "-en", "x", "en-abcdefghi", "und", null, undefined, 5, {}]) {
      expect(normalizeLanguageCode(bad)).toBeNull();
      expect(isValidLanguageCode(bad)).toBe(false);
    }
    // 35 characters is the most the database keeps.
    expect(normalizeLanguageCode("en-abcdefgh-abcdefgh-abcdefgh-abcdefg")).toBeNull();
  });

  it("knows which codes are real languages", () => {
    expect(isKnownLanguage("es")).toBe(true);
    expect(isKnownLanguage("fil")).toBe(true);
    expect(isKnownLanguage("pt-BR")).toBe(true);
    expect(isKnownLanguage("xx")).toBe(false);
    expect(isKnownLanguage("english")).toBe(false);
  });

  it("names a language in English and in its own writing", () => {
    expect(languageName("gu")).toBe("Gujarati");
    expect(languageName("es")).toBe("Spanish");
    expect(languageName("pt-BR")).toBe("Brazilian Portuguese");
    expect(languageName("xx")).toBe("xx");
    expect(nativeLanguageName("gu")).toBe("ગુજરાતી");
    expect(nativeLanguageName("hi")).toBe("हिन्दी");
    expect(nativeLanguageName("not a code")).toBeNull();
    expect(languageLabel("en")).toBe("English");
    expect(languageLabel("gu")).toBe("Gujarati (ગુજરાતી)");
    expect(languageLabel("hi")).toBe("Hindi (हिन्दी)");
    expect(languageLabel("ar")).toMatch(/^Arabic \(.+\)$/);
    expect(languageLabel("xx")).toBe("xx");
  });

  it("finds the same language in another region", () => {
    expect(primaryLanguage("es-MX")).toBe("es");
    expect(primaryLanguage("ES")).toBe("es");
    expect(matchLanguage("es-MX", ["en", "es"])).toBe("es");
    expect(matchLanguage("es", ["es-MX"])).toBe("es-MX");
    expect(matchLanguage("fr", ["en", "es"])).toBeNull();
    expect(matchLanguage("not a code", ["en"])).toBeNull();
  });

  it("reads a language written as a name or a code", () => {
    expect(languageFromText("Spanish")).toBe("es");
    expect(languageFromText("español")).toBe("es");
    expect(languageFromText("ગુજરાતી")).toBe("gu");
    expect(languageFromText("English (US)")).toBe("en");
    expect(languageFromText("pt_BR")).toBe("pt-BR");
    expect(languageFromText("Klingon")).toBeNull();
    expect(languageFromText("")).toBeNull();
    expect(languageFromText(7)).toBeNull();
  });

  it("lists names in words", () => {
    expect(languageList([])).toBe("");
    expect(languageList(["en"])).toBe("English");
    expect(languageList(["en", "es"])).toBe("English and Spanish");
    expect(languageList(["en", "gu", "hi"])).toBe("English, Gujarati and Hindi");
  });
});

describe("which way a language is written", () => {
  it("runs Arabic, Hebrew, Persian and Urdu right to left, and the rest left to right", () => {
    for (const rtl of ["ar", "he", "fa", "ur", "ps", "sd", "ar-AE", "yi"]) {
      expect(textDirection(rtl)).toBe("rtl");
      expect(isRtl(rtl)).toBe(true);
    }
    for (const ltr of ["en", "es", "gu", "hi", "zh", "ja", "fr", "ku", "not a code"]) expect(textDirection(ltr)).toBe("ltr");
  });
});

describe("a community's languages", () => {
  it("is the profile's list, in the community's order", () => {
    expect(communityLanguages({ languages: ["es", "en"] })).toEqual(["es", "en"]);
    expect(communityLanguages(["en", "gu", "hi"])).toEqual(["en", "gu", "hi"]);
    expect(communityLanguages({ languages: ["fr"] })).toEqual(["fr"]);
    expect(communityLanguages({ languages: ["ar"] })).toEqual(["ar"]);
  });

  it("tidies the codes and drops repeats and anything that is not a language", () => {
    expect(communityLanguages({ languages: ["EN", "en", "pt_br", "nonsense", "", 4, null] })).toEqual(["en", "pt-BR"]);
  });

  it("is English when the community has not chosen", () => {
    for (const none of [null, undefined, {}, { languages: null }, { languages: [] }, [], { languages: ["??"] }, "es"]) expect(communityLanguages(none as never)).toEqual(["en"]);
  });
});

describe("the locale a community writes dates in", () => {
  it("is its main language in its own country", () => {
    expect(communityLocale(["en"], "US")).toBe("en-US");
    expect(communityLocale(["en"], "gb")).toBe("en-GB");
    expect(communityLocale(["en", "gu"], "IN")).toBe("en-IN");
    expect(communityLocale(["es", "en"], "MX")).toBe("es-MX");
    expect(communityLocale(["fr"], "CA")).toBe("fr-CA");
    expect(communityLocale(["ar"], "AE")).toBe("ar-AE");
  });

  it("keeps a region the language already names, and falls back kindly", () => {
    expect(communityLocale(["pt-BR"], "PT")).toBe("pt-BR");
    expect(communityLocale(["en"], null)).toBe("en-US");
    expect(communityLocale(["en"], "United States")).toBe("en-US");
    expect(communityLocale(["fr"], null)).toBe("fr");
    expect(communityLocale([], "GB")).toBe("en-GB");
  });

  it("reads a country code", () => {
    expect(countryCode(" us ")).toBe("US");
    expect(countryCode("USA")).toBeNull();
    expect(countryCode(null)).toBeNull();
  });
});

describe("the choices offered in a picker", () => {
  it("offers the common languages with both names, and never hides one the community already uses", () => {
    const base = languageChoices();
    expect(base.map((c) => c.value)).toEqual([...COMMON_LANGUAGES]);
    expect(base.find((c) => c.value === "gu")).toEqual({ value: "gu", label: "Gujarati (ગુજરાતી)" });
    expect(base.every((c) => isKnownLanguage(c.value))).toBe(true);
    const withExtra = languageChoices(["sw", "haw", "nonsense"]);
    expect(withExtra.map((c) => c.value)).toContain("haw");
    expect(withExtra.map((c) => c.value)).not.toContain("nonsense");
    expect(new Set(withExtra.map((c) => c.value)).size).toBe(withExtra.length);
  });
});
