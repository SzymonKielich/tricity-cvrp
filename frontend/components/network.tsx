"use client";

import { useLanguage } from "@/lib/language";
import { Button, Chip, MenuItem, TextField } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { MapPin, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { useBaseline, useDates, useNetwork, useVehicles } from "@/lib/api";
import { DEFAULT_DATE, vehicleLabel } from "@/lib/scenario";
import type { Node } from "@/lib/types";
import { Legend, NetworkMap, Schematic } from "./network-map";
import { DateField, Page, Panel, State } from "./ui";

export function NetworkExplorer() {
  const { t, categoryLabel, number } = useLanguage();
  const network = useNetwork();
  const vehicles = useVehicles();
  const dates = useDates();
  const [date, setDate] = useState(DEFAULT_DATE);
  const [shop, setShop] = useState("");
  const [destination, setDestination] = useState("");
  const [zone, setZone] = useState("");
  const [participation, setParticipation] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [clusters, setClusters] = useState(false);
  const baseline = useBaseline(date, "all", clusters);
  const filtered = useMemo(() => network.data?.nodes.filter((node) => {
    if (zone && !node.zones.includes(zone)) return false;
    if (node.kind === "shop") {
      if (shop && node.id !== shop) return false;
      if (participation && node.participant !== (participation === "member")) return false;
      if (destination && !network.data?.nodes.find((item) => item.id === destination)?.shops?.includes(node.id)) return false;
    } else {
      if (destination && node.id !== destination) return false;
      if (shop && !node.shops?.includes(shop)) return false;
      if (participation && !node.shops?.some((id) => network.data?.nodes.find((item) => item.id === id)?.participant === (participation === "member"))) return false;
    }
    return true;
  }) ?? [], [network.data, shop, destination, zone, participation]);
  const detail = network.data?.nodes.find((node) => node.id === selected);
  const clusterRoutes = baseline.data?.routes.filter((route) => {
    const origin = filtered.find((node) => node.id === route.shop);
    if (!origin) return false;
    return !zone && !destination || route.stops.some((stop) =>
      filtered.some((node) => node.id === stop.location && node.kind === "destination"));
  });
  const columns: GridColDef<Node>[] = [
    { field: "id", headerName: t("Node"), width: 104 },
    { field: "kind", headerName: t("Type"), width: 122, valueFormatter: (value: Node["kind"]) => value === "shop" ? t("Shop") : t("Destination") },
    { field: "category", headerName: t("Category"), flex: 1, minWidth: 120, valueGetter: (value: string) => categoryLabel(value) },
    { field: "zones", headerName: t("Zones"), flex: 1, minWidth: 116, valueGetter: (value: string[]) => value.join(", ") },
    { field: "participant", headerName: t("Participation"), width: 121,
      valueGetter: (value: boolean | undefined) => value == null ? "-" : value ? t("Participating") : t("Independent") },
  ];

  return <>
    <Page title={t("Network explorer")} description={t("Inspect Hedyla’s shop nodes, customer destinations and original delivery clusters.")} />
    <div className="app-grid">
      <div className="stack">
        <Panel title={t("Distribution map")} description={t(`Visible nodes: ${filtered.length}`, `Liczba widocznych punktów: ${filtered.length}`)}
          action={<Button size="small" variant={clusters ? "contained" : "outlined"} onClick={() => setClusters(!clusters)} aria-pressed={clusters}> {t("Original routes")}</Button>} footer={<><Legend /><Schematic /></>}>
          <NetworkMap network={network.data} nodes={filtered} selected={selected} onNode={setSelected} height={454}
            zoneColorsEnabled={Boolean(zone)} layers={clusters && clusterRoutes ? [{ routes: clusterRoutes, baseline: true }] : undefined} />
        </Panel>
        <Panel title={t("Network nodes")} description={t("Select a row for node details")}>
          <div style={{ height: 340 }}>
            <DataGrid rows={filtered} columns={columns} loading={network.isLoading} density="compact"
              onRowClick={(params) => setSelected(params.row.id)} disableRowSelectionOnClick
              initialState={{ pagination: { paginationModel: { page: 0, pageSize: 10 } } }}
              pageSizeOptions={[10, 25, 50]} sx={{ border: 0, "--DataGrid-containerBackground": "var(--soft)" }} />
          </div>
        </Panel>
      </div>
      <div className="stack">
        <Panel title={t("Map filters")} action={<Button size="small" startIcon={<RotateCcw size={14} />} onClick={() => {
          setShop(""); setDestination(""); setZone(""); setParticipation("");
        }}>{t("Reset")}</Button>}>
          <div className="panel-body form-fields">
            <TextField select label={t("Shop")} value={shop} onChange={(event) => setShop(event.target.value)} size="small">
              <MenuItem value="">{t("All shops")}</MenuItem>
              {network.data?.nodes.filter((node) => node.kind === "shop").map((node) =>
                <MenuItem value={node.id} key={node.id}>{node.id} · {categoryLabel(node.category)}</MenuItem>)}
            </TextField>
            <TextField select label={t("Delivery zone")} value={zone} onChange={(event) => setZone(event.target.value)} size="small">
              <MenuItem value="">{t("All zones")}</MenuItem>
              {network.data?.zones.map((id) => <MenuItem value={id} key={id}>{id}</MenuItem>)}
            </TextField>
            <TextField select label={t("Participation")} value={participation} onChange={(event) => setParticipation(event.target.value)} size="small">
              <MenuItem value="">{t("All shops")}</MenuItem><MenuItem value="member">{t("Participating")}</MenuItem><MenuItem value="other">{t("Independent")}</MenuItem>
            </TextField>
            <TextField select label={t("Destination")} value={destination} onChange={(event) => setDestination(event.target.value)} size="small">
              <MenuItem value="">{t("All destinations")}</MenuItem>
              {network.data?.nodes.filter((node) => node.kind === "destination").map((node) =>
                <MenuItem value={node.id} key={node.id}>{node.id} · {node.zones[0]}</MenuItem>)}
            </TextField>
            {clusters && <DateField value={date} choices={dates.data} onChange={setDate} label={t("Cluster date")} />}
          </div>
        </Panel>
        <Panel title={t("Node details")} action={<MapPin size={16} />}>
          {detail ? <div className="panel-body">
            <div className="inline"><strong>{detail.id}</strong>{detail.id === network.data?.hub && <Chip label={t("Default hub")} color="success" />}</div>
            <p className="muted" style={{ fontSize: 12 }}>{categoryLabel(detail.category)} · {detail.zones.join(", ")}</p>
            <p style={{ fontSize: 12 }}>{number(detail.latitude, 5)}° N · {number(detail.longitude, 5)}° E</p>
            {detail.kind === "shop" ? <div className="muted" style={{ fontSize: 12 }}>
              {detail.participant ? t("Platform participant") : t("Independent shop")} {t("- Pickup")} {detail.window_start}-{detail.window_end}
            </div> : <div className="muted" style={{ fontSize: 12 }}>{t("Linked shops:")} {detail.shops?.length ?? 0}</div>}
          </div> : <State error={network.error} empty={t("Select a map marker or a node in the table.")} />}
        </Panel>
        <Panel title={t("Available fleet")} description={t("Vehicle classes in the source data")}>
          <div className="panel-body">
            {vehicles.data?.classes.map((item) => <div key={item.type} className="inline" style={{ justifyContent: "space-between", margin: "4px 0 11px" }}>
              <span style={{ fontSize: 12 }}>{t(vehicleLabel[item.type])} <span className="muted">· {item.capacity_kg} kg</span></span>
              <Chip label={item.available} size="small" variant="outlined" />
            </div>)}
          </div>
        </Panel>
      </div>
    </div>
  </>;
}
