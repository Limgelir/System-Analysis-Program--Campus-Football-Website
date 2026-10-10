const {test}=require('node:test');
const assert=require('node:assert/strict');
const bcrypt=require('bcryptjs');
if(process.env.REFWEB_INTEGRATION_TEST!=='1'||!process.env.DB_NAME.endsWith('_test'))throw Error('仅限随机隔离测试库');
const pool=require('../../db'),app=require('../../server');
test('管理员特殊导入端到端API',async t=>{
  const state={admin:{username:'discipline-admin',password:'Discipline!2026'}};
  await pool.execute('INSERT INTO admin(username,password_hash,must_change_password,password_changed_at) VALUES (?,?,0,NOW())',[state.admin.username,await bcrypt.hash(state.admin.password,4)]);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(path,options={}){
    const headers=new Headers(options.headers||{});if(options.token)headers.set('Authorization','Bearer '+options.token);
    const method=options.method||(options.body===undefined?'GET':'POST');let body=options.body;
    const report=/^\/api\/report\/(?:admin\/)?schedule\/(\d+)\/(.+)$/.exec(path);
    if(report&&method!=='GET'&&!headers.has('If-Match')){const r=await fetch(base+'/api/report/schedule/'+report[1],{headers});if(r.ok)headers.set('If-Match',String((await r.json()).data.sections.main.revision));}
    const schedule=/^\/api\/schedule\/(\d+)$/.exec(path);
    if(schedule&&method==='PUT'){const r=await fetch(base+path,{headers});if(r.ok)body={...body,schedule_revision:(await r.json()).data.schedule_revision};}
    if(path==='/api/schedule'&&method==='POST')body={venue:'樱花人草',...body};
    if(body!==undefined&&!(body instanceof FormData)){headers.set('Content-Type','application/json');body=JSON.stringify(body);}
    const r=await fetch(base+path,{method,headers,body});return {status:r.status,data:await r.json()};
  }
  const expectStatus=(r,n,label)=>assert.equal(r.status,n,`${label}: ${JSON.stringify(r.data)}`);
  try{await require('./adminImports.cjs')({t,pool,state,request,expectStatus});}finally{await new Promise(resolve=>server.close(resolve));await pool.end();}
});
