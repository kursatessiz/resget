import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, PROVIDER_GOOGLE, Polyline } from 'react-native-maps';
import type { GeoPoint } from '@resget/shared';
import { Button } from '@/components/ui';
import { inAppMapAvailable } from '@/lib/maps';
import type { MapRegion } from '@/lib/maps';
import { useTheme } from '@/theme';
import type { Theme } from '@/theme';

const DEFAULT_HEIGHT = 280;

/** Set by app.config.ts from the build environment; the key itself never reaches the bundle's code. */
function androidKeyConfigured(): boolean {
  const extra = Constants.expoConfig?.extra as { androidMapsKeyConfigured?: boolean } | undefined;
  return extra?.androidMapsKeyConfigured === true;
}

/** Whether this build can draw maps: always on iOS (Apple Maps), on Android only with a Google Maps key. */
export function useInAppMap(): boolean {
  return inAppMapAvailable(Platform.OS, androidKeyConfigured());
}

/** Colour roles from the kit: filled theme, theme outline, success, error, or ink (text colour). */
export type PinTone = 'theme' | 'outline' | 'success' | 'error' | 'ink';

export interface MapPin {
  /** Stable id; include anything that changes the pin's look, since pin views are not re-tracked. */
  id: string;
  point: GeoPoint;
  title: string;
  description?: string;
  /** Short text inside the pin (a stop number, an initial). */
  text?: string;
  tone: PinTone;
  shape?: 'circle' | 'square';
}

function pinColors(theme: Theme, tone: PinTone): { fill: string; text: string; border: string } {
  switch (tone) {
    case 'theme':
      return { fill: theme.colors.theme, text: theme.colors.onTheme, border: theme.colors.theme };
    case 'success':
      return { fill: theme.colors.success, text: theme.colors.onTheme, border: theme.colors.success };
    case 'error':
      return { fill: theme.colors.error, text: theme.colors.onTheme, border: theme.colors.error };
    case 'ink':
      return { fill: theme.colors.text, text: theme.colors.surface, border: theme.colors.surface };
    default:
      return { fill: theme.colors.surface, text: theme.colors.text, border: theme.colors.theme };
  }
}

/**
 * One native map for every screen (docs/MOBIL.md, "Haritalar"): pins in the
 * kit's colour roles, an optional dashed line, the device's own position on
 * request and a button that brings every point back into view. The region is
 * set once; later refreshes move the pins but never the view the person
 * panned to.
 */
export function MapPanel({
  pins,
  region,
  label,
  fitLabel,
  route = [],
  showsUserLocation = false,
  height = DEFAULT_HEIGHT,
}: {
  pins: MapPin[];
  region: MapRegion | null;
  label: string;
  fitLabel: string;
  route?: GeoPoint[];
  showsUserLocation?: boolean;
  height?: number;
}) {
  const theme = useTheme();
  const map = useRef<MapView>(null);
  const [initial, setInitial] = useState<MapRegion | null>(region);
  useEffect(() => {
    if (!initial && region) setInitial(region);
  }, [initial, region]);
  if (!initial) return null;

  return (
    <View style={{ gap: theme.spacing[2] }}>
      <View
        style={{
          height,
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
          showsUserLocation={showsUserLocation}
          showsMyLocationButton={false}
          toolbarEnabled={false}
          accessibilityLabel={label}
        >
          {route.length > 1 && (
            <Polyline
              coordinates={route.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
              strokeColor={theme.colors.theme}
              strokeWidth={4}
              lineDashPattern={[10, 8]}
            />
          )}
          {pins.map((pin) => {
            const colors = pinColors(theme, pin.tone);
            const square = pin.shape === 'square';
            return (
              <Marker
                key={`${pin.id}-${pin.tone}-${pin.text ?? ''}`}
                coordinate={{ latitude: pin.point.lat, longitude: pin.point.lng }}
                title={pin.title}
                description={pin.description}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
              >
                <View
                  style={{
                    minWidth: pin.text ? 28 : 22,
                    height: pin.text ? 28 : 22,
                    borderRadius: square ? theme.radii.sm : 14,
                    paddingHorizontal: pin.text ? theme.spacing[1] : 0,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.fill,
                    borderColor: colors.border,
                    borderWidth: 2,
                  }}
                >
                  {pin.text ? (
                    <Text
                      style={{
                        color: colors.text,
                        fontSize: theme.typography.size.sm,
                        fontWeight: theme.typography.weight.bold,
                      }}
                    >
                      {pin.text}
                    </Text>
                  ) : null}
                </View>
              </Marker>
            );
          })}
        </MapView>
      </View>
      {region && (
        <Button
          label={fitLabel}
          variant="outline"
          tone="muted"
          onPress={() => map.current?.animateToRegion(region, 400)}
        />
      )}
    </View>
  );
}
