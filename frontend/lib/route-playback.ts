import { useLayoutEffect, useRef, useState } from "react";
import type { Route, Stop } from "./types";

export const defaultSpeed = 480;
export const playbackSpeeds = [60, 240, defaultSpeed, 960, 1500, 3000, 6000];

export function usePlayback(key: string, start: number, end: number) {
  const [time, setTime] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(defaultSpeed);
  const current = useRef(start);
  const anchor = useRef<{ real: number; simulated: number } | null>(null);
  const frame = useRef<number | null>(null);
  const rate = useRef(defaultSpeed);

  function publish(value: number) {
    current.current = value;
    setTime(value);
  }

  function stop() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    anchor.current = null;
    setPlaying(false);
  }

  function at(now: number) {
    const origin = anchor.current;
    return origin ? Math.min(end, origin.simulated + Math.max(0, now - origin.real) * rate.current / 1000) : current.current;
  }

  function tick(now: number) {
    const value = at(now);
    publish(value);
    if (value >= end) stop();
    else frame.current = requestAnimationFrame(tick);
  }

  function toggle() {
    const now = performance.now();
    if (anchor.current) {
      publish(at(now));
      stop();
    } else if (end > start) {
      if (current.current >= end) publish(start);
      anchor.current = { real: now, simulated: current.current };
      frame.current = requestAnimationFrame(tick);
      setPlaying(true);
    }
  }

  function seek(value: number) {
    stop();
    publish(Math.max(start, Math.min(end, value)));
  }

  function changeSpeed(value: number) {
    if (anchor.current) {
      const now = performance.now();
      const simulated = at(now);
      publish(simulated);
      if (simulated >= end) stop();
      else anchor.current = { real: now, simulated };
    }
    rate.current = value;
    setSpeed(value);
  }

  useLayoutEffect(() => {
    current.current = start;
    setTime(start);
    setPlaying(false);
    function pauseWhenHidden() {
      if (document.hidden && anchor.current) toggle();
    }
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", pauseWhenHidden);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      anchor.current = null;
    };
  }, [key, start, end]);

  return { time: Math.max(start, Math.min(end, time)), playing, speed, toggle, seek, changeSpeed };
}

export function stopIndexAt(stops: Stop[], time: number) {
  const next = stops.findIndex((stop) => stop.arrival_s > time);
  return next === -1 ? stops.length - 1 : Math.max(0, next - 1);
}

export function cargoTimeline({ cargo, stops }: Pick<Route, "cargo" | "stops">) {
  const onboard = new Set(cargo.initial_order_ids);
  const snapshot = () => {
    const orders = [...onboard].map((id) => cargo.orders[id]);
    return {
      orders, weight: orders.reduce((total, order) => total + order.weight_kg, 0),
      volume: orders.reduce((total, order) => total + order.volume_m3, 0),
    };
  };
  const initial = { ...snapshot(), event: null };
  let last: { kind: "pickup" | "delivery"; location: string; count: number } | null = null;
  const changes = stops.flatMap((stop, stopIndex) => {
    const { kind, order_id, location } = stop;
    if (kind === "depot") return [];
    const changed = kind === "pickup" ? !onboard.has(order_id) : onboard.delete(order_id);
    if (!changed) return [];
    if (kind === "pickup") onboard.add(order_id);
    const previous = stops[stopIndex - 1];
    const continues = previous?.location === location && previous.kind === kind && previous.departure_s === stop.arrival_s;
    last = { kind, location, count: continues && last ? last.count + 1 : 1 };
    return [{ ...snapshot(), event: last, time: stop.departure_s }];
  });
  return { initial, changes };
}

export function cargoAt(timeline: ReturnType<typeof cargoTimeline>, time: number) {
  return timeline.changes.findLast((snapshot) => snapshot.time <= time) ?? timeline.initial;
}
