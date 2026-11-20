"use client";

import { useLanguage } from "@/lib/language";
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, TextField } from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Copy, Download, Ellipsis, GitCompareArrows, Pencil, Play, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { active, api, post, useScenarios } from "@/lib/api";
import type { Created, Scenario } from "@/lib/types";
import { Page, Panel, State, StatusChip } from "./ui";

type Action = "rename" | "duplicate" | "rerun" | "delete";

export function Library() {
  const { t, scenarioLabel, dateLabel, dateTime, scopeLabel } = useLanguage();
  const router = useRouter();
  const scenarios = useScenarios();
  const query = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ element: HTMLElement; item: Scenario } | null>(null);
  const [dialog, setDialog] = useState<{ action: "rename" | "delete"; item: Scenario } | null>(null);
  const [editedName, setEditedName] = useState<string | null>(null);
  const name = editedName ?? dialog?.item.name ?? "";
  const mutation = useMutation({
    mutationFn: async ({ action, item }: { action: Action; item: Scenario }): Promise<Created | Scenario | void> => {
      const path = `/scenarios/${item.id}`;
      if (action === "rename") return api<Scenario>(path, { method: "PATCH", body: JSON.stringify({ name }) });
      if (action === "delete") return api<void>(path, { method: "DELETE" });
      return post<Created>(`${path}/${action}`, action === "duplicate" ? {} : undefined);
    },
    onSuccess: (result, { action, item }) => {
      setDialog(null);
      if (action === "delete") setSelected((values) => values.filter((value) => value !== item.id));
      void query.invalidateQueries({ queryKey: ["scenarios"] });
      if (action === "rerun" && result && "job_id" in result) router.push(`/studio?job=${result.job_id}`);
    },
  });
  const choices = (scenarios.data ?? []).filter((item) => selected.includes(item.id) && item.result?.metrics);

  function ask(action: "rename" | "delete", item: Scenario) {
    setEditedName(null);
    setDialog({ action, item });
    setMenu(null);
  }
  function act(action: "duplicate" | "rerun", item: Scenario) {
    mutation.mutate({ action, item });
    setMenu(null);
  }

  return <>
    <Page title={t("Scenario library")} description={t("Manage saved configurations, compare completed plans and export validation evidence.")}
      actions={<Button variant="contained" component={Link} href="/studio" startIcon={<Plus size={16} />}>{t("New scenario")}</Button>} />
    <Panel title={t("Saved scenarios")} description={t(`Scenarios: ${scenarios.data?.length ?? 0} - choose up to three completed plans`, `Liczba scenariuszy: ${scenarios.data?.length ?? 0} - wybierz maksymalnie trzy ukończone plany`)}
      action={<Button size="small" variant="outlined" startIcon={<GitCompareArrows size={15} />} disabled={choices.length < 2}
        onClick={() => router.push(`/compare?ids=${choices.map((item) => item.id).join(",")}`)}>{t("Compare")} {choices.length || ""}</Button>}>
      {mutation.error && <Alert severity="error">{t(mutation.error.message)}</Alert>}
      {scenarios.data?.length ? <div className="table-overflow">
        <table className="metric-table library-table">
          <thead><tr><th aria-label={t("Select for comparison")} /><th>{t("Scenario")}</th><th>{t("Date and scope")}</th><th>Status</th><th>{t("Coverage")}</th><th>{t("Completed")}</th><th aria-label={t("Actions")} /></tr></thead>
          <tbody>{scenarios.data.map((item) => <tr key={item.id}>
            <td><Checkbox size="small" checked={selected.includes(item.id)}
              disabled={!item.result?.metrics || selected.length >= 3 && !selected.includes(item.id)}
              onChange={(event) => setSelected((values) => event.target.checked ? [...values, item.id] : values.filter((value) => value !== item.id))}
              slotProps={{ input: { "aria-label": t(`Compare ${scenarioLabel(item.name)}`, `Porównaj ${scenarioLabel(item.name)}`) } }} /></td>
            <td><Button component={Link} size="small" sx={{ textAlign: "left", display: "inline-flex", whiteSpace: "normal" }}
              href={item.job_id ? `/studio?job=${item.job_id}` : `/studio?scenario=${item.id}`} endIcon={<ArrowRight size={13} />}>{scenarioLabel(item.name)}</Button></td>
            <td>{item.config.dates.length === 1 ? dateLabel(item.config.dates[0]) : t(`Days: ${item.config.dates.length}`, `Liczba dni: ${item.config.dates.length}`)}<br />
              <small className="muted">{scopeLabel(item.config.scope)}</small></td>
            <td><StatusChip status={item.status} /></td>
            <td>{item.result?.metrics ? t(`${item.result.metrics.optimized.delivered} of ${item.result.metrics.optimized.requested}`, `${item.result.metrics.optimized.delivered} z ${item.result.metrics.optimized.requested}`) : "-"}</td>
            <td>{dateTime(item.finished_at)}</td>
            <td><IconButton aria-label={t(`Actions for ${scenarioLabel(item.name)}`, `Działania dla scenariusza ${scenarioLabel(item.name)}`)} size="small"
              onClick={(event) => setMenu({ element: event.currentTarget, item })}><Ellipsis size={17} /></IconButton></td>
          </tr>)}</tbody>
        </table>
      </div> : <State loading={scenarios.isLoading} error={scenarios.error} empty={t("Save a draft or launch an optimization to create a scenario.")} />}
    </Panel>
    <Menu anchorEl={menu?.element} open={Boolean(menu)} onClose={() => setMenu(null)}>
      {menu && [
        <MenuItem key="rename" onClick={() => ask("rename", menu.item)}><Pencil size={15} style={{ marginRight: 9 }} /> {t("Rename")}</MenuItem>,
        <MenuItem key="duplicate" onClick={() => act("duplicate", menu.item)}><Copy size={15} style={{ marginRight: 9 }} /> {t("Duplicate configuration")}</MenuItem>,
        <MenuItem key="rerun" disabled={active(menu.item.status)} onClick={() => act("rerun", menu.item)}><Play size={15} style={{ marginRight: 9 }} /> {t("Re-run")}</MenuItem>,
        <MenuItem key="export" component="a" href={`/api/scenarios/${menu.item.id}/export`} disabled={active(menu.item.status)} onClick={() => setMenu(null)}>
          <Download size={15} style={{ marginRight: 9 }} /> {t("Export ZIP")}</MenuItem>,
        <MenuItem key="delete" disabled={active(menu.item.status)} onClick={() => ask("delete", menu.item)}><Trash2 size={15} style={{ marginRight: 9 }} /> {t("Delete")}</MenuItem>,
      ]}
    </Menu>
    <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)} fullWidth maxWidth="xs">
      <DialogTitle>{dialog?.action === "rename" ? t("Rename scenario") : t("Delete scenario")}</DialogTitle>
      <DialogContent>
        {dialog?.action === "rename" ? <TextField autoFocus fullWidth size="small" label={t("Scenario name")} sx={{ mt: 1 }}
          value={editedName ?? scenarioLabel(name)} onChange={(event) => setEditedName(event.target.value)} slotProps={{ htmlInput: { maxLength: 100 } }} /> :
          <p style={{ margin: 0 }}>{t("Remove “")}{dialog ? scenarioLabel(dialog.item.name) : ""}”?</p>}
        {mutation.error && <Alert severity="error" sx={{ mt: 1 }}>{t(mutation.error.message)}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setDialog(null)}>{t("Cancel")}</Button>
        <Button variant="contained" color={dialog?.action === "delete" ? "error" : "primary"}
          disabled={mutation.isPending || dialog?.action === "rename" && !name.trim()}
          onClick={() => { if (dialog) mutation.mutate(dialog); }}>{dialog?.action === "rename" ? t("Save name") : t("Delete")}</Button>
      </DialogActions>
    </Dialog>
  </>;
}
