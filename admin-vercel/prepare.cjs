// Deploy the dedicated admin shell only. No student app or database files in public.
const fs=require('node:fs'),path=require('node:path');
const out=path.join(__dirname,'public');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);
for(const name of ['index.html','admin.js','admin.css','cms-editor.js']){
 let source=fs.readFileSync(path.join(__dirname,'web',name),'utf8');
 if(name==='index.html')source=source.replace('بيئة اختبار محلية','بيئة إدارة محمية — Vercel');
 fs.writeFileSync(path.join(out,name),source);
}
console.log('LOLO_ADMIN_STATIC=PASS: 4 allowlisted assets.');
