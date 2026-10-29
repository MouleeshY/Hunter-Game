import type { GpsFix } from "@/hooks/useGeolocation";

/**
 * Developer-only simulated GPS.
 *
 * Replays a slow scripted walk around the play area so the map, pings and
 * visibility can be tested indoors. The switch that turns this on only exists in
 * development builds.
 */
export function simulatedFixAt(input: {
  centre: { lat: number; lng: number };
  radiusMetres: number;
  elapsedMs: number;
  accuracyMetres?: number;
}): GpsFix {
  const { centre, radiusMetres, elapsedMs, accuracyMetres = 8 } = input;

  // Walk a circle at roughly walking pace (1.4 m/s), well inside the zone.
  const walkRadius = Math.max(20, radiusMetres * 0.45);
  const speed = 1.4;
  const angle = (speed * (elapsedMs / 1000)) / walkRadius;

  const metresPerLat = 111_320;
  const metresPerLng =
    111_320 * Math.cos((centre.lat * Math.PI) / 180);

  return {
    lat: centre.lat + (walkRadius * Math.sin(angle)) / metresPerLat,
    lng: centre.lng + (walkRadius * Math.cos(angle)) / metresPerLng,
    accuracy: accuracyMetres,
    atMs: Date.now(),
  };
}

/** Test mode is compiled out of production behaviour. */
export function simulatedGpsAvailable(): boolean {
  return import.meta.env.DEV;
}
