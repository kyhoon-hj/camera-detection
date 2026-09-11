import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [action, selection]=process.argv.slice(2);
if (!['build','android','bundle'].includes(action) || selection!=='jolbang') throw new Error('Usage: node scripts/app.mjs build|android|bundle jolbang');
if (action==='bundle') {
 const signingNames=['WAKE_UPLOAD_STORE_FILE','WAKE_UPLOAD_KEY_ALIAS','WAKE_UPLOAD_STORE_PASSWORD','WAKE_UPLOAD_KEY_PASSWORD'];
 if (signingNames.some(name=>!process.env[name]?.trim())) throw new Error('Release signing is not configured. Set all four WAKE_UPLOAD_* environment variables.');
 if (!path.isAbsolute(process.env.WAKE_UPLOAD_STORE_FILE) || !fs.statSync(process.env.WAKE_UPLOAD_STORE_FILE).isFile()) throw new Error('WAKE_UPLOAD_STORE_FILE must be an absolute path to the upload keystore.');
}
const variants=[selection];
function runNode(script,args=[],env=process.env) {
 const r=spawnSync(process.execPath,[path.join(root,script),...args],{cwd:root,env,stdio:'inherit'});
 if(r.error || r.status!==0) throw new Error(r.error?.message??`${script} failed (${r.status})`);
}
runNode('node_modules/typescript/bin/tsc',['--noEmit']);
runNode('scripts/branding.mjs',[selection]);
for(const variant of variants) {
 runNode('node_modules/vite/bin/vite.js',['build','--mode',variant]);
 if(action==='build') continue;
 const env={...process.env,APP_VARIANT:variant};
 runNode('node_modules/@capacitor/cli/bin/capacitor',['sync','android'],env);
 const nativeRoot=path.join(root,'native',variant,'android');
 const result=spawnSync(process.platform==='win32'?'gradlew.bat':'./gradlew',[action==='bundle'?'bundleRelease':'assembleDebug','--console=plain','--max-workers=2','--no-daemon'],{cwd:nativeRoot,env,stdio:'inherit',shell:process.platform==='win32'});
 if(result.error || result.status!==0) throw new Error(result.error?.message??`Android build failed (${result.status})`);
 fs.mkdirSync(path.join(root,'releases'),{recursive:true});
 if(action==='bundle') {
  fs.copyFileSync(path.join(nativeRoot,'app/build/outputs/bundle/release/app-release.aab'),path.join(root,'releases','wake-drive-release.aab'));
  continue;
 }
 fs.copyFileSync(path.join(nativeRoot,'app/build/outputs/apk/debug/app-debug.apk'),path.join(root,'releases',`${variant}-debug.apk`));
 if(variant==='jolbang') fs.copyFileSync(path.join(root,'releases','jolbang-debug.apk'),path.join(root,'releases','wake-drive-debug.apk'));
}
