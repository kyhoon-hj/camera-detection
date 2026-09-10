import { Capacitor, registerPlugin } from "@capacitor/core";
export const nativeDriverPermissions = Capacitor.getPlatform() === "android";
export const driverPermissions = registerPlugin<{
  getStatus(): Promise<{ camera:boolean; location:boolean; locationEnabled:boolean; pip:boolean; pipSupported:boolean }>;
  ensure(options:{feature:"camera"|"location"|"pip"}): Promise<{allowed:boolean}>;
  configure(options:{location:boolean;pip:boolean}): Promise<void>;
  openSettings(options:{target:"app"|"locationService"|"pip"|"privacy"}): Promise<void>;
  showOverview(): Promise<void>;
}>("DriverPermissions");

export async function withStartupTimeout<T>(work: Promise<T>, milliseconds:number, message:string):Promise<T> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try { return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),milliseconds);})]); }
  finally { clearTimeout(timer); }
}
