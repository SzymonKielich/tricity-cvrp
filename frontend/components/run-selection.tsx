"use client";

import { useLanguage } from "@/lib/language";
import { MenuItem, TextField } from "@mui/material";
import type { Scenario } from "@/lib/types";

export { useRunSelection } from "@/lib/run-selection";

export function RunSelect({ choices, value, onChange, label = "Saved scenario" }: {
  choices: Scenario[]; value?: string; onChange: (value: string) => void; label?: string;
}) {
  const { t, scenarioLabel, dateLabel } = useLanguage();
  return <TextField select size="small" sx={{ minWidth: 190, maxWidth: "100%" }} label={t(label)} value={value ?? ""}
    onChange={(event) => onChange(event.target.value)}>
    {!choices.length && <MenuItem value="">{t("No completed scenarios")}</MenuItem>}
    {choices.map((scenario) => <MenuItem key={scenario.id} value={scenario.id}>
      {scenarioLabel(scenario.name)} · {scenario.config.dates.length === 1 ? dateLabel(scenario.config.dates[0]) : t(`Days: ${scenario.config.dates.length}`, `Liczba dni: ${scenario.config.dates.length}`)}
      {scenario.status === "incomplete" ? t(" - Incomplete") : ""}
    </MenuItem>)}
  </TextField>;
}

export function RunScope({ scenario }: { scenario?: Scenario }) {
  const { scopeLabel } = useLanguage();
  return <span>{scopeLabel(scenario?.config.scope ?? "participating")}</span>;
}
