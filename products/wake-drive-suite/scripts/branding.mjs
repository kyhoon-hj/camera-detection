import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const selection=process.argv[2]??'all';
for(const [variant,name,color,letter] of [['jolbang','Wake Drive','#292333',''],['yeolgong','열공','#254ba1','열']]) {
 if(selection!=='all'&&selection!==variant) continue;
 const dir=path.join(root,'branding',variant); fs.mkdirSync(dir,{recursive:true});
 const mascot=variant==='jolbang'?fs.readFileSync(path.join(root,'public/brand/wake-drive-mascot.svg'),'utf8').replace(/^<svg[^>]*>/,'').replace(/<\/svg>\s*$/,''):null;
 const mascotIcon=(background=true,round=false)=>`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none">${background?`<rect width="512" height="512" rx="${round?256:112}" fill="${color}"/>`:''}<g transform="${background?'translate(56 72) scale(2.22)':'translate(100 112) scale(1.73)'}">${mascot}</g></svg>`;
 const svg=mascot?mascotIcon():`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${color}"/><text x="256" y="340" text-anchor="middle" font-size="256" font-family="Malgun Gothic, sans-serif" font-weight="700" fill="white">${letter}</text></svg>`;
 const iconInput=Buffer.from(svg);
 fs.writeFileSync(path.join(dir,'icon.svg'),svg);
 for(const [file,size] of [['icon-192.png',192],['icon-512.png',512],['apple-touch-icon.png',180]]) await sharp(iconInput).resize(size,size).png().toFile(path.join(dir,file));
 fs.writeFileSync(path.join(dir,'manifest.webmanifest'),JSON.stringify({name,short_name:name,id:`/${variant}`,start_url:'/',scope:'/',display:'standalone',lang:'ko-KR',background_color:color,theme_color:color,icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'}]},null,2));
 const cache=`${variant}:shell:${Date.now()}`;
 fs.writeFileSync(path.join(dir,'sw.js'),`const CACHE=${JSON.stringify(cache)};
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/','/icon-192.png','/manifest.webmanifest'])));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('${variant}:shell:')&&key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim();});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
event.respondWith(fetch(event.request).then(response=>{if(response.ok&&response.status===200){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request).then(cached=>cached||Response.error())));});
`);
 const res=path.join(root,'native',variant,'android/app/src/main/res');
 for(const [density,size] of [['ldpi',36],['mdpi',48],['hdpi',72],['xhdpi',96],['xxhdpi',144],['xxxhdpi',192]]) {
  if(density==='ldpi'&&variant!=='jolbang') continue;
  const output=path.join(res,`mipmap-${density}`);fs.mkdirSync(output,{recursive:true});
  for(const suffix of ['','_round','_foreground']) {
   const target=suffix==='_foreground'?Math.round(size*2.25):size;
   const input=mascot?Buffer.from(mascotIcon(suffix!=='_foreground',suffix==='_round')):iconInput;
   let icon=sharp(input).resize(target,target);
   await icon.png().toFile(path.join(output,`ic_launcher${suffix}.png`));
  }
  if(mascot) await sharp({create:{width:Math.round(size*2.25),height:Math.round(size*2.25),channels:4,background:color}}).png().toFile(path.join(output,'ic_launcher_background.png'));
 }
 if(mascot) {
  // Generate every existing day/night and portrait/landscape splash from one source.
  const splashSvg=(width,height)=>{
   const unit=Math.min(width,height);
   const markWidth=unit*.42, scale=markWidth/180;
   const x=(width-markWidth)/2,y=height*.45-80*scale;
   return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" fill="none"><rect width="100%" height="100%" fill="${color}"/><g transform="translate(${x} ${y}) scale(${scale})">${mascot}</g><text x="${width/2}" y="${y+160*scale+unit*.085}" text-anchor="middle" font-family="sans-serif" font-size="${unit*.064}" font-weight="600" fill="#f5f0fa">Wake Drive</text><g fill="#d2f000"><circle cx="${width/2-unit*.028}" cy="${height*.76}" r="${unit*.005}"/><circle cx="${width/2}" cy="${height*.76}" r="${unit*.005}"/><circle cx="${width/2+unit*.028}" cy="${height*.76}" r="${unit*.005}"/></g></svg>`;
  };
  for(const folder of fs.readdirSync(res).filter(folder=>folder.startsWith('drawable'))) {
   const file=path.join(res,folder,'splash.png');
   if(!fs.existsSync(file)) continue;
   const {width,height}=await sharp(file).metadata();
   const output=await sharp(Buffer.from(splashSvg(width,height))).png().toBuffer();
   fs.writeFileSync(file,output);
  }
  fs.writeFileSync(path.join(dir,'splash.svg'),splashSvg(1080,1920));
  await sharp(Buffer.from(splashSvg(1080,1920))).png().toFile(path.join(dir,'splash.png'));
 }
}
