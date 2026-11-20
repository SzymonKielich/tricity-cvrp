"use client";

import { useLanguage } from "@/lib/language";
import { MapPin, ScanLine } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map, StyleSpecification } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry, LineString, Point, Position } from "geojson";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { vehicleColor, vehicleLabel } from "@/lib/scenario";
import { SchematicMap } from "./schematic-map";
import type { Network, Node, Route } from "@/lib/types";

const blank = (): FeatureCollection => ({ type: "FeatureCollection", features: [] });
const feature = <T extends Geometry>(geometry: T, properties: Record<string, string | number>): Feature<T> =>
  ({ type: "Feature", geometry, properties });
const point = (node: Node): Position => [node.longitude, node.latitude];
const colors = { hub: "#173a2e", member: "#08795f", shop: "#b86835", destination: "#467cb4" };
const zoneColors = ["#54749a", "#5e7f56", "#b86a47", "#8262a3", "#26838a", "#9c6953", "#3e74b8", "#9b5d79", "#327c61", "#b18939"];
const tilesUrl = process.env.NEXT_PUBLIC_BASEMAP_TILES ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export interface RouteLayer { routes: Route[]; baseline?: boolean; color?: string }
interface Props {
  network?: Network;
  nodes?: Node[];
  layers?: RouteLayer[];
  hub?: string;
  selected?: string | null;
  onNode?: (id: string) => void;
  position?: { from: string; to: string; ratio: number } | null;
  height?: number;
  fitRoute?: boolean;
  zoneColorsEnabled?: boolean;
  label?: string;
}

