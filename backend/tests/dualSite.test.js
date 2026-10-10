const {test}=require('node:test'),assert=require('node:assert/strict');
const {render}=require('../../deploy/renderDualSite');
test('双端口部署共用回环 API，静态目录分别隔离',()=>{
  const config=render();
  const saved=require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../../deploy/nginx/tj-refweb-dual-http.conf'),'utf8');
  assert.equal(saved.replace(/\r\n/g,'\n'),config.replace(/\r\n/g,'\n'),'发布模板必须与实际测试的生成配置一致');
  assert.equal((config.match(/proxy_pass http:\/\/127.0.0.1:3000;/g)||[]).length,2);
  assert.match(config,/listen 8080 default_server/);assert.match(config,/root "\/var\/www\/tj-player"/);
  assert.equal((config.match(/default_server/g)||[]).length,2);
});
test('站点生成拒绝重复端口与配置注入',()=>{
  for(const playerPort of [80,3000,0,65536,'8080; include secret'])assert.throws(()=>render({playerPort}));
  assert.throws(()=>render({playerRoot:'/tmp/a; include x'}));
});
