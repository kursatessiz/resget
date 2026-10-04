'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type MapView from './MapView';

/** Leaflet touches `window`, so the map is loaded in the browser only; the server renders the frame. */
export const LiveMap = dynamic<ComponentProps<typeof MapView>>(() => import('./MapView'), {
  ssr: false,
  loading: () => <div className="map-frame" data-map="loading" style={{ height: 280 }} aria-hidden="true" />,
});
