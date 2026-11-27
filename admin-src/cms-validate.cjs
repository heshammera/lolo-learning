const {validate}=require('../content-schema.js');
if(require.main===module){
  try{const raw=require('node:fs').readFileSync(0,'utf8');if(Buffer.byteLength(raw)>262144)throw Error('size');process.stdout.write(JSON.stringify(validate(JSON.parse(raw))));}
  catch{process.stdout.write(JSON.stringify({valid:false,issues:[{code:'INVALID_JSON',path:'$'}]}));}
}
module.exports={validate};
