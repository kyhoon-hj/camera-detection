import { spawnSync } from 'node:child_process';
const r=spawnSync(process.execPath,['node_modules/@capacitor/cli/bin/capacitor','sync','android'],{env:{...process.env,APP_VARIANT:'jolbang'},stdio:'inherit'});
if(r.error) throw r.error;
process.exit(r.status??1);
