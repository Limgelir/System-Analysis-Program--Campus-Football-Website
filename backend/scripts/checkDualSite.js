// 对两个真实构建产物执行本地 Nginx 冒烟；不连接业务数据库、不修改服务器配置。
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util'),assert=require('node:assert/strict');
const execute=promisify(execFile),{render}=require('../../deploy/renderDualSite');
const root=path.resolve(__dirname,'../..');
async function assets(directory){
  const index=await fs.readFile(path.join(directory,'index.html'),'utf8');
  const resources=[...index.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(m=>m[1]);assert.ok(resources.some(p=>p.endsWith('.js')),'构建产物必须包含 JS');
  // Axios 自身带有无端口 http://localhost 的非浏览器 URL 解析兜底，不能误判为 API 配置。
  for(const resource of resources){const code=await fs.readFile(path.join(directory,resource.slice(1)),'utf8');assert.doesNotMatch(code,/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+|\/api)["'`/]/,'生产资源不能内嵌本机 API 地址');}
  return {index,resources};
}
async function main(binary){
  const dirs=['frontend','player-frontend'].map(p=>path.join(root,p,'dist')),builds=await Promise.all(dirs.map(assets));
  if(!binary){console.log('两个前端生产资源检查通过；未运行 Nginx。完整检查须传入 --nginx=可执行文件路径。');return {nginx:false};}
  await fs.mkdir(path.join(root,'.cache'),{recursive:true});
  const temp=await fs.mkdtemp(path.join(root,'.cache','refweb-dual-site-'));let backend,probe,nginx,config;
  try{
    backend=http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');let bytes=0;req.on('data',chunk=>bytes+=chunk.length);req.on('end',()=>{res.statusCode=req.url==='/api/private'&&!req.headers.authorization?401:200;res.end(JSON.stringify({path:req.url,bytes,authenticated:Boolean(req.headers.authorization),host:req.headers.host}));});});
    await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
    probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const refereePort=probe.address().port;await new Promise(resolve=>probe.close(resolve));probe=null;
    probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const playerPort=probe.address().port;await new Promise(resolve=>probe.close(resolve));probe=null;
    const q=p=>'"'+p.replace(/\\/g,'/')+'"';config=path.join(temp,'nginx.conf');
    await fs.writeFile(config,`pid ${q(path.join(temp,'nginx.pid'))};\nerror_log ${q(path.join(temp,'error.log'))};\nevents {}\nhttp {\naccess_log off;\nclient_body_temp_path ${q(path.join(temp,'body'))};\nproxy_temp_path ${q(path.join(temp,'proxy'))};\ntypes { text/html html; text/css css; application/javascript js; image/png png; image/svg+xml svg; }\n${render({refereeRoot:dirs[0],playerRoot:dirs[1],refereePort,playerPort,backendPort:backend.address().port,loopback:true})}}\n`);
    await fs.mkdir(path.join(temp,'logs'));await fs.mkdir(path.join(temp,'temp'));await execute(binary,['-t','-p',temp.replace(/\\/g,'/')+'/','-c',config.replace(/\\/g,'/')],{windowsHide:true});
    const args=['-p',temp.replace(/\\/g,'/')+'/','-c',config.replace(/\\/g,'/')];
    // daemon off 使测试进程生命周期明确，避免残留本地代理。
    nginx=spawn(binary,[...args,'-g','daemon off;'],{windowsHide:true,stdio:'ignore'});
    let spawnError;nginx.once('error',e=>{spawnError=e;});
    const request=(pathname,port,options={})=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:pathname,method:options.method||'GET',headers:{Host:'127.0.0.1',...options.headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.once('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));});req.setTimeout(10000,()=>req.destroy(new Error('本地代理请求超时')));req.once('error',reject);req.end(options.body);});
    let ready=false;for(let i=0;i<60;i++){if(spawnError)throw spawnError;try{ready=(await request('/health',refereePort)).status===200;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'Nginx 启动失败');
    for(const [i,host]of [refereePort,playerPort].entries()){
      const deep=await request(i?'/public/teams/123':'/admin-dashboard',host);assert.equal(deep.status,200);assert.equal(deep.body,builds[i].index);assert.equal(deep.headers['x-content-type-options'],'nosniff');assert.match(deep.headers['cache-control'],/no-cache/);
      for(const resource of builds[i].resources)assert.equal((await request(resource,host)).status,200);
      for(const uri of ['/assets/missing.js','/.env','/accounts.seed','/uploads/private.png','/api'])assert.equal((await request(uri,host)).status,404,uri);
      assert.equal((await request('/api/private',host)).status,401);
      const response=await request('/api/private',host,{method:'POST',headers:{Authorization:'Bearer isolated-test'},body:Buffer.alloc(256*1024,120)});assert.equal(response.status,200);assert.equal(JSON.parse(response.body).bytes,256*1024);assert.equal(response.headers['cache-control'],'no-store');
    }
    console.log('同 IP 双端口站点、生产资源、深层刷新、共用 API、私有读取鉴权转发及上传代理检查通过（隔离假 API，无业务库）。');return {nginx:true};
  }finally{
    if(nginx){await execute(binary,['-p',temp.replace(/\\/g,'/')+'/','-c',config.replace(/\\/g,'/'),'-s','quit'],{windowsHide:true}).catch(()=>{});if(nginx.exitCode===null)await Promise.race([new Promise(resolve=>nginx.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);if(nginx.exitCode===null)nginx.kill();}
    if(backend)await new Promise(resolve=>backend.close(resolve));if(probe)await new Promise(resolve=>probe.close(resolve));
    // temp 来自本次 mkdtemp 的绝对路径，绝不操作真实 Nginx/上传/备份目录。
    await fs.rm(temp,{recursive:true,force:true});
  }
}
if(require.main===module){const args=process.argv.slice(2);if(args.some(a=>!a.startsWith('--nginx='))||args.length>1){console.error('仅支持 --nginx=可执行文件路径');process.exitCode=1;}else main(args[0]?.slice(8)).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={assets,main};
