const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {definitions,parseArguments,image}=require('../scripts/playerDemoData');
const {assertAuthorized,outputPath}=require('../scripts/playerDemo');
test('球员追加生成器明确参数，默认小规模，无删除/重置模式',()=>{
  assert.equal(parseArguments(['plan','--batch=try-01','--admin-id=1']).size,'small');
  for(const args of [['clear'],['append','--batch=a;rm','--admin-id=1'],['append','--batch=demo','--admin-id=0'],['append','--batch=demo','--admin-id=1','--size=huge']])assert.throws(()=>parseArguments(args));
});
test('生成器生产授权独立、凭据不得进入两个前端或上传目录',()=>{
  assert.throws(()=>assertAuthorized({NODE_ENV:'production',PLAYER_DEMO_CONFIRM:'APPEND_test'},'test'));
  assert.doesNotThrow(()=>assertAuthorized({NODE_ENV:'production',PLAYER_DEMO_CONFIRM:'APPEND_test',PLAYER_DEMO_ALLOW_PRODUCTION:'true'},'test'));
  for(const folder of ['frontend','player-frontend','backend/uploads'])assert.throws(()=>outputPath({PLAYER_DEMO_OUTPUT:path.resolve(__dirname,'../..',folder,'demo.seed')},'demo'));
  assert.throws(()=>outputPath({PLAYER_DEMO_OUTPUT:'test.json'},'demo'));
});
test('两种规模的独立随机密码、各审核状态与合成 PNG 可用于真实上传校验',()=>{
  for(const size of ['small','large']){const players=definitions('demo',size);assert.equal(players.length,size==='large'?500:24);assert.equal(new Set(players.map(p=>p.password)).size,players.length);assert.deepEqual(new Set(players.map(p=>p.status)),new Set(['unsubmitted','approved','pending','returned','revoked','withdrawn']));}
  const buffer=image();assert.equal(require('../utils/playerAcademicUpload').validate({buffer,size:buffer.length,mimetype:'image/png'}).mime,'image/png');
});
