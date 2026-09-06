export interface MapProvider {
  id: string
  label: string
  styleUrl: string
  attribution: string
  productionReady: boolean
}

const configuredStyle = import.meta.env.VITE_MAP_STYLE_URL?.trim()
const openFreeMapStyle = 'https://tiles.openfreemap.org/styles/bright'
const selectedStyle = configuredStyle || openFreeMapStyle

export const activeMapProvider: MapProvider = {
  id: selectedStyle === openFreeMapStyle ? 'openfreemap' : 'configured',
  label: selectedStyle === openFreeMapStyle ? 'OpenFreeMap Bright' : '설정된 지도',
  styleUrl: selectedStyle,
  attribution: import.meta.env.VITE_MAP_ATTRIBUTION || 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
  productionReady: true,
}
