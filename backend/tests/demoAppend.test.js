const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {parseArguments,assertAuthorized,outputPath,definitions,password,shiftDate,CASES} = require('../scripts/demoAppend');
const {validateRefereePassword} = require('../utils/passwordPolicy');
const {UPLOAD_ROOT} = require('../utils/uploadPaths');

test('追加样例必须显式选择命令、批次、赛季及关联管理员，拒绝清库及未知参数',()=>{
  assert.deepEqual(parseArguments(['append','--batch=p911-260906','--season-id=2','--admin-id=1']),{command:'append',batch:'p911-260906',seasonId:2,adminId:1});
  for(const args of [[],['clear'],['seed'],['append'],['plan','--batch=../../bad','--season-id=1','--admin-id=1'],
    ['append','--batch=abc','--season-id=0','--admin-id=1'],['append','--batch=abc','--season-id=1','--admin-id=1','--reset=true'],
    ['append','--batch=abc','--batch=def','--season-id=1','--admin-id=1']]) assert.throws(()=>parseArguments(args));
});

test('追加授权绑定数据库，不沿用旧 RESET 授权，生产另加显式许可',()=>{
  assert.throws(()=>assertAuthorized({DEMO_SEED_CONFIRM:'RESET_referee_system'},'referee_system'),/APPEND_referee_system/);
  assert.throws(()=>assertAuthorized({DEMO_APPEND_CONFIRM:'APPEND_other'},'referee_system'));
  assert.doesNotThrow(()=>assertAuthorized({DEMO_APPEND_CONFIRM:'APPEND_referee_system'},'referee_system'));
  assert.throws(()=>assertAuthorized({NODE_ENV:'production',DEMO_APPEND_CONFIRM:'APPEND_referee_system'},'referee_system'),/ALLOW_PRODUCTION/);
  assert.doesNotThrow(()=>assertAuthorized({NODE_ENV:'production',DEMO_APPEND_CONFIRM:'APPEND_referee_system',DEMO_APPEND_ALLOW_PRODUCTION:'true'},'referee_system'));
});

test('追加凭据仅写 seed 私密文件，拒绝公开目录和生产相对路径',()=>{
  assert.match(outputPath({},'batch1'),/demo-append-batch1\.seed$/);
  for(const file of [path.join(UPLOAD_ROOT,'secret.seed'),path.resolve('/var/www/secret.seed'),path.resolve(__dirname,'../../frontend/secret.seed'),path.resolve('secret.json')]) {
    assert.throws(()=>outputPath({DEMO_APPEND_OUTPUT:file},'batch1'));
  }
  assert.throws(()=>outputPath({NODE_ENV:'production',DEMO_APPEND_OUTPUT:'relative.seed'},'batch1'),/绝对路径/);
});

test('每批覆盖预备国家级、足协状态、强制改密、同名及注册流程，账号标识互不覆盖',()=>{
  const first = definitions('first','2026-09-06'), second = definitions('second','2026-09-06');
  assert.equal(first.length,30);
  assert.equal(new Set([...first,...second].map(r=>r.student_id)).size,60);
  assert.ok(first.some(r=>r.grade==='预备国家级'));
  assert.ok(first.some(r=>r.target_level==='预备国家级'));
  assert.equal(first.filter(r=>r.shanghai_fa_registered).length,15);
  assert.equal(first.filter(r=>r.must_change_password).length,4);
  assert.equal(first[23].name,first[24].name);
  assert.deepEqual(first.slice(25,28).map(r=>r.registration_status),['pending','rejected','unsubmitted']);
  assert.equal(CASES.length,10);
});

test('追加账号各自使用随机16位密码，比赛日期跨月跨年正常',()=>{
  const passwords = Array.from({length:30},password);
  assert.equal(new Set(passwords).size,30);
  for(const value of passwords){assert.equal(value.length,16);assert.doesNotThrow(()=>validateRefereePassword(value));}
  assert.equal(shiftDate('2026-01-01',-1),'2025-12-31');
  assert.equal(shiftDate('2026-12-31',1),'2027-01-01');
});
