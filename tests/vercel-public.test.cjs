const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'public');
const {paths}=require('../offline-assets.js');
if(fs.existsSync(out))throw Error('Run this test in a clean checkout');
try{
  execFileSync(process.execPath,[path.join(root,'scripts/prepare_vercel_public.js')],{stdio:'inherit'});
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.relative(out,path.join(dir,e.name)).split(path.sep).join('/')]);
  const expected=[...new Set([...paths,'/offline-assets.js','/sw.js'])].map(p=>p.slice(1)).sort();
  assert.deepEqual(walk(out).sort(),expected);
  for(const p of expected)assert.deepEqual(fs.readFileSync(path.join(out,p)),fs.readFileSync(path.join(root,p)));
  for(const p of ['.env','server.py','database','admin-src','api'])assert.equal(fs.existsSync(path.join(out,p)),false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8')).outputDirectory,'public');
  console.log('Vercel static allowlist verified.');
}finally{fs.rmSync(out,{recursive:true,force:true});}
