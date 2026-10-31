import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap } from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { circlePolygon } from "@/rules";
import {
  MAP_ATTRIBUTION,
  MAP_DEFAULT_ZOOM,
  MAP_TILE_URL,
} from "@/lib/mapConfig";

export interface MapMarkerInput {
  id: string;
  lat: number;
  lng: number;
  kind: "live" | "ping" | "delayed";
  label: string;
  ageMs: number;
  accuracyMetres: number | null;
  /** Console only: override the colour with a hex, e.g. by team and status. */
  tone?: string;
}

interface GameMapProps {
  centre: { lat: number; lng: number };
  radiusMetres: number;
  markers?: MapMarkerInput[];
  /** Highlight the ping as it lands. */
  pulseKey?: number;
  className?: string;
}

type SourceData = Parameters<GeoJSONSource["setData"]>[0];

const WORLD: [number, number][] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

function ring(centre: { lat: number; lng: number }, radius: number): [number, number][] {
  return circlePolygon(centre, radius).map(
    (point) => [point.lng, point.lat] as [number, number],
  );
}

function zonePolygon(
  centre: { lat: number; lng: number },
  radius: number,
): SourceData {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [WORLD, ring(centre, radius)],
    },
  } as unknown as SourceData;
}

function zoneOutline(
  centre: { lat: number; lng: number },
  radius: number,
): SourceData {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: ring(centre, radius) },
  } as unknown as SourceData;
}

function markerCollection(markers: MapMarkerInput[]): SourceData {
  return {
    type: "FeatureCollection",
    features: markers.map((marker) => ({
      type: "Feature",
      properties: {
        kind: marker.kind,
        label: marker.label,
        ageMs: marker.ageMs,
        ...(marker.tone ? { tone: marker.tone } : {}),
      },
      geometry: { type: "Point", coordinates: [marker.lng, marker.lat] },
    })),
  } as unknown as SourceData;
}

function accuracyCollection(markers: MapMarkerInput[]): SourceData {
  const features = markers
    .filter((marker) => (marker.accuracyMetres ?? 0) > 0)
    .map((marker) => ({
      type: "Feature",
      properties: { kind: marker.kind },
      geometry: {
        type: "Polygon",
        coordinates: [
          ring(
            { lat: marker.lat, lng: marker.lng },
            Math.min(marker.accuracyMetres ?? 0, 60),
          ),
        ],
      },
    }));
  return { type: "FeatureCollection", features } as unknown as SourceData;
}

export function GameMap({
  centre,
  radiusMetres,
  markers = [],
  pulseKey = 0,
  className,
}: GameMapProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const radiusRef = useRef(radiusMetres);
  const [pulse, setPulse] = useState(false);

  // Create the map once.
  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = new MapLibreMap({
      container: container.current,
      style: {
        version: 8,
        sources: {
          tiles: {
            type: "raster",
            tiles: [MAP_TILE_URL],
            tileSize: 256,
            attribution: MAP_ATTRIBUTION,
          },
        },
        layers: [{ id: "tiles", type: "raster", source: "tiles" }],
      },
      center: [centre.lng, centre.lat],
      zoom: MAP_DEFAULT_ZOOM,
      attributionControl: { compact: true },
    });

    instance.on("load", () => {
      instance.addSource("zone-fill", {
        type: "geojson",
        data: zonePolygon(centre, radiusRef.current),
      });
      instance.addLayer({
        id: "zone-dim",
        type: "fill",
        source: "zone-fill",
        paint: { "fill-color": "#1c1b19", "fill-opacity": 0.38 },
      });

      instance.addSource("zone-outline", {
        type: "geojson",
        data: zoneOutline(centre, radiusRef.current),
      });
      instance.addLayer({
        id: "zone-line",
        type: "line",
        source: "zone-outline",
        paint: { "line-color": "#f6f2ea", "line-width": 2 },
      });

      instance.addSource("accuracy", { type: "geojson", data: accuracyCollection(markers) });
      instance.addLayer({
        id: "accuracy-fill",
        type: "fill",
        source: "accuracy",
        paint: {
          "fill-color": ["match", ["get", "kind"], "ping", "#b8865b", "#4a6b57"],
          "fill-opacity": 0.12,
        },
      });

      instance.addSource("markers", { type: "geojson", data: markerCollection(markers) });
      instance.addLayer({
        id: "markers-circle",
        type: "circle",
        source: "markers",
        paint: {
          "circle-radius": ["match", ["get", "kind"], "ping", 7, "delayed", 5, 6],
          "circle-color": [
            "case",
            ["has", "tone"],
            ["get", "tone"],
            [
              "match",
              ["get", "kind"],
              "ping",
              "#b8865b",
              "delayed",
              "#8a867e",
              "#1c1b19",
            ],
          ],
          "circle-stroke-color": "#f6f2ea",
          "circle-stroke-width": 1.5,
          "circle-opacity": [
            "case",
            ["==", ["get", "kind"], "ping"],
            ["max", 0.25, ["-", 1, ["min", 0.75, ["/", ["get", "ageMs"], 240000]]]],
            1,
          ],
        },
      });

      instance.addLayer({
        id: "markers-label",
        type: "symbol",
        source: "markers",
        layout: {
          "text-field": ["get", "label"],
          "text-size": 11,
          "text-offset": [0, 1.4],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#1c1b19",
          "text-halo-color": "#f6f2ea",
          "text-halo-width": 1.5,
        },
      });

      setReady(true);
    });

    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
    // The map is created once; updates are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recentre when the play area changes.
  useEffect(() => {
    if (!ready || !map.current) return;
    map.current.easeTo({ center: [centre.lng, centre.lat], duration: 600 });
  }, [ready, centre.lat, centre.lng]);

  // Animate the 10-minute shrink.
  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource("zone-fill") as GeoJSONSource | undefined;
    const outline = map.current.getSource("zone-outline") as
      | GeoJSONSource
      | undefined;
    const from = radiusRef.current;
    const to = radiusMetres;
    if (from === to) return;
    const centreLat = centre.lat;
    const centreLng = centre.lng;

    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / 1200);
      const eased = t * t * (3 - 2 * t);
      const radius = from + (to - from) * eased;
      const centreNow = { lat: centreLat, lng: centreLng };
      source?.setData(zonePolygon(centreNow, radius));
      outline?.setData(zoneOutline(centreNow, radius));
      if (t < 1) frame = requestAnimationFrame(step);
      else radiusRef.current = to;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [ready, radiusMetres, centre.lat, centre.lng]);

  // Markers and accuracy circles.
  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource("markers") as GeoJSONSource | undefined;
    const accuracy = map.current.getSource("accuracy") as
      | GeoJSONSource
      | undefined;
    source?.setData(markerCollection(markers));
    accuracy?.setData(accuracyCollection(markers));
  }, [ready, markers]);

  // Short pulse when a ping lands.
  useEffect(() => {
    if (!ready || pulseKey === 0) return;
    const show = setTimeout(() => setPulse(true), 0);
    const hide = setTimeout(() => setPulse(false), 1100);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [ready, pulseKey]);

  return (
    <div className={`relative overflow-hidden rounded-xl border border-hairline ${className ?? "h-80"}`}>
      <div ref={container} className="absolute inset-0" />
      {pulse && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="h-40 w-40 animate-ping rounded-full border-2 border-foreground/30" />
        </div>
      )}
      <p className="pointer-events-none absolute bottom-1 right-2 text-[9px] uppercase tracking-[0.16em] text-foreground/60">
        Zone from rules · OSM
      </p>
    </div>
  );
}
