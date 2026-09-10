import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface DriverPipState {
  supported: boolean; active: boolean; transitioning: boolean; rotationGrace: boolean;
  visible: boolean; monitoring: boolean; stopReason: string;
}
interface DriverPipPlugin {
  getState(): Promise<DriverPipState>;
  setSession(options: { running: boolean; enabled: boolean }): Promise<DriverPipState>;
  enter(): Promise<DriverPipState>;
  heartbeat(): Promise<void>;
  addListener(event: "stateChanged", listener: (state: DriverPipState) => void): Promise<PluginListenerHandle>;
}
const native = registerPlugin<DriverPipPlugin>("DriverPip");
export const isNativeDriverPip = () => Capacitor.getPlatform() === "android";
export const DRIVER_PIP_STORAGE_KEY = "driver-pip-enabled.v1";
export const EMPTY_PIP_STATE: DriverPipState = { supported: false, active: false, transitioning: false, rotationGrace: false, visible: true, monitoring: false, stopReason: "" };
export const driverPip = native;
export function keepsPipCamera(state: DriverPipState): boolean {
  return state.supported && state.monitoring && state.visible && (state.active || state.transitioning);
}
