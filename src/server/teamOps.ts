/**
 * Pure team-assignment and zone-picking helpers.
 *
 * These are plain TypeScript with no Convex imports. They belong here (and in
 * `src/rules` for the rule math) rather than in `src/convex` so the same logic
 * can be reused unchanged when we move to Supabase.
 */

import type { Role, PlayerMode, LatLng } from "../rules/types";
import { RULES_CONFIG } from "../rules/config";

// ---- team assignment --------------------------------------------------------

/** How many Hunters and Shadows to create for a given roster size. */
export interface TeamConfig {
  hunterCount: number;
  shadowCount: number;
}

/** Derive a Hunter-to-Shadow ratio that scales with the player count and
 *   always leaves at least one of each team. */
export function teamConfigForCount(playerCount: number): TeamConfig {
  if (playerCount < 2) {
    // The rules assume two teams; a single player cannot be both.
    throw new Error("A match needs at least two players to form two teams.");
  }

  // The config expresses the ratio as a rough template (for example 1 Hunter
  // for every 3 players). We scale it with the actual count, never drop below
  // one Hunter or one Shadow, and never exceed the player count.
  const { hunterCount: templateHunters, shadowCount: templateShadows } =
    RULES_CONFIG.hunterSplit;

  const templateTotal = templateHunters + templateShadows;
  if (templateTotal <= 0) {
    throw new Error("hunterSplit sums to zero in config.");
  }

  // Scale the template to the actual player count, rounding Hunters down so
  // Shadows absorb the remainder.
  const scaledHunters = Math.round((playerCount * templateHunters) / templateTotal);
  const scaledShadows = playerCount - scaledHunters;

  // Clip to keep at least one of each team.
  let hunters = Math.max(1, Math.min(playerCount - 1, scaledHunters));
  const shadows = playerCount - hunters;

  return { hunterCount: hunters, shadowCount: shadows };
}

/** Assign team roles to a freshly joined roster. Deterministic enough to look
 *   random to players but reproducible if we ever need to replay a match. */
export function assignTeams(
  playerCount: number,
  seed: number,
): { role: Role }[] {
  const { hunterCount, shadowCount } = teamConfigForCount(playerCount);
  if (hunterCount + shadowCount !== playerCount) {
    throw new Error("teamConfigForCount did not sum to playerCount.");
  }

  // Fisher-Yates shuffle with an integer seed so the same roster always gets the
  // same assignment across clients. Hunters first, then a shuffle, then the
  // first `hunterCount` slots are Hunters.
  const roles: Role[] = Array(hunterCount).fill("hunter").concat(
    Array(shadowCount).fill("shadow"),
  );
  let s = seed >>> 0;
  for (let i = roles.length - 1; i > 0; i--) {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s ^= s >>> 16;
    const j = Math.abs(s) % (i + 1);
    const tmp = roles[i];
    roles[i] = roles[j];
    roles[j] = tmp;
  }

  return roles.map((role) => ({ role }));
}

// ---- zone centre picking ----------------------------------------------------

/** Pick a random centre inside a circle of radius `maxDistanceMetres` around the
 *   organiser's position. If `avoid` is set the returned centre must be at least
 *   that far from the avoided point, re-rolling up to a fixed budget. */
export function randomZoneCentre(args: {
  organiserLat: number;
  organiserLng: number;
  maxDistanceMetres: number;
  avoid?: LatLng | null;
}): LatLng {
  const { organiserLat, organiserLng, maxDistanceMetres, avoid } = args;
  if (maxDistanceMetres <= 0) {
    throw new Error("maxDistanceMetres must be positive.");
  }

  let attempt = 0;
  const budget = 100;
  while (attempt < budget) {
    attempt++;
    const centre = randomPointInCircle(organiserLat, organiserLng, maxDistanceMetres);
    if (avoid == null) return centre;
    if (distanceMetres(centre, avoid) >= 30) return centre;
  }

  // Fall back to a point directly south of the organiser when re-rolls keep
  // landing on the avoided point. This should practically never happen with a
  // 500 m circle and a 30 m exclusion.
  return randomPointInCircle(organiserLat, organiserLng, maxDistanceMetres);
}

/** Random point uniformly chosen by area inside a circle around the organiser. */
export function randomPointInCircle(
  orgLat: number,
  orgLng: number,
  radiusMetres: number,
): LatLng {
  // Uniform in area: pick a random radius and a random angle, then convert.
  const r = radiusMetres * Math.sqrt(Math.random());
  const angleRad = Math.random() * 2 * Math.PI;

  // One degree of latitude is about 111 km. Longitude shrinks with cos(lat).
  const metresPerLatDegree = 111320;
  const metresPerLngDegree = 111320 * Math.cos(toRad(orgLat));

  const dLat = (r * Math.cos(angleRad)) / metresPerLatDegree;
  const dLng = (r * Math.sin(angleRad)) / metresPerLngDegree;

  return {
    lat: orgLat + dLat,
    lng: orgLng + dLng,
  };
}

// ---- geometry ---------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

function distanceMetres(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
