import type { Route } from "./types";

type EmittingRoute = Pick<Route, "km" | "co2_kg">;

export function emissionTotals(routes: EmittingRoute[]) {
  return routes.reduce(
    (total, route) => ({ km: total.km + route.km, co2_kg: total.co2_kg + route.co2_kg }),
    { km: 0, co2_kg: 0 },
  );
}

export function emissionDrivers(original: EmittingRoute, shared: EmittingRoute) {
  if (original.km <= 0) return null;
  // First change distance at the original weighted rate, then switch rates.
  const atOriginalRate = shared.km * (original.co2_kg / original.km);
  return {
    distance: atOriginalRate - original.co2_kg,
    fleetMix: shared.co2_kg - atOriginalRate,
    total: shared.co2_kg - original.co2_kg,
  };
}
