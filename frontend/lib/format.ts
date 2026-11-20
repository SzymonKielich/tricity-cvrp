export const number = (value: number | null | undefined, digits = 0, locale = "en-GB") => value == null ? "-" :
  new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
export const clock = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}`;
export const dateLabel = (date: string, locale = "en-GB") => new Intl.DateTimeFormat(locale, {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
}).format(new Date(date));
export const dateTime = (stamp: string | null, locale = "en-GB") => stamp ? new Intl.DateTimeFormat(locale, {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
}).format(new Date(stamp)) + " UTC" : "-";
export const scopeLabel = (scope: string) => scope === "all" ? "All shops" : "Participating shops";
export const change = (value: number, locale = "en-GB") => `${value > 0 ? "+" : value < 0 ? "-" : ""}${number(Math.abs(value), 1, locale)}%`;

const categories: Record<string, string> = {
  bookshop: "Bookshop", fashion: "Clothing shop", groceries: "Grocery shop",
  hardware: "Hardware store", home_goods: "Home goods store", pharmacy: "Pharmacy",
  home: "Home", office: "Office", pickup_point: "Pickup point",
};

export function categoryLabel(value: string) {
  return categories[value] ?? value;
}

export const balancedPlanName = "Viladecans · Balanced plan";
const balancedPilotName = "Viladecans · Balanced pilot";
const polishBalancedName = "Viladecans - plan zrównoważony";

export function scenarioLabel(name: string, language: "en" | "pl" = "en") {
  const normalized = name.replace(/[\u2013\u2014\u2212\u2011]/g, "-");
  const suffix = / (?:- )?(copy|kopia|rerun|ponownie)$/.exec(normalized);
  const base = suffix ? normalized.slice(0, suffix.index) : normalized;

  let label: string;
  if (base === balancedPilotName || base === balancedPlanName || /^Viladecans [-·] plan (?:zrównoważony|zrownowazony)$/i.test(base)) {
    label = language === "pl" ? polishBalancedName : base === balancedPilotName ? balancedPilotName : balancedPlanName;
  } else {
    const traffic = /^(?:Traffic|Ruch)( \+\d+% · \d{4}-\d{2}-\d{2})$/.exec(base);
    if (!traffic) return normalized;
    label = (language === "pl" ? "Ruch" : "Traffic") + traffic[1];
  }

  if (!suffix) return label;
  const rerun = suffix[1] === "rerun" || suffix[1] === "ponownie";
  const action = rerun ? { en: "rerun", pl: "ponownie" } : { en: "copy", pl: "kopia" };
  return `${label} - ${action[language]}`;
}
