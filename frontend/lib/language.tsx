"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { categoryLabel, change, dateLabel, dateTime, number, scenarioLabel, scopeLabel } from "./format";
import messages from "./pl.json";

export type Language = "en" | "pl";
export type Translate = (english: string, polish?: string) => string;

const translated: Record<string, string> = messages;
const preferenceKey = "shareddrop-language";

function makeLanguage(language: Language) {
  const locale = language === "pl" ? "pl-PL" : "en-GB";
  const t: Translate = (english, polish) => {
    if (language === "en") return english;
    if (polish !== undefined) return polish;
    const key = english.trim();
    const text = Object.hasOwn(translated, key) ? translated[key] : undefined;
    if (text !== undefined) return english.replace(key, () => text);
    const unserved = /^(\d+) orders are unserved\. Savings are suppressed\.$/.exec(key);
    return unserved ? `Nieobsłużone zamówienia: ${unserved[1]}. Porównanie kosztów jest niedostępne.` : english;
  };

  return {
    language, t,
    number: (value: number | null | undefined, digits = 0) => number(value, digits, locale),
    change: (value: number) => change(value, locale),
    dateLabel: (value: string) => dateLabel(value, locale),
    dateTime: (value: string | null) => dateTime(value, locale),
    scopeLabel: (scope: string) => t(scopeLabel(scope)),
    categoryLabel: (category: string) => t(categoryLabel(category)),
    scenarioLabel: (name: string) => scenarioLabel(name, language),
  };
}

const formats = { en: makeLanguage("en"), pl: makeLanguage("pl") };
const LanguageContext = createContext({ ...formats.en, setLanguage: (_value: Language) => {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>("en");

  useEffect(() => {
    try {
      if (localStorage.getItem(preferenceKey) === "pl") setLanguage("pl");
    } catch {
      // The selector also works in browsers that block persistent storage.
    }
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);

  const value = useMemo(() => ({
    ...formats[language],
    setLanguage(next: Language) {
      setLanguage(next);
      try { localStorage.setItem(preferenceKey, next); } catch {}
    },
  }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}
