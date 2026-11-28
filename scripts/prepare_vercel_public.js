// Build only the explicitly approved browser assets; Python functions stay under api/.
const fs=require('node:fs');
const path=require('node:path');
const {paths}=require('../offline-assets.js');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'public');
const urls=[...new Set([...paths,'/offline-assets.js','/sw.js'])];
if(output!==path.resolve(root,'public'))throw Error('Unsafe static destination');
if(fs.existsSync(output)&&fs.lstatSync(output).isSymbolicLink())throw Error('Unsafe static symlink');
fs.rmSync(output,{recursive:true,force:true});
for(const url of urls){
  if(!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(url)||url.includes('..')||url.startsWith('/api/')||url.startsWith('/database/')||url.startsWith('/admin-src/'))throw Error('Invalid public asset');
  const relative=url.slice(1),source=path.join(root,relative),dest=path.join(output,relative);
  if(!fs.realpathSync(source).startsWith(root+path.sep)||!fs.lstatSync(source).isFile())throw Error('Unsafe source');
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.copyFileSync(source,dest);
}
console.log('LOLO_PUBLIC_BUILD=PASS: '+urls.length+' allowlisted browser assets.');
