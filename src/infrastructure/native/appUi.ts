import { Capacitor, registerPlugin } from '@capacitor/core'

interface AppUiPlugin {
  setOrientation(options: { mode: 'PORTRAIT' | 'FLEXIBLE' }): Promise<void>
  exitApp(): Promise<void>
}

const AppUi = registerPlugin<AppUiPlugin>('AppUi')

export const setRoleOrientation = async (flexible: boolean) => {
  if (!Capacitor.isNativePlatform()) return
  await AppUi.setOrientation({ mode: flexible ? 'FLEXIBLE' : 'PORTRAIT' })
}

export const exitNativeApp = async () => {
  if (Capacitor.isNativePlatform()) await AppUi.exitApp()
}
