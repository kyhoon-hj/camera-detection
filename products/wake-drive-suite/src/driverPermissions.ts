import { Capacitor, registerPlugin } from "@capacitor/core";
export const nativeDriverPermissions = Capacitor.getPlatform() === "android";
export const driverPermissions = registerPlugin<{
  getLanguage(): Promise<{selected: 'ko' | 'en' | null; device:string}>;
  setLanguage(options:{language:'ko'|'en'}): Promise<void>;
  getStatus(): Promise<{ camera:boolean; pip:boolean; pipSupported:boolean }>;
  ensure(options:{feature:"camera"|"pip"}): Promise<{allowed:boolean}>;
  configure(options:{pip:boolean}): Promise<void>;
  openSettings(options:{target:"app"|"pip"|"privacy"}): Promise<void>;
  showOverview(): Promise<void>;
}>("DriverPermissions");

export async function withStartupTimeout<T>(work: Promise<T>, milliseconds:number, message:string):Promise<T> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try { return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),milliseconds);})]); }
  finally { clearTimeout(timer); }
}
