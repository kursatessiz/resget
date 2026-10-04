/**
 * Map tiles are a deployment choice, not code: the URL template and the
 * attribution come from the web server's environment at request time and
 * reach the browser as props, so switching to a paid provider is a config
 * change and nothing is baked into the image. OpenStreetMap's public tiles
 * are the default for development and small deployments (their usage
 * policy applies); production points MAP_TILE_URL at a tile provider.
 */
export interface MapTilesConfig {
  url: string;
  attribution: string;
  maxZoom: number;
}

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  /** Styled through globals.css (.map-marker-<kind>); no colour lives in TSX. */
  kind: 'courier' | 'destination' | 'stop' | 'stop-done' | 'stop-active';
}
