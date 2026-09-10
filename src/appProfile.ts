export type AppVariant = "jolbang" | "yeolgong";
export type AppModule = "HOME" | "DROWSINESS" | "STUDY" | "POSTURE" | "MEDITATION" | "SIGN" | "WIDGET";
export function getAppProfile(variant: string) {
  if (variant === "jolbang") return { variant, name: "Wake Drive", appId: "com.hjsolution.jolbang", module: "DROWSINESS", description: "눈 감김과 고개 움직임을 살피는 운전 보조 앱", color: "#14121d" } as const;
  if (variant === "yeolgong") return { variant, name: "열공", appId: "com.hjsolution.yeolgong", module: "STUDY", description: "집중과 휴식을 관리하고 학습 기록을 쌓는 열공 앱", color: "#254ba1" } as const;
  throw new Error(`Unknown app variant: ${variant}`);
}
export const APP = getAppProfile(import.meta.env.VITE_APP_VARIANT ?? "jolbang");
export function isAllowedModule(variant: AppVariant, module: string): boolean {
  return module === "HOME" || module === getAppProfile(variant).module;
}
export function resolveInitialModule(variant: AppVariant, query: string, saved: string | null): AppModule {
  const requested = new URLSearchParams(query).get("mode")?.toUpperCase();
  const candidate = requested === "STUDY" ? "STUDY" : requested === "DROWSINESS" ? "DROWSINESS" : saved;
  return candidate && isAllowedModule(variant, candidate) ? candidate as AppModule : "HOME";
}
