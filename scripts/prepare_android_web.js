const fs=require('node:fs');
const path=require('node:path');
const {paths}=require('../offline-assets.js');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'android-apk','www-bundled');
if(!output.startsWith(path.join(root,'android-apk')+path.sep))throw Error('Unsafe output path');
fs.rmSync(output,{recursive:true,force:true});
for(const url of paths){
  const relative=url.replace(/^\//,'');
  if(relative.includes('..')||relative.startsWith('api/')||relative.startsWith('.'))throw Error('Unsafe web asset '+url);
  const source=path.join(root,relative),dest=path.join(output,relative);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.copyFileSync(source,dest);
}
const index=path.join(output,'index.html');
let html=fs.readFileSync(index,'utf8');
if(!html.includes('<head>'))throw Error('Missing index head');
const commit=process.env.GITHUB_SHA||'local-build';
if(!/^(?:[a-f0-9]{40}|local-build)$/.test(commit))throw Error('Invalid build commit');
html=html.replace('<head>','<head>\n<script>window.LoloNativeBundled=true;window.LoloBuildCommit='+JSON.stringify(commit)+';</script>');
fs.writeFileSync(index,html);
console.log('Bundled '+paths.length+' public offline assets; no API code or secrets.');
