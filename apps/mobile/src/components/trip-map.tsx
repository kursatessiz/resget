import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, PROVIDER_GOOGLE, Polyline } from 'react-native-maps';
import type { DeliveryTripDTO } from '@resget/shared';
import { Button } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { inAppMapAvailable, tripMapModel } from '@/lib/trip-map';
import type { MapRegion, StopMarkerState } from '@/lib/trip-map';
import { useTheme } from '@/theme';
import type { Theme } from '@/theme';

const MAP_HEIGHT = 280;

/** Set by app.config.ts from the build environment; the key itself never reaches the bundle's code. */
function androidKeyConfigured(): boolean {
  const extra = Constants.expoConfig?.extra as { androidMapsKeyConfigured?: boolean } | undefined;
  return extra?.androidMapsKeyConfigured === true;
}

/** Whether this build can draw the map: always on iOS (Apple Maps), on Android only with a Google Maps key. */
export function useInAppMap(): boolean {
  return inAppMapAvailable(Platform.OS, androidKeyConfigured());
}

function markerColors(theme: Theme, state: StopMarkerState): { fill: string; text: string; border: string } {
  switch (state) {
    case 'current':
      return { fill: theme.colors.theme, text: theme.colors.onTheme, border: theme.colors.theme };
    case 'done':
      return { fill: theme.colors.success, text: theme.colors.onTheme, border: theme.colors.success };
    case 'failed':
      return { fill: theme.colors.error, text: theme.colors.onTheme, border: theme.colors.error };
    default:
      return { fill: theme.colors.surface, text: theme.colors.text, border: theme.colors.theme };
  }
}

/**
 * The trip on a map (docs/MOBIL.md, "Kurye haritası"): pickup point, numbered
 * stops coloured by state, the device's own position and a dashed line
 * through the stops still ahead. The line is straight, not the road; the
 * stop's directions button hands the road to the phone's maps app.
 */
export function TripMap({ trip }: { trip: DeliveryTripDTO }) {
  const t = useT();
  const theme = useTheme();
  const map = useRef<MapView>(null);
  const model = useMemo(() => tripMapModel(trip), [trip]);
  const [initial, setInitial] = useState<MapRegion | null>(model.region);
  useEffect(() => {
    if (!initial && model.region) setInitial(model.region);
  }, [initial, model.region]);
  if (!initial) return null;
  const onRoad = trip.status === 'ASSIGNED' || trip.status === 'IN_PROGRESS';

  return (
    <View style={{ gap: theme.spacing[2] }}>
      <View
        style={{
          height: MAP_HEIGHT,
          borderRadius: theme.radii.md,
          borderColor: theme.colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          overflow: 'hidden',
        }}
      >
        <MapView
          ref={map}
          style={StyleSheet.absoluteFill}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          initialRegion={initial}
          showsUserLocation={onRoad}
          showsMyLocationButton={false}
          toolbarEnabled={false}
          accessibilityLabel={t('mobile.courier.map.label')}
        >
          {model.route.length > 1 && (
            <Polyline
              coordinates={model.route.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
              strokeColor={theme.colors.theme}
              strokeWidth={4}
              lineDashPattern={[10, 8]}
            />
          )}
          {model.pickup && (
            <Marker
              coordinate={{ latitude: model.pickup.lat, longitude: model.pickup.lng }}
              title={t('mobile.courier.map.pickup')}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: theme.radii.sm,
                  backgroundColor: theme.colors.text,
                  borderColor: theme.colors.surface,
                  borderWidth: 2,
                }}
              />
            </Marker>
          )}
          {model.markers.map((marker) => {
            const colors = markerColors(theme, marker.state);
            return (
              <Marker
                // The key carries the state so a marker redraws when its stop changes (views are not tracked).
                key={`${marker.stopId}-${marker.state}`}
                coordinate={{ latitude: marker.point.lat, longitude: marker.point.lng }}
                title={t('mobile.courier.stop', { sequence: marker.sequence, code: marker.orderShortCode })}
                description={t(`mobile.courier.map.state.${marker.state}`)}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
              >
                <View
                  style={{
                    minWidth: 28,
                    height: 28,
                    borderRadius: 14,
                    paddingHorizontal: theme.spacing[1],
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.fill,
                    borderColor: colors.border,
                    borderWidth: 2,
                  }}
                >
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: theme.typography.size.sm,
                      fontWeight: theme.typography.weight.bold,
                    }}
                  >
                    {marker.sequence}
                  </Text>
                </View>
              </Marker>
            );
          })}
        </MapView>
      </View>
      {model.region && (
        <Button
          label={t('mobile.courier.map.fit')}
          variant="outline"
          tone="muted"
          onPress={() => model.region && map.current?.animateToRegion(model.region, 400)}
        />
      )}
    </View>
  );
}
