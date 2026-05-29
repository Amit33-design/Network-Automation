import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId:       'ai.netdesign.app',
  appName:     'NetDesign AI',
  webDir:      'www',
  server: {
    // Allow mixed content for self-hosted backend URLs
    cleartext: true,
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration:  2000,
      backgroundColor:     '#0f172a',
      androidSplashResourceName: 'splash',
      showSpinner:         false,
    },
    StatusBar: {
      style:           'dark',
      backgroundColor: '#0f172a',
    },
  },
  android: {
    allowMixedContent: true,
    backgroundColor:   '#0f172a',
  },
  ios: {
    backgroundColor:  '#0f172a',
    contentInset:     'automatic',
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
