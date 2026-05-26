import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.netdesignai.app',
  appName: 'NetDesign AI',
  webDir: 'dist',
  server: {
    // Dev: set androidScheme to https for Capacitor HTTP plugin compatibility
    androidScheme: 'https',
  },
  plugins: {
    // @capacitor/preferences — native key-value storage supplement to localStorage
    Preferences: {
      group: 'NDALIntentStore',
    },
    // @capacitor/share — used by topology PNG export (sharing via iOS/Android share sheet)
    Share: {},
    // @capacitor/network — used to detect offline state and show cached topology warning
    Network: {},
  },
};

export default config;
