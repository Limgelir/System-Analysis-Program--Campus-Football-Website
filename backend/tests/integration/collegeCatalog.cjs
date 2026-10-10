const assert=require('node:assert/strict'),bcrypt=require('bcryptjs');
module.exports=async({t,pool,state,request,expectStatus})=>{
  const admin=state.tokens?.admin||(await request('/api/admin/login',{body:state.admin})).data.data.token;
  const password='College!Test2026';let player,referee;
  const call=async(url,body,token,method,revision,status=200)=>{
    const r=await request(url,{body,token,method,headers:revision==null?{}:{'If-Match':String(revision)}});expectStatus(r,status,url);return r.data.data;
  };
  await t.test('注册接受标准学院，裁判在无赛季时自行修改；球员旧接口不能绕过审核',async()=>{
    const body={student_id:'COLLEGE-PLAYER',name:'学院验收球员',college:'土木工程学院',password,gender:'male',password_confirm:password};
    await call('/api/player/register',{...body,college:'土木学院'},null,'POST',null,400);
    await call('/api/player/register',body,null,'POST',null,201);
    player=await call('/api/player/login',{student_id:body.student_id,password},null,'POST');
    const [r]=await pool.execute("INSERT INTO referee(student_id,name,password_hash,grade,target_level,level_promoted_at,match_types,must_change_password) VALUES ('COLLEGE-REF','学院验收裁判',?,'三级','二级','2025-01-01','足协杯',0)",[await bcrypt.hash(password,4)]);
    referee=await call('/api/referee/login',{student_id:'COLLEGE-REF',password},null,'POST');assert.equal(referee.id,r.insertId);
    const [active]=await pool.query('SELECT id FROM seasons WHERE is_active=1');
    const historyTables=['player_season_registrations','player_registration_events','referee_season_registrations','referee_season_registration_events','team','team_player','team_roster_batches','team_applications','match_schedules'];
    const snapshot=async()=>{const rows={};for(const table of historyTables)rows[table]=(await pool.query('SELECT * FROM '+table+' ORDER BY id'))[0];return rows;};
    await pool.query('UPDATE seasons SET is_active=0 WHERE is_active=1');
    try{
      const before=await snapshot();
      for(const college of ['上海自主智能无人系统科学中心','体育部（国际足球学院）','土木工程学院']){
        const current=await call('/api/player/me',undefined,player.token);
        const same=college===current.college;
        await call('/api/player/me',{name:current.name,college},player.token,'PUT',current.revision,same?200:400);
        assert.equal((await call('/api/player/me',undefined,player.token)).college,'土木工程学院');
        assert.equal((await call(`/api/referee/${referee.id}/college`,{college},referee.token,'PUT')).college,college);
      }
      assert.deepEqual(await snapshot(),before);
      assert.equal((await call('/api/referee/'+referee.id,undefined,referee.token)).college,'土木工程学院');
    }finally{for(const s of active)await pool.execute('UPDATE seasons SET is_active=1 WHERE id=?',[s.id]);}
  });
  await t.test('学院接口拒绝越权及夹带字段，非法更新不影响账号',async()=>{
    const url=`/api/referee/${referee.id}/college`;
    for(const [token,status]of [[null,401],[admin,403],[player.token,403]])await call(url,{college:'土木工程学院'},token,'PUT',null,status);
    const before=(await pool.execute('SELECT * FROM referee_profile WHERE referee_id=?',[referee.id]))[0];
    for(const body of [{},{college:'工程学院'},{college:''},{college:['土木工程学院']},{college:'土木工程学院',is_active:0}])await call(url,body,referee.token,'PUT',null,400);
    assert.deepEqual((await pool.execute('SELECT * FROM referee_profile WHERE referee_id=?',[referee.id]))[0],before);
    const p=await call('/api/player/me',undefined,player.token);
    await call('/api/player/me',{name:p.name,college:'土木学院'},player.token,'PUT',p.revision,400);
    assert.equal((await call('/api/player/me',undefined,player.token)).revision,p.revision);
  });
};
