"use client";

import { useLanguage } from "@/lib/language";
import { memo, useMemo, useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { clock } from "@/lib/format";
import { cargoAt, cargoTimeline, playbackSpeeds, stopIndexAt, usePlayback } from "@/lib/route-playback";
import { positionAt, vehicleColor, vehicleLabel } from "@/lib/scenario";
import type { Network, Route, Stop } from "@/lib/types";
import { NetworkMap } from "./network-map";

export type RouteCard = ComponentType<{ title: string; children: ReactNode; footer?: ReactNode }>;

export interface PlayerProps {
  time: number;
  start: number;
  end: number;
  speed: number;
  playing: boolean;
  toggle: () => void;
  seek: (value: number) => void;
  changeSpeed: (value: number) => void;
}

export function playbackClock(seconds: number) {
  return `${clock(seconds)}:${String(Math.floor(seconds) % 60).padStart(2, "0")}`;
}

export function PlainPlayer({ time, start, end, speed, playing, toggle, seek, changeSpeed }: PlayerProps) {
  const { t } = useLanguage();
  const limit = Math.ceil(end - start);
  return <>
    <div className="playback-controls">
      <button type="button" onClick={toggle} disabled={!limit}>{playing ? t("Pause") : t("Play")}</button>
      <output aria-live="off" aria-label={t("Simulation time")} className="simulation-time">{playbackClock(time)}</output>
      <label>{t("Speed")} <select aria-label={t("Speed")} value={speed} onChange={(event) => changeSpeed(Number(event.target.value))}>
        {playbackSpeeds.map((option) => <option key={option} value={option}>{option}×</option>)}
      </select></label>
    </div>
    <input type="range" aria-label={t("Route time")} aria-valuetext={playbackClock(time)} min={0} max={limit}
      disabled={!limit} value={time === end ? limit : Math.floor(time - start)}
      onChange={(event) => seek(Number(event.target.value) === limit ? end : start + Number(event.target.value))} />
  </>;
}

export function stopLabel(stop: Stop, index: number, baseline: boolean) {
  if (stop.kind === "pickup") return "Pickup";
  if (stop.kind === "delivery") return "Delivery";
  if (index === 0) return baseline ? "Shop departure" : "Hub departure";
  return baseline ? "Shop return" : "Hub return";
}

function Capacity({ label, value, limit, unit, digits }: {
  label: string; value: number; limit: number; unit: string; digits: number;
}) {
  const { number } = useLanguage();
  const percentage = 100 * value / limit;
  return <div className="cargo-capacity">
    <div><strong>{label}</strong><span>{number(value, digits)} / {number(limit, digits)} {unit} · {number(percentage, 1)}%</span></div>
    <progress aria-label={label} value={Math.min(value, limit)} max={limit} />
  </div>;
}

const polishPlurals = new Intl.PluralRules("pl-PL");
const polishOrders: Partial<Record<Intl.LDMLPluralRule, string>> = { one: "zamówienie", few: "zamówienia" };

const CargoPanel = memo(function CargoPanel({ route, snapshot, Card }: {
  route: Route; snapshot: ReturnType<typeof cargoAt>; Card: RouteCard;
}) {
  const { t } = useLanguage();
  const { orders, weight, volume, event } = snapshot;
  const verb = event?.kind === "pickup" ? t("Picked up") : t("Delivered");
  const polishNoun = polishOrders[polishPlurals.select(event?.count ?? 0)] ?? "zamówień";
  const noun = t(event?.count === 1 ? "order" : "orders", polishNoun);
  return <Card title={t("Vehicle load")}>
    <div className="cargo-body">
      <p className="cargo-total"><strong aria-label={t("Orders on board")}>{orders.length}</strong> {t("on board")}</p>
      <Capacity label={t("Weight")} value={weight} limit={route.cargo.capacity_kg} unit="kg" digits={2} />
      <Capacity label={t("Volume")} value={volume} limit={route.cargo.capacity_m3} unit="m³" digits={3} />
      <p className="cargo-event" role="status">{event ? `${verb} ${event.count} ${noun} · ${event.location}`
        : orders.length ? t("Loaded at the shop before departure.") : t("Before the first pickup.")}</p>
      {orders.length > 0 && <div className="cargo-table"><table>
        <thead><tr><th>{t("Order")}</th><th>{t("Shop")}</th><th>{t("Destination")}</th></tr></thead>
        <tbody>{orders.map((order) => <tr key={order.order_id}>
          <td>{order.order_id}</td><td>{order.shop_id}</td><td>{order.destination_id}</td>
        </tr>)}</tbody>
      </table></div>}
    </div>
  </Card>;
});

export function RouteSimulation({ playbackKey, route, network, hub, baseline, Card, Player = PlainPlayer, sidebar, details }: {
  playbackKey: string; route: Route; network?: Network; hub?: string; baseline: boolean; Card: RouteCard;
  Player?: ComponentType<PlayerProps>; sidebar?: ReactNode; details?: ReactNode;
}) {
  const { t, number } = useLanguage();
  const player = usePlayback(playbackKey, route.start_s, route.end_s);
  const { time } = player;
  const [pickedNode, pickNode] = useState<{ key: string; id: string }>();
  const marker = pickedNode?.key === playbackKey ? pickedNode.id : null;
  const layers = useMemo(() => [{ routes: [route], baseline }], [route, baseline]);
  const timeline = useMemo(() => cargoTimeline(route), [route]);
  const stopIndex = stopIndexAt(route.stops, time);
  const stop = route.stops[stopIndex];
  const segment = route.segments.find((item) => time < item.end_s);
  const position = positionAt(route.segments, time) ?? { from: stop.location, to: stop.location, ratio: 0 };
  const current = time >= route.end_s ? t("End of route") : segment?.kind === "drive" ? t(`Driving to ${segment.to}`, `Przejazd do ${segment.to}`)
    : segment?.kind === "wait" ? t(`Waiting at ${segment.to}`, `Oczekiwanie w ${segment.to}`) : `${t(stopLabel(stop, stopIndex, baseline))} · ${stop.location}`;

  return <div className="route-simulation">
    <div className="simulation-map">
      <Card title={t(`Route map · ${route.vehicle_id ?? route.id}`, `Mapa trasy · ${route.vehicle_id ?? route.id}`)}
        footer={<div className="map-legend">
          <span className="legend-key"><i className="legend-line" style={{ "--dot": baseline ? "#6c7b74" : vehicleColor[route.vehicle_type] } as CSSProperties} />
            {baseline ? t("Original plan") : t(vehicleLabel[route.vehicle_type])}</span>
          <span className="legend-key"><i className="legend-vehicle" /> {t("Route simulation")}</span>
          <span>{t("Lines connect stops in visit order")}</span>
        </div>}>
        <NetworkMap network={network} hub={hub} layers={layers} selected={marker ?? (segment?.kind === "wait" ? segment.to : stop.location)}
          onNode={(id) => pickNode(marker === id ? undefined : { key: playbackKey, id })} position={position} fitRoute height={420} />
        {marker && <p className="simulation-node"><strong>{marker}</strong> · {
          route.stops.filter((item) => item.location === marker).map((item) => clock(item.arrival_s)).join(" · ") || t("Outside the route")
        }</p>}
      </Card>
    </div>
    <div className="simulation-player">
      <Card title={t("Route simulation")}>
        <div className="simulation-body">
          <Player {...player} start={route.start_s} end={route.end_s} />
          <div className="simulation-limits"><span>{playbackClock(route.start_s)}</span><span>{playbackClock(route.end_s)}</span></div>
          <p className="simulation-stop"><strong>{current}</strong><span>{t("Last stop ·")} {stop.location} ({stopIndex + 1}/{route.stops.length})</span></p>
        </div>
      </Card>
    </div>
    <div className="simulation-side">
      {sidebar}
      <CargoPanel route={route} snapshot={cargoAt(timeline, time)} Card={Card} />
      {details ?? <Card title={t("Stop sequence")}>
        <div className="simulation-body">
          <p className="route-summary">{t(vehicleLabel[route.vehicle_type])} · {number(route.km, 1)} km</p>
          <ol className="simulation-stops">{route.stops.map((item, index) => <li key={index} aria-current={index === stopIndex ? "step" : undefined}>
            <time>{clock(item.arrival_s)}</time> <span>{t(stopLabel(item, index, baseline))} · {item.location}</span>
          </li>)}</ol>
        </div>
      </Card>}
    </div>
  </div>;
}
