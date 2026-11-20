"use client";

import { useLanguage } from "@/lib/language";
import { useState } from "react";
import type { Feature, LineString, Point, Position } from "geojson";
import type { Node } from "@/lib/types";

interface Props {
  boundsNodes: Node[];
  markers: Feature<Point>[];
  lines: Feature<LineString>[];
  vehicle?: Feature<Point>;
  onNode?: (id: string) => void;
}

export function SchematicMap({ boundsNodes, markers, lines, vehicle, onNode }: Props) {
  const { t } = useLanguage();
  const [zoom, setZoom] = useState(1);
  const width = 800;
  const height = 480;
  const [first] = boundsNodes;
  if (!first) return null;

  const west = Math.min(...boundsNodes.map((node) => node.longitude));
  const east = Math.max(...boundsNodes.map((node) => node.longitude));
  const south = Math.min(...boundsNodes.map((node) => node.latitude));
  const north = Math.max(...boundsNodes.map((node) => node.latitude));
  const horizontal = Math.cos((north + south) * Math.PI / 360);
  const scale = Math.min(710 / Math.max((east - west) * horizontal, 0.001),
    370 / Math.max(north - south, 0.001));

  function project([longitude, latitude]: Position) {
    return [width / 2 + (longitude - (west + east) / 2) * horizontal * scale,
      height / 2 - (latitude - (north + south) / 2) * scale];
  }

  const viewport = [width * (1 - 1 / zoom) / 2, height * (1 - 1 / zoom) / 2, width / zoom, height / zoom];

  return <>
    <svg className="map-canvas" style={{ width: "100%", height: "100%" }} viewBox={viewport.join(" ")}
      role="group" aria-label={t("Interactive schematic map")}>
      {lines.map((line, index) => <polyline key={index} fill="none"
        points={line.geometry.coordinates.map((coordinate) => project(coordinate).join(",")).join(" ")}
        stroke={String(line.properties?.color)} strokeOpacity={Number(line.properties?.opacity)}
        strokeWidth={Number(line.properties?.width)} strokeDasharray={line.properties?.baseline ? "4 4" : undefined}
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
      {[...markers].sort((a, b) => Number(a.properties?.rank) - Number(b.properties?.rank)).map((marker) => {
        const [cx, cy] = project(marker.geometry.coordinates);
        const id = String(marker.properties?.id);
        return <circle key={id} cx={cx} cy={cy} r={Number(marker.properties?.radius) / zoom}
          fill={String(marker.properties?.color)} opacity={Number(marker.properties?.opacity)}
          stroke="white" strokeWidth={Number(marker.properties?.stroke)} vectorEffect="non-scaling-stroke"
          role={onNode ? "button" : undefined} tabIndex={onNode ? 0 : undefined} aria-label={id}
          style={onNode ? { cursor: "pointer" } : undefined}
          onClick={onNode ? () => onNode(id) : undefined}
          onKeyDown={onNode ? (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onNode(id);
            }
          } : undefined}>
          <title>{id}</title>
        </circle>;
      })}
      {vehicle && (() => {
        const [cx, cy] = project(vehicle.geometry.coordinates);
        return <circle cx={cx} cy={cy} r={7 / zoom} fill="#162e25" stroke="#8af1ca"
          strokeWidth={3} vectorEffect="non-scaling-stroke" role="img" aria-label={t("Route simulation")}><title>{t("Route simulation")}</title></circle>;
      })()}
    </svg>
    <div className="map-basemap" role="group" aria-label={t("Map zoom")} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span>{t("Schematic map")}</span>
      <button type="button" aria-label={t("Zoom out")} disabled={zoom === 1}
        onClick={() => setZoom((level) => Math.max(1, level - 0.5))}>-</button>
      <button type="button" aria-label={t("Zoom in")} disabled={zoom === 3}
        onClick={() => setZoom((level) => Math.min(3, level + 0.5))}>+</button>
    </div>
  </>;
}