export function NetworkMap({ network, nodes, layers, hub, selected, onNode, position, height = 400,
  zoneColorsEnabled = false, fitRoute = false, label = "Viladecans network" }: Props) {
  const { t } = useLanguage();
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const click = useRef(onNode);
  const movingMarker = useRef<maplibregl.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [schematic, setSchematic] = useState(false);
  const fallback = mapError || schematic;
  const [street, setStreet] = useState(process.env.NEXT_PUBLIC_BASEMAP !== "off");
  const lookup = useMemo(() => new MapConstructor(network?.nodes.map((node) => [node.id, node])), [network]);
  useEffect(() => { click.current = onNode; }, [onNode]);

  useEffect(() => {
    if (!element.current) return;
    let instance: Map;
    const style: StyleSpecification = {
      version: 8,
      sources: {
        street: { type: "raster", tiles: [tilesUrl], tileSize: 256, maxzoom: 19,
          attribution: t("© <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noreferrer\">OpenStreetMap contributors</a>") },
        lines: { type: "geojson", data: blank() },
        nodes: { type: "geojson", data: blank() },
      },
      layers: [
        { id: "background", type: "background", paint: { "background-color": "#e4ede7" } },
        { id: "street", type: "raster", source: "street", layout: { visibility: "none" },
          paint: { "raster-saturation": -0.75, "raster-contrast": -0.09, "raster-brightness-min": 0.20, "raster-opacity": 0.90 } },
        { id: "baseline-lines", type: "line", source: "lines", filter: ["==", ["get", "baseline"], 1],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ["get", "color"], "line-opacity": 0.66, "line-width": 2, "line-dasharray": [2, 2] } },
        { id: "route-lines", type: "line", source: "lines", filter: ["==", ["get", "baseline"], 0],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ["get", "color"], "line-opacity": ["get", "opacity"], "line-width": ["get", "width"] } },
        { id: "node-points", type: "circle", source: "nodes", layout: { "circle-sort-key": ["get", "rank"] },
          paint: { "circle-radius": ["get", "radius"], "circle-color": ["get", "color"],
            "circle-opacity": ["get", "opacity"], "circle-stroke-color": "#fff", "circle-stroke-width": ["get", "stroke"] } },
      ],
    };

    try {
      maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
      instance = new maplibregl.Map({
        container: element.current, style,
        locale: {
          "Map.Title": t("Map", "Mapa"),
          "NavigationControl.ZoomIn": t("Zoom in"),
          "NavigationControl.ZoomOut": t("Zoom out"),
          "AttributionControl.ToggleAttribution": t("Toggle attribution", "Pokaż lub ukryj źródła mapy"),
          "AttributionControl.MapFeedback": t("Map feedback", "Zgłoś problem z mapą"),
        },
        center: [2.04, 41.323], zoom: 11.15,
        maxZoom: 17, minZoom: 8, dragRotate: false, pitchWithRotate: false, scrollZoom: false,
        attributionControl: { compact: true, customAttribution: t("<a href=\"https://www.openstreetmap.org/fixthemap\" target=\"_blank\" rel=\"noreferrer\">Report a map issue</a>") },
        maxTileCacheSize: 100,
      });
    } catch {
      const frame = requestAnimationFrame(() => setMapError(true));
      return () => cancelAnimationFrame(frame);
    }
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const readyTimeout = setTimeout(() => setMapError(true), 8000);
    instance.once("load", () => {
      clearTimeout(readyTimeout);
      setMapError(false);
      setReady(true);
    });
    instance.on("click", "node-points", (event) => {
      const id: unknown = event.features?.[0]?.properties?.id;
      if (typeof id === "string") click.current?.(id);
    });
    instance.on("mouseenter", "node-points", () => { instance.getCanvas().style.cursor = "pointer"; });
    instance.on("mouseleave", "node-points", () => { instance.getCanvas().style.cursor = ""; });
    const canvas = instance.getCanvas();
    const showSchematic = () => setMapError(true);
    const showWebGL = () => setMapError(false);
    canvas.addEventListener("webglcontextlost", showSchematic);
    canvas.addEventListener("webglcontextrestored", showWebGL);
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(element.current);
    return () => {
      clearTimeout(readyTimeout);
      resize.disconnect();
      canvas.removeEventListener("webglcontextlost", showSchematic);
      canvas.removeEventListener("webglcontextrestored", showWebGL);
      movingMarker.current?.remove();
      movingMarker.current = null;
      instance.remove();
      map.current = null;
      setReady(false);
    };
  }, [t]);

  useEffect(() => {
    if (ready) map.current?.setLayoutProperty("street", "visibility", street && !fallback ? "visible" : "none");
  }, [ready, street, fallback]);

  const boundsNodes = useMemo(() => {
    const routeNodes = [...new Set(layers?.[0]?.routes[0]?.stops.map((stop) => stop.location))]
      .flatMap((id) => lookup.get(id) ?? []);
    return fitRoute && routeNodes.length > 1 ? routeNodes : network?.nodes ?? [];
  }, [fitRoute, layers, lookup, network]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || fallback || !boundsNodes.length || !instance || !element.current) return;
    const bounds = new maplibregl.LngLatBounds();
    boundsNodes.forEach((node) => bounds.extend([node.longitude, node.latitude]));
    function fit() {
      instance!.resize();
      instance!.fitBounds(bounds, { padding: 42, maxZoom: fitRoute ? 14.5 : 12.5, duration: 0 });
    }
    fit();
    if (fitRoute) {
      const resize = new ResizeObserver(fit);
      resize.observe(element.current);
      return () => resize.disconnect();
    }
  }, [ready, fallback, boundsNodes, fitRoute]);

  const markers = useMemo(() => {
    if (!network) return [];
    const features: Feature<Point>[] = [];
    const routeNodes = new Set(layers?.flatMap((layer) => layer.routes.length === 1 ?
      layer.routes[0].stops.map((stop) => stop.location) : []) ?? []);
    for (const node of nodes ?? network.nodes) {
      const isHub = node.id === (hub ?? network.hub);
      const isSelected = node.id === selected;
      const isShop = node.kind === "shop";
      const onRoute = routeNodes.has(node.id);
      const zone = network.zones.indexOf(node.zones[0]);
      const color = isHub ? colors.hub : isShop ? (node.participant ? colors.member : colors.shop) :
        zoneColorsEnabled ? zoneColors[zone % zoneColors.length] ?? colors.destination : colors.destination;
      features.push(feature({ type: "Point", coordinates: point(node) }, {
        id: node.id, color, rank: isSelected ? 8 : isHub ? 7 : isShop ? 5 : onRoute ? 4 : 1,
        radius: isSelected ? 9 : isHub ? 8 : isShop ? 4.6 : onRoute ? 4.8 : 2.9,
        stroke: isHub || isSelected ? 2.1 : 1, opacity: routeNodes.size && !isHub && !onRoute && !isSelected ? 0.36 : 0.91,
      }));
    }
    return features;
  }, [network, nodes, layers, hub, selected, zoneColorsEnabled]);

  const lines = useMemo(() => {
    const features: Feature<LineString>[] = [];
    for (const layer of layers ?? []) {
      for (const route of layer.routes) {
        const coordinates = route.stops.flatMap((stop) => {
          const node = lookup.get(stop.location);
          return node ? [point(node)] : [];
        });
        if (coordinates.length < 2) continue;
        features.push(feature({ type: "LineString", coordinates }, {
          color: layer.color ?? (layer.baseline ? "#6c7b74" : vehicleColor[route.vehicle_type]),
          baseline: layer.baseline ? 1 : 0,
          opacity: layer.routes.length === 1 ? 0.94 : 0.63,
          width: layer.routes.length === 1 ? 3.8 : 2.15,
        }));
      }
    }
    return features;
  }, [layers, lookup]);

  const vehicle = useMemo(() => {
    const from = position && lookup.get(position.from);
    const to = position && lookup.get(position.to);
    return from && to && position ? feature<Point>({
      type: "Point", coordinates: [from.longitude + (to.longitude - from.longitude) * position.ratio,
        from.latitude + (to.latitude - from.latitude) * position.ratio],
    }, {}) : undefined;
  }, [lookup, position]);

  useEffect(() => {
    if (ready) map.current?.getSource<GeoJSONSource>("nodes")?.setData({ type: "FeatureCollection", features: markers });
  }, [ready, markers]);

  useEffect(() => {
    if (ready) map.current?.getSource<GeoJSONSource>("lines")?.setData({ type: "FeatureCollection", features: lines });
  }, [ready, lines]);

  useLayoutEffect(() => {
    if (!ready || fallback || !vehicle || !map.current) {
      movingMarker.current?.remove();
      movingMarker.current = null;
      return;
    }
    const [longitude, latitude] = vehicle.geometry.coordinates;
    if (!movingMarker.current) {
      const element = document.createElement("div");
      element.className = "simulation-marker";
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", t("Route simulation"));
      movingMarker.current = new maplibregl.Marker({ element, subpixelPositioning: true }).setLngLat([longitude, latitude]).addTo(map.current);
    } else {
      movingMarker.current.setLngLat([longitude, latitude]);
    }
  }, [ready, fallback, vehicle, t]);

  return <div className="map-shell" style={{ "--map-height": `${height}px` } as CSSProperties}>
    <div className="map-canvas" ref={element} aria-label={t("Interactive network map")} hidden={fallback} />
    {fallback && <SchematicMap key={fitRoute ? layers?.[0]?.routes[0]?.id : undefined} boundsNodes={boundsNodes} markers={markers} lines={lines}
      vehicle={vehicle} onNode={onNode} />}
    <div className="map-label"><MapPin size={13} /> {t(label)}</div>
    {fitRoute && !mapError && <button className="map-mode" type="button" onClick={() => setSchematic(!schematic)}>
      {schematic ? t("WebGL map") : t("Schematic view")}
    </button>}
    {!fallback &&
      <button type="button" className="map-basemap" onClick={() => setStreet((value) => !value)} aria-pressed={street}>
        {street ? t("Hide streets") : t("Show streets")}
      </button>}
  </div>;
}

const MapConstructor = globalThis.Map;

export function Legend({ nature = "network" }: { nature?: "network" | "routes" | "both" }) {
  const { t } = useLanguage();
  const entries = nature === "network" ? [[t("Hub"), colors.hub], [t("Participating shop"), colors.member],
    [t("Other shop"), colors.shop], [t("Destination"), colors.destination]] :
    nature === "routes" ? Object.entries(vehicleColor).map(([key, color]) => [vehicleLabel[key as Route["vehicle_type"]], color]) :
    [[t("Original plan"), "#6c7b74"], [t("Shared plan"), "#08765f"]];
  return <div className="map-legend">
    {entries.map(([name, color]) => <span className="legend-key" key={name}><i
      className={nature === "network" ? "legend-dot" : "legend-line"} style={{ "--dot": color } as CSSProperties} />{t(name)}</span>)}
  </div>;
}

export function Schematic() {
  const { t } = useLanguage();
  return <span className="inline"><ScanLine size={13} /> {t("Schematic connections · matrix distances")}</span>;
}
