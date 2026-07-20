import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.hjsolution.suha.driver",
  appName: "졸음운전",
  webDir: "dist/client",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#07110f",
  },
  ios: {
    backgroundColor: "#07110f",
  },
};

export default config;
