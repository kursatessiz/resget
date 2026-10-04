'use client';

import { useEffect } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapMarker, MapTilesConfig } from '@/lib/map';

const MARKER_RADIUS: Record<MapMarker['kind'], number> = {
  courier: 9,
  destination: 8,
  stop: 7,
  'stop-done': 6,
  'stop-active': 8,
};

/** Keeps every marker in view as positions stream in; a single marker gets a street-level zoom. */
function FitBounds({ markers }: { markers: MapMarker[] }) {
  const map = useMap();
  useEffect(() => {
    if (markers.length === 0) return;
    if (markers.length === 1) {
      map.setView([markers[0].lat, markers[0].lng], 15);
      return;
    }
    map.fitBounds(
      markers.map((m) => [m.lat, m.lng] as [number, number]),
      { padding: [24, 24], maxZoom: 16 },
    );
  }, [map, markers]);
  return null;
}

/**
 * The one map of the product (docs/SIPARIS_VE_SEVK.md): circle markers and an
 * optional path over configurable tiles. Rendered only in the browser; the
 * server passes the tile config. Colours come from globals.css classes.
 */
export default function MapView({
  tiles,
  markers,
  path,
  label,
  height = 280,
}: {
  tiles: MapTilesConfig;
  markers: MapMarker[];
  path?: [number, number][];
  label: string;
  height?: number;
}) {
  const first = markers[0];
  return (
    <div role="region" aria-label={label} data-map="true" className="map-frame" style={{ height }}>
      <MapContainer
        center={first ? [first.lat, first.lng] : [0, 0]}
        zoom={first ? 15 : 2}
        scrollWheelZoom={false}
        attributionControl
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer url={tiles.url} attribution={tiles.attribution} maxZoom={tiles.maxZoom} />
        {path && path.length > 1 && <Polyline positions={path} pathOptions={{ className: 'map-path' }} />}
        {markers.map((m) => (
          <CircleMarker
            key={m.id}
            center={[m.lat, m.lng]}
            radius={MARKER_RADIUS[m.kind]}
            pathOptions={{ className: `map-marker map-marker-${m.kind}` }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              {m.label}
            </Tooltip>
          </CircleMarker>
        ))}
        <FitBounds markers={markers} />
      </MapContainer>
    </div>
  );
}
