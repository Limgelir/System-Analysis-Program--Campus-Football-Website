const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=','base64');
module.exports=async({t,pool,state,request,expectStatus})=>{
  const admin=(await request('/api/admin/login',{body:state.admin})).data.data.token;
  const password='CollegeReview!2026',players=[];let pending,historyBefore,active;
  const historyTables=['player_season_registrations','player_registration_events','player_registration_files','team','team_player','team_roster_batches','team_applications','match_schedules','match_reports','referee_profile','referee_season_registrations'];
  const snapshot=async()=>{const data={};for(const table of historyTables)data[table]=(await pool.query('SELECT * FROM '+table+' ORDER BY '+(table==='referee_profile'?'referee_id':'id')))[0];return data;};
  async function call(url,body,token=admin,method,revision,status=200,extra={}){const r=await request(url,{body,token,method,headers:{...(revision==null?{}:{'If-Match':String(revision)}),...extra}});expectStatus(r,status,url);return r.data.data;}
  const me=p=>call('/api/player/me',undefined,p.token);
  function form(college,revision,image=png){const f=new FormData();f.append('new_college',college);f.append('account_revision',String(revision));if(image)f.append('academic_image',new Blob([image],{type:'image/png'}),'test.png');return f;}
  async function submit(p,college,options={}){const account=await me(p);return call('/api/player/college-changes',form(college,options.revision??account.revision,options.image===undefined?png:options.image),p.token,'POST',null,options.status||201,{'Idempotency-Key':options.key||crypto.randomUUID()});}
  const review=(d,action='approve',body={},status=200)=>call(`/api/player-admin/college-changes/${d.change.id}/${action}`,{...(action==='approve'?{account_revision:d.account.revision}:{}),...body},admin,'POST',d.change.revision,status);
  const withdraw=(d,p,status=200)=>call(`/api/player/college-changes/${d.change.id}/withdraw`,{},p.token,'POST',d.change.revision,status);
  await t.test('学院变更：旧账号原值保留，无启用赛季仍可申请；必传有效截图，不能绕过审核',async()=>{
    for(let i=0;i<3;i++){const student_id='COLLEGE-CHANGE-'+i;await call('/api/player/register',{student_id,name:'学院变更球员'+i,college:'土木工程学院',password,gender:'male',password_confirm:password},null,'POST',null,201);players.push(await call('/api/player/login',{student_id,password},null,'POST'));}
    await pool.execute("UPDATE player_accounts SET college='中德' WHERE id=?",[players[0].id]);
    const account=await me(players[0]);
    await call('/api/player/me',{name:'不应连带保存',college:'中德工程学院'},players[0].token,'PUT',account.revision,400);
    assert.deepEqual(await me(players[0]),account);
    await submit(players[0],'中德工程学院',{image:null,status:400});await submit(players[0],'工程学院',{status:400});await submit(players[0],'中德工程学院',{image:Buffer.from('fake PNG'),status:400});
    await submit(players[1],'土木工程学院',{status:400});
    [active]=await pool.query('SELECT id FROM seasons WHERE is_active=1');await pool.query('UPDATE seasons SET is_active=0');
    try{
      historyBefore=await snapshot();const key=crypto.randomUUID();pending=await submit(players[0],'中德工程学院',{key});
      assert.equal(pending.change.old_college,'中德');assert.equal(pending.change.new_college,'中德工程学院');assert.equal(pending.change.status,'pending');assert.equal(pending.account.college,'中德');assert.equal((await me(players[0])).revision,account.revision);
      const replay=await submit(players[0],'中德工程学院',{key});assert.equal(replay.change.id,pending.change.id);assert.equal(replay.replayed,true);
      await submit(players[0],'中德学院',{key,status:409});await submit(players[0],'中德学院',{status:409});
      const current=await call('/api/player/college-changes/current',undefined,players[0].token);assert.equal(current.items.length,1);assert.equal(current.pending.id,pending.change.id);assert.equal(JSON.stringify(current).includes('file_path'),false);
    }finally{for(const s of active)await pool.execute('UPDATE seasons SET is_active=1 WHERE id=?',[s.id]);}
    // Keep an expected snapshot with the season flags restored for later invariants.
    historyBefore=await snapshot();
  });
  await t.test('学院变更：截图及申请仅本人/管理员可读，匿名、其他球员和裁判不能越权',async()=>{
    const url='/api/player/college-changes/'+pending.change.id;
    for(const suffix of ['', '/image']){expectStatus(await request(url+suffix),401,'匿名');expectStatus(await request(url+suffix,{token:players[1].token}),403,'其他球员');}
    const [[ref]]=await pool.execute('SELECT id,token_version FROM referee WHERE is_active=1 AND must_change_password=0 LIMIT 1');
    const referee=require('jsonwebtoken').sign({id:ref.id,role:'referee',tokenVersion:ref.token_version},process.env.JWT_SECRET);
    expectStatus(await request(url+'/image',{token:referee}),403,'裁判');
    for(const token of [players[0].token,referee])expectStatus(await request('/api/player-admin/college-changes',{token}),403,'非管理员不可列表');
    await withdraw(pending,players[1],403);
    const file=await request(url+'/image',{token:players[0].token});expectStatus(file,200,'本人读图片');assert.equal(file.headers.get('cache-control'),'private, no-store');
    expectStatus(await request(`/api/player-admin/college-changes/${pending.change.id}/image`,{token:admin}),200,'管理员读图片');
    const [[row]]=await pool.execute('SELECT file_path FROM player_college_changes WHERE id=?',[pending.change.id]);expectStatus(await request('/uploads/'+row.file_path),404,'不可静态访问私有图片');
    assert.equal((await call('/api/player/college-changes/current',undefined,players[1].token)).items.length,0);
  });
  await t.test('学院变更：审核需新鲜账号版本；并发通过只更新一次，通知/审计原子写入，历史业务不改',async()=>{
    const account=await me(players[0]);await call('/api/player/me',{name:'学院变更最新姓名'},players[0].token,'PUT',account.revision);
    await review(pending,'approve',{},409);
    pending=await call(`/api/player-admin/college-changes/${pending.change.id}`);
    const before=await me(players[0]);
    await pool.query("CREATE TRIGGER college_review_rollback BEFORE INSERT ON player_notifications FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='college review rollback'");
    try{await review(pending,'approve',{},500);}finally{await pool.query('DROP TRIGGER college_review_rollback');}
    assert.deepEqual(await me(players[0]),before);assert.equal((await call(`/api/player-admin/college-changes/${pending.change.id}`)).change.status,'pending');
    const results=await Promise.all([1,2].map(()=>request(`/api/player-admin/college-changes/${pending.change.id}/approve`,{token:admin,body:{account_revision:pending.account.revision},headers:{'If-Match':String(pending.change.revision)}})));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const after=await me(players[0]);assert.equal(after.college,'中德工程学院');assert.equal(after.revision,before.revision+1);
    const detail=await call(`/api/player-admin/college-changes/${pending.change.id}`);assert.deepEqual(detail.events.map(e=>e.operation),['approved','submitted']);assert.equal(detail.change.profile_snapshot.name,'学院变更球员0');assert.equal(detail.change.review_profile_snapshot.name,'学院变更最新姓名');assert.equal(detail.change.review_profile_snapshot.college,'中德');
    const [[audit]]=await pool.execute("SELECT COUNT(*) n FROM player_account_events WHERE player_id=? AND operation='college_change_approved'",[players[0].id]);assert.equal(audit.n,1);
    const notices=await call('/api/player/notifications',undefined,players[0].token);assert.equal(notices.filter(n=>n.kind==='college_change_approved').length,1);
    assert.deepEqual(await snapshot(),historyBefore);await withdraw(pending,players[0],409);
  });
  await t.test('学院变更：退回必填理由，原学院不变；再次提交需要截图并保留旧申请',async()=>{
    const d=await submit(players[0],'法学院'),before=await me(players[0]);
    await review(d,'return',{},400);await review(d,'return',{reason:'   '},400);
    const returned=await review(d,'return',{reason:'截图未包含姓名，请补充完整页面'});assert.equal(returned.change.status,'returned');assert.deepEqual(await me(players[0]),before);
    await review(d,'approve',{},409);await submit(players[0],'法学院',{image:null,status:400});
    const next=await submit(players[0],'法学院');assert.notEqual(next.change.id,d.change.id);await withdraw(next,players[0]);
    const current=await call('/api/player/college-changes/current',undefined,players[0].token);assert.equal(current.pending,null);assert.equal(current.items[0].status,'withdrawn');assert.ok(current.items.some(i=>i.status==='returned'));
    const notices=await call('/api/player/notifications',undefined,players[0].token);assert.ok(notices.some(n=>n.kind==='college_change_returned'&&n.message.includes('未包含姓名')));
  });
  await t.test('学院变更：账号已停用、原学院改变、截图缺失均不能通过，管理员可退回',async()=>{
    const d=await submit(players[1],'法学院');
    await pool.execute('UPDATE player_accounts SET is_active=0 WHERE id=?',[players[1].id]);try{await review(d,'approve',{},409);}finally{await pool.execute('UPDATE player_accounts SET is_active=1 WHERE id=?',[players[1].id]);}
    await pool.execute("UPDATE player_accounts SET college='医学院' WHERE id=?",[players[1].id]);try{await review(d,'approve',{},409);}finally{await pool.execute("UPDATE player_accounts SET college='土木工程学院' WHERE id=?",[players[1].id]);}
    const [[row]]=await pool.execute('SELECT file_path FROM player_college_changes WHERE id=?',[d.change.id]),path=require('../../utils/playerAcademicUpload').resolve(row.file_path),contents=await fs.readFile(path);
    await fs.unlink(path);try{await review(d,'approve',{},409);}finally{await fs.writeFile(path,contents);}
    assert.equal((await me(players[1])).college,'土木工程学院');await review(d,'return',{reason:'请重新核对原学院和材料'});
  });
  await t.test('学院变更：并发提交最多一条待审；撤回与通过竞态最多一个成功',async()=>{
    const p=players[2],before=await me(p);
    const requests=await Promise.all(['医学院','法学院'].map(college=>request('/api/player/college-changes',{token:p.token,body:form(college,before.revision),headers:{'Idempotency-Key':crypto.randomUUID()}})));
    assert.deepEqual(requests.map(r=>r.status).sort(),[201,409]);const d=requests.find(r=>r.status===201).data.data;
    const results=await Promise.all([
      request(`/api/player/college-changes/${d.change.id}/withdraw`,{token:p.token,body:{},headers:{'If-Match':'1'}}),
      request(`/api/player-admin/college-changes/${d.change.id}/approve`,{token:admin,body:{account_revision:before.revision},headers:{'If-Match':'1'}})
    ]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const final=await call(`/api/player-admin/college-changes/${d.change.id}`);assert.equal(final.account.college,final.change.status==='approved'?d.change.new_college:before.college);assert.equal(final.events.length,2);
    const list=await call('/api/player-admin/college-changes?q=COLLEGE-CHANGE&status=returned');assert.ok(list.items.length>=2);assert.ok(list.items.every(r=>r.status==='returned'));
    await call('/api/player-admin/college-changes?page=0',undefined,admin,undefined,null,400);
  });
};
