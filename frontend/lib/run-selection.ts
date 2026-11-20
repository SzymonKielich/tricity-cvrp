"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useScenarios } from "./api";
import { DEFAULT_DATE } from "./scenario";

export function useRunSelection(verifiedOnly = false, initialDate = DEFAULT_DATE) {
  const params = useSearchParams();
  const scenarios = useScenarios();
  const eligible = scenarios.data?.filter((scenario) =>
    scenario.status === "verified" || (!verifiedOnly && scenario.status === "incomplete")) ?? [];
  const [selectedId, setSelectedId] = useState(params.get("scenario") ?? "");
  const [selectedDate, setDate] = useState(initialDate);
  const selected = eligible.find((scenario) => scenario.id === selectedId) ?? eligible[0];
  const date = selected ? selected.config.dates.includes(selectedDate) ? selectedDate : selected.config.dates[0] : selectedDate;
  return { selected, date, setDate, setSelectedId, eligible, scenarios };
}

