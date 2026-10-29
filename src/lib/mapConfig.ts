/**
 * Map tiles.
 *
 * The public OpenStreetMap tile server is fine for development but is not meant
 * for heavy use. Set VITE_MAP_TILE_URL (and VITE_MAP_ATTRIBUTION) to a
 * free-tier provider before launch; see the README.
 */
const env = import.meta.env as Record<string, string | undefined>;

export const MAP_TILE_URL =
  env["VITE_MAP_TILE_URL"] ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export const MAP_ATTRIBUTION =
  env["VITE_MAP_ATTRIBUTION"] ??
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Zoom used when the map opens on a play area. */
export const MAP_DEFAULT_ZOOM = 15;
