// Explicit reviewed source snapshot: Vercel root is self-contained; CI rejects drift.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const copies=[["admin-src/admin_identity.py","runtime/admin-src/admin_identity.py"],["family_accounts.py","runtime/family_accounts.py"],["admin-src/cms_drafts.py","runtime/admin-src/cms_drafts.py"],["activity-engine.js","runtime/activity-engine.js"],["content-schema.js","runtime/content-schema.js"],["activity-pilot.js","runtime/activity-pilot.js"],["admin-src/activity-library.cjs","runtime/admin-src/activity-library.cjs"],["admin-src/web/index.html","web/index.html"],["admin-src/web/admin.js","web/admin.js"],["admin-src/web/admin.css","web/admin.css"],["admin-src/web/cms-editor.js","web/cms-editor.js"]];
for(const [from,to] of copies){
 let data=fs.readFileSync(path.join(root,from),'utf8');
 if(from==='family_accounts.py')data=data.split('\nclass FamilyStore:')[0].replace('from progress_sync import InvalidProgress, uuid_value, validate_write\n','');
 if(from==='admin-src/cms_drafts.py')data=data.slice(0,data.indexOf('def validate(content):'))+'from hosted_validator import validate\n'+data.slice(data.indexOf('\ndef draft_id(value):'));
 const dest=path.join(__dirname,to);
 if(process.argv.includes('--check')){if(!fs.existsSync(dest)||fs.readFileSync(dest,'utf8')!==data)throw Error('Admin snapshot drift: '+from);}
 else{fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,data);}
}
console.log('LOLO_ADMIN_SNAPSHOT=PASS');
