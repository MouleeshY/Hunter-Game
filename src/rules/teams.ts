/**
 * Pure team-assignment and zone-centre helpers.
 *
 * Plain TypeScript with no Convex, React or database imports, so the same logic
 * is reusable from any provider. Ratio and minimums come from `RULES_CONFIG`.
 */
import { RULES_CONFIG, type MatchConfig } from "./config";
import type { LatLng, Role } from "./types";
import { distanceMetres } from "./zone";

// ---- team assignment --------------------------------------------------------

/** How many Hunters and Shadows to create for a given roster size. */
export interface TeamConfig {
  hunterCount: number;
  shadowCount: number;
}

/** Derive a Hunter-to-Shadow ratio that scales with the player count and
 *   always leaves at least one of each team. */
export function teamConfigForCount(
  playerCount: number,
  config: MatchConfig = RULES_CONFIG,
): TeamConfig {
  if (playerCount < 2) {
    throw new Error("A match needs at least two players to form two teams.");
  }

  const { hunterCount: templateHunters, shadowCount: templateShadows } =
    config.hunterSplit;

  const templateTotal = templateHunters + templateShadows;
  if (templateTotal <= 0) {
    throw new Error("hunterSplit sums to zero in config.");
  }

  // Scale the template to the actual player count, rounding Hunters so Shadows
  // absorb the remainder.
  const scaledHunters = Math.round(
    (playerCount * templateHunters) / templateTotal,
  );

  // Clip to keep at least one of each team.
  const hunters = Math.max(1, Math.min(playerCount - 1, scaledHunters));
  const shadows = playerCount - hunters;

  return { hunterCount: hunters, shadowCount: shadows };
}

/** Assign team roles to a freshly joined roster. Deterministic enough to look
 *   random to players but reproducible if we ever need to replay a match. */
export function assignTeams(
  playerCount: number,
  seed: number,
  config: MatchConfig = RULES_CONFIG,
): { role: Role }[] {
  const { hunterCount, shadowCount } = teamConfigForCount(playerCount, config);
  if (hunterCount + shadowCount !== playerCount) {
    throw new Error("teamConfigForCount did not sum to playerCount.");
  }

  // Fisher-Yates shuffle with an integer seed so the same roster always gets the
  // same assignment across clients. Hunters first, then a shuffle, then the
  // first `hunterCount` slots are Hunters.
  const roles: Role[] = Array(hunterCount)
    .fill("hunter")
    .concat(Array(shadowCount).fill("shadow"));
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
 *   `minDistanceFromAvoidMetres` away, re-rolling up to a fixed budget. */
export function randomZoneCentre(args: {
  organiserLat: number;
  organiserLng: number;
  maxDistanceMetres: number;
  avoid?: LatLng | null;
  minDistanceFromAvoidMetres?: number;
}): LatLng {
  const {
    organiserLat,
    organiserLng,
    maxDistanceMetres,
    avoid,
    minDistanceFromAvoidMetres = 30,
  } = args;
  if (maxDistanceMetres <= 0) {
    throw new Error("maxDistanceMetres must be positive.");
  }

  const budget = 100;
  for (let attempt = 0; attempt < budget; attempt += 1) {
    const centre = randomPointInCircle(
      organiserLat,
      organiserLng,
      maxDistanceMetres,
    );
    if (avoid == null) return centre;
    if (distanceMetres(centre, avoid) >= minDistanceFromAvoidMetres) {
      return centre;
    }
  }

  // Fall back to another draw when re-rolls keep landing on the avoided point.
  return randomPointInCircle(organiserLat, organiserLng, maxDistanceMetres);
}

/** Random point uniformly chosen by area inside a circle around the organiser. */
export function randomPointInCircle(
  orgLat: number,
  orgLng: number,
  radiusMetres: number,
): LatLng {
  const r = radiusMetres * Math.sqrt(Math.random());
  const angleRad = Math.random() * 2 * Math.PI;

  // One degree of latitude is about 111 km. Longitude shrinks with cos(lat).
  const metresPerLatDegree = 111320;
  const metresPerLngDegree = 111320 * Math.cos((orgLat * Math.PI) / 180);

  const dLat = (r * Math.cos(angleRad)) / metresPerLatDegree;
  const dLng = (r * Math.sin(angleRad)) / metresPerLngDegree;

  return {
    lat: orgLat + dLat,
    lng: orgLng + dLng,
  };
}
