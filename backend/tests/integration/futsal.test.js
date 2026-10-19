const {test}=require('node:test');
const assert=require('node:assert/strict');
const bcrypt=require('bcryptjs');
if(process.env.REFWEB_INTEGRATION_TEST!=='1'||!process.env.DB_NAME.endsWith('_test'))throw Error('仅限随机隔离测试库');
const pool=require('../../db'),app=require('../../server');
test('裁判报名及五人制端到端API',async t=>{
  const state={admin:{username:'discipline-admin',password:'Discipline!2026'}};
  await pool.execute('INSERT INTO admin(username,password_hash,must_change_password,password_changed_at) VALUES (?,?,0,NOW())',[state.admin.username,await bcrypt.hash(state.admin.password,4)]);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(path,options={}){
    const headers=new Headers(options.headers||{});if(options.token)headers.set('Authorization','Bearer '+options.token);
    const method=options.method||(options.body===undefined?'GET':'POST');let body=options.body;
    const report=/^\/api\/report\/(?:admin\/)?schedule\/(\d+)\/(.+)$/.exec(path);
    if(report&&method!=='GET'&&!headers.has('If-Match')){const r=await fetch(base+'/api/report/schedule/'+report[1],{headers});if(r.ok)headers.set('If-Match',String((await r.json()).data.sections[report[2].includes('supervisor')?'supervisor':'main'].revision));}
    const schedule=/^\/api\/schedule\/(\d+)(?:\/assign-referees)?$/.exec(path);
    if(schedule&&method==='PUT'&&!Object.hasOwn(body,'schedule_revision')){const r=await fetch(base+'/api/schedule/'+schedule[1],{headers});if(r.ok)body={...body,schedule_revision:(await r.json()).data.schedule_revision};}
    if(path==='/api/schedule'&&method==='POST'&&options.autoVenue!==false)body={venue:'樱花人草',...body};
    if(body!==undefined){headers.set('Content-Type','application/json');body=JSON.stringify(body);}
    const r=await fetch(base+path,{method,headers,body});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data};
  }
  const expectStatus=(r,n,label)=>assert.equal(r.status,n,`${label}: ${JSON.stringify(r.data)}`);
  try{
    await pool.execute("INSERT INTO referee(student_id,name,password_hash,grade,target_level,level_promoted_at,match_types) VALUES ('FUTSAL-TEMPLATE','测试模板',?,'一级','预备国家级','2025-01-01','足协杯')",[await bcrypt.hash('FutsalTest!2026',4)]);
    const login=await request('/api/admin/login',{body:state.admin});expectStatus(login,200,'测试管理员登录');
    state.tokens={admin:login.data.data.token};
    await require('./matchSignups.cjs')({t,pool,state,request,expectStatus});
  }finally{await new Promise(resolve=>server.close(resolve));await pool.end();}
});
