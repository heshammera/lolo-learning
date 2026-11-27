const {test}=require('node:test');
const assert=require('node:assert/strict');
const library=require('../admin-src/activity-library.cjs');
const assets=require('../offline-assets.js');
const {html}=require('../scripts/preview-activity-library.js');
test('library accurately covers every runtime and planned contract',()=>{
  assert.deepEqual(library.audit(),{valid:true,errors:[],implemented:26,planned:3});
  assert.equal(library.query({offline:true}).length,26);
  assert.equal(library.query({category:'science',status:'implemented'}).length,1);
  assert.equal(library.query({search:'النطق'}).some(e=>e.id==='phoneme-score'),true);
  assert.equal(library.query({target:{choice:[2]}}).filter(e=>e.compatibility==='compatible').length,0);
  assert.equal(library.query({target:{choice:[1]}}).filter(e=>e.compatibility==='compatible').length,1);
  assert.equal(library.query({status:'planned'}).every(e=>!e.example&&e.offline===null&&e.versions.length===0),true);
});
test('templates are independent copies and admin source is not bundled',()=>{
  const first=library.catalog().find(e=>e.id==='choice');first.example.config.answer='bad';
  assert.equal(library.audit().valid,true);
  assert.equal(assets.paths.some(p=>p.includes('admin-src')||p.includes('preview-activity-library')),false);
  const page=html();assert.match(page,/Activity Library/);assert.match(page,/معاينة النشاط/);
  assert.doesNotMatch(page,/<script[^>]+src=/);
});
