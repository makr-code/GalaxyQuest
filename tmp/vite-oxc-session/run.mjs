import { build } from 'vite';
import viteConfig from '../../vite.config.mjs';
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path'; import { gzipSync } from 'node:zlib';
const root=process.cwd(), base=path.join(root,'tmp','vite-oxc-session');
const variants=[
 {name:'baseline', patch:{}},
 {name:'passes-2', patch:{minify:{compress:{passes:2}}}},
 {name:'passes-3', patch:{minify:{compress:{passes:3}}}},
 {name:'compress-true', patch:{minify:{compress:true}}},
];
function mergeOutput(c, patch){const b={...c.build, outDir:path.join(base,patch.name), emptyOutDir:true}; b.rollupOptions={...c.build.rollupOptions, output:{...c.build.rollupOptions?.output,...(patch.patch.minify===undefined?{}:{minify:patch.patch.minify})}}; return {...c, configFile:false, root, build:b, logLevel:'warn'};}
for(const v of variants){const dir=path.join(base,v.name); await rm(dir,{recursive:true,force:true}); const c=await viteConfig({mode:'production'}); let warns=[]; const oldWarn=console.warn; console.warn=(...x)=>{warns.push(x.join(' '));oldWarn(...x)}; let ok=true, err=''; try {await build(mergeOutput(c,v));} catch(e){ok=false;err=e?.message||String(e)} console.warn=oldWarn; if(!ok){console.log(JSON.stringify({name:v.name,ok,error:err,warnings:warns.length}));continue} let files=[]; async function walk(x){for(const e of await readdir(x,{withFileTypes:true})){const p=path.join(x,e.name);if(e.isDirectory())await walk(p);else if(/\.js$/.test(e.name)){const b=await readFile(p);files.push({file:path.relative(dir,p),raw:b.length,gzip:gzipSync(b,{level:9}).length})}}} await walk(dir); const total=files.reduce((a,x)=>a+x.gzip,0); const initial=files.filter(x=>/^(index|main|core|assets[\\/])/.test(x.file)).reduce((a,x)=>a+x.gzip,0); console.log(JSON.stringify({name:v.name,ok,warnings:warns.length,totalGzip:total,initialGzip:initial,largestRaw:Math.max(...files.map(x=>x.raw)),jsFiles:files.length,largest:files.sort((a,b)=>b.raw-a.raw).slice(0,3)}));}
