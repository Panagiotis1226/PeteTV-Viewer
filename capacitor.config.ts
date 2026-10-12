import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.petetv.viewer',
  appName: 'PeteTV',
  webDir: 'dist',
  android: {
    // Channel logos / posters are frequently plain http.
    allowMixedContent: true,
    backgroundColor: '#0b0f17',
  },
};

export default config;
