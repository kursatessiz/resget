import { useMemo } from 'react';
import type { DeliveryTripDTO } from '@resget/shared';
import { MapPanel } from '@/components/map-panel';
import type { MapPin, PinTone } from '@/components/map-panel';
import { useT } from '@/lib/i18n';
import { tripMapModel } from '@/lib/trip-map';
import type { StopMarkerState } from '@/lib/trip-map';

const STOP_TONE: Record<StopMarkerState, PinTone> = {
  current: 'theme',
  upcoming: 'outline',
  done: 'success',
  failed: 'error',
};

/**
 * The trip on a map (docs/MOBIL.md, "Kurye haritası"): pickup point, numbered
 * stops coloured by state, the device's own position and a dashed line
 * through the stops still ahead. The line is straight, not the road; the
 * stop's directions button hands the road to the phone's maps app.
 */
export function TripMap({ trip }: { trip: DeliveryTripDTO }) {
  const t = useT();
  const model = useMemo(() => tripMapModel(trip), [trip]);
  const pins = useMemo<MapPin[]>(
    () => [
      ...(model.pickup
        ? [
            {
              id: 'pickup',
              point: model.pickup,
              title: t('mobile.courier.map.pickup'),
              tone: 'ink' as const,
              shape: 'square' as const,
            },
          ]
        : []),
      ...model.markers.map((marker) => ({
        id: marker.stopId,
        point: marker.point,
        title: t('mobile.courier.stop', { sequence: marker.sequence, code: marker.orderShortCode }),
        description: t(`mobile.courier.map.state.${marker.state}`),
        text: String(marker.sequence),
        tone: STOP_TONE[marker.state],
      })),
    ],
    [model, t],
  );
  return (
    <MapPanel
      pins={pins}
      region={model.region}
      route={model.route}
      showsUserLocation={trip.status === 'ASSIGNED' || trip.status === 'IN_PROGRESS'}
      label={t('mobile.courier.map.label')}
      fitLabel={t('mobile.courier.map.fit')}
    />
  );
}
