import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [action, selection]=process.argv.slice(2);
if (!['build','android'].includes(action) || !['jolbang','yeolgong','all'].includes(selection)) throw new Error('Usage: node scripts/app.mjs build|android jolbang|yeolgong|all');
const variants=selection==='all'?['jolbang','yeolgong']:[selection];
function runNode(script,args=[],env=process.env) {
 const r=spawnSync(process.execPath,[path.join(root,script),...args],{cwd:root,env,stdio:'inherit'});
 if(r.error || r.status!==0) throw new Error(r.error?.message??`${script} failed (${r.status})`);
}
runNode('node_modules/typescript/bin/tsc',['--noEmit']);
runNode('scripts/branding.mjs',[selection]);
for(const variant of variants) {
 runNode('node_modules/vite/bin/vite.js',['build','--mode',variant]);
 if(action!=='android') continue;
 const env={...process.env,APP_VARIANT:variant};
 runNode('node_modules/@capacitor/cli/bin/capacitor',['sync','android'],env);
 const nativeRoot=path.join(root,'native',variant,'android');
 const result=spawnSync(process.platform==='win32'?'gradlew.bat':'./gradlew',['assembleDebug','--console=plain'],{cwd:nativeRoot,env,stdio:'inherit',shell:process.platform==='win32'});
 if(result.error || result.status!==0) throw new Error(result.error?.message??`Android build failed (${result.status})`);
 fs.mkdirSync(path.join(root,'releases'),{recursive:true});
 fs.copyFileSync(path.join(nativeRoot,'app/build/outputs/apk/debug/app-debug.apk'),path.join(root,'releases',`${variant}-debug.apk`));
 if(variant==='jolbang') fs.copyFileSync(path.join(root,'releases','jolbang-debug.apk'),path.join(root,'releases','wake-drive-debug.apk'));
}
