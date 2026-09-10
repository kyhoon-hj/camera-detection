import type { CapacitorConfig } from "@capacitor/cli";
const variant = process.env.APP_VARIANT;
if (variant !== "jolbang" && variant !== "yeolgong") throw new Error("APP_VARIANT must be jolbang or yeolgong");
const config: CapacitorConfig = {
  appId: `com.hjsolution.${variant}`,
  appName: variant === "jolbang" ? "Wake Drive" : "열공",
  webDir: `dist/${variant}`,
  server: { androidScheme: "https" },
  android: { path: `native/${variant}/android`, allowMixedContent: false, backgroundColor: "#07110f" },
};
export default config;
