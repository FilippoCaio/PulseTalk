import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'it.filippocaio.pulsetalk',
  appName: 'PulseTalk',
  webDir: 'dist/android',
  android: {
    // L'interfaccia e' scura: evita il lampo bianco mentre nasce la WebView.
    backgroundColor: '#0b0e14',
    allowMixedContent: false
  },
  server: {
    androidScheme: 'https'
  }
}

export default config
