export interface MapProvider {
  id: string
  label: string
  styleUrl: string
  attribution: string
  productionReady: boolean
}

export const activeMapProvider: MapProvider = {
  id: import.meta.env.VITE_MAP_STYLE_URL ? 'configured' : 'maplibre-demo',
  label: import.meta.env.VITE_MAP_STYLE_URL ? '설정된 지도' : 'MapLibre 데모 지도',
  styleUrl: import.meta.env.VITE_MAP_STYLE_URL || 'https://demotiles.maplibre.org/style.json',
  attribution: import.meta.env.VITE_MAP_ATTRIBUTION || 'MapLibre demo tiles',
  productionReady: Boolean(import.meta.env.VITE_MAP_STYLE_URL),
}
