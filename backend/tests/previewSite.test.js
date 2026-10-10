const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express'),path=require('node:path');
const previewSite=require('../utils/previewSite');
test('预览根地址和深层页面返回网页，API仍返回JSON',async()=>{
  const api=express();api.get('/',(_q,r)=>r.json({status:'running'}));api.get('/api/test',(_q,r)=>r.json({ok:true}));
  // Source index is sufficient for routing checks; browser tests cover built assets.
  const site=previewSite(api,path.resolve(__dirname,'../../frontend'));
  const server=await new Promise(resolve=>{const s=site.listen(0,'127.0.0.1',()=>resolve(s))});
  const base='http://127.0.0.1:'+server.address().port;
  try{
    for(const route of ['/','/admin-login','/admin-discipline']){const res=await fetch(base+route);assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/text\/html/);assert.match(await res.text(),/<div id="app"><\/div>/);}
    const response=await fetch(base+'/api/test');assert.deepEqual(await response.json(),{ok:true});
    assert.equal((await fetch(base+'/api/missing')).status,404);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
