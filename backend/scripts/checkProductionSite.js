// 真实 Nginx + 自签测试 CA；只监听本地随机端口，不修改系统配置或公开 DNS。
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const execute = require('node:util').promisify(execFile);
const { render } = require('../../deploy/renderProduction');
const { assets } = require('./checkDualSite');
const root = path.resolve(__dirname, '../..');
async function port() {
  const server = http.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const result = server.address().port; await new Promise(resolve => server.close(resolve)); return result;
}
async function main(binary, openssl = 'openssl') {
  if (!binary) throw new Error('需要 --nginx=可执行文件；可选 --openssl=可执行文件');
  const dirs = ['frontend', 'player-frontend'].map(d => path.join(root, d, 'dist'));
  const builds = await Promise.all(dirs.map(assets));
  await fs.mkdir(path.join(root, '.cache'), { recursive: true });
  const temp = await fs.mkdtemp(path.join(root, '.cache', 'refweb-https-test-'));
  let backend, nginx;
  const configFile = path.join(temp, 'nginx.conf'), prefix = temp.replace(/\\/g, '/') + '/';
  const args = ['-p', prefix, '-c', configFile.replace(/\\/g, '/')];
  const q = value => JSON.stringify(value.replace(/\\/g, '/'));
  const stop = async () => {
    if (!nginx) return;
    await execute(binary, [...args, '-s', 'quit'], { windowsHide: true });
    if (nginx.exitCode === null) await Promise.race([new Promise(resolve => nginx.once('close', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
    if (nginx.exitCode === null) nginx.kill();
    nginx = null;
  };
  try {
    for (const dir of ['logs', 'temp', 'acme/.well-known/acme-challenge']) await fs.mkdir(path.join(temp, dir), { recursive: true });
    await fs.writeFile(path.join(temp, 'acme/.well-known/acme-challenge/test-token'), 'isolated-acme');
    const cert = path.join(temp, 'cert.pem'), key = path.join(temp, 'key.pem');
    await execute(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', key, '-out', cert, '-subj', '/CN=referee.example.test', '-addext', 'subjectAltName=DNS:referee.example.test,DNS:player.example.test,DNS:ref.example.test'], { windowsHide: true, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    const ca = await fs.readFile(cert);
    backend = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
      let bytes = 0; req.on('data', chunk => bytes += chunk.length);
      req.on('end', () => {
        res.statusCode = req.url.startsWith('/api/private') && !req.headers.authorization ? 401 : 200;
        res.end(JSON.stringify({ status: 'ok', checks: { database: 'ok', migrations: 'ok' }, bytes, ip: req.headers['x-forwarded-for'], protocol: req.headers['x-forwarded-proto'], requestId: req.headers['x-request-id'] }));
      });
    });
    await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
    const c = { refereeDomain: 'referee.example.test', playerDomain: 'player.example.test', refereeAliases: ['ref.example.test'], refereeRoot: dirs[0], playerRoot: dirs[1], acmeRoot: path.join(temp, 'acme'), certificate: cert, certificateKey: key, logRoot: path.join(temp, 'logs'), httpPort: await port(), httpsPort: await port(), backendPort: backend.address().port, loopback: true };
    const writeConfig = mode => fs.writeFile(configFile, `pid ${q(path.join(temp, 'nginx.pid'))};\nerror_log ${q(path.join(temp, 'logs/process.log'))};\nevents {}\nhttp {\nclient_body_temp_path ${q(path.join(temp, 'body'))};\nproxy_temp_path ${q(path.join(temp, 'proxy'))};\ntypes { text/html html; text/css css; application/javascript js; image/png png; image/svg+xml svg; }\n${render(c, mode)}}\n`);
    const request = (domain, uri, secure = true, options = {}) => new Promise((resolve, reject) => {
      const req = (secure ? https : http).request({ hostname: '127.0.0.1', port: secure ? c.httpsPort : c.httpPort, servername: domain, ca, path: uri, method: options.method || 'GET', headers: { Host: domain, ...options.headers } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.once('error', reject);
        res.once('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      });
      req.setTimeout(7000, () => req.destroy(new Error('请求超时'))); req.once('error', reject); req.end(options.body);
    });
    const start = async mode => {
      await writeConfig(mode); await execute(binary, ['-t', ...args], { windowsHide: true });
      nginx = spawn(binary, [...args, '-g', 'daemon off;'], { windowsHide: true, stdio: 'ignore' });
      let error; nginx.once('error', e => error = e);
      for (let i = 0; i < 60; i++) {
        if (error) throw error;
        try { if ((await request(c.refereeDomain, '/.well-known/acme-challenge/test-token', false)).status === 200) return; } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Nginx 未启动');
    };
    await start('bootstrap');
    for (const domain of [c.refereeDomain, c.playerDomain, ...c.refereeAliases]) {
      assert.equal((await request(domain, '/login', false)).status, 503);
      assert.equal((await request(domain, '/.well-known/acme-challenge/test-token', false)).body, 'isolated-acme');
    }
    await stop(); await start('https');
    for (const [i, domain] of [c.refereeDomain, c.playerDomain].entries()) {
      const redirect = await request(domain, '/login?next=%2Fdashboard', false);
      assert.equal(redirect.status, 308); assert.equal(redirect.headers.location, `https://${domain}:${c.httpsPort}/login?next=%2Fdashboard`);
      const deep = await request(domain, '/dashboard'); assert.equal(deep.status, 200); assert.equal(deep.body, builds[i].index);
      assert.match(deep.headers['strict-transport-security'], /max-age/); assert.match(deep.headers['content-security-policy'], /default-src 'self'/);
      for (const resource of builds[i].resources) assert.equal((await request(domain, resource)).status, 200);
      for (const uri of ['/assets/missing.js', '/.env', '/credentials.seed', '/uploads/private.png', '/api']) assert.equal((await request(domain, uri)).status, 404);
      assert.equal((await request(domain, '/api/private?token=do-not-log-me')).status, 401);
      const post = await request(domain, '/api/private', true, { method: 'POST', headers: { Authorization: 'Bearer test-private-jwt', 'X-Forwarded-For': '203.0.113.99', 'X-Request-ID': 'injected-id' }, body: Buffer.alloc(256 * 1024, 120) });
      assert.equal(post.status, 200); const body = JSON.parse(post.body);
      assert.equal(body.bytes, 256 * 1024); assert.equal(body.ip, '127.0.0.1'); assert.equal(body.protocol, 'https'); assert.match(body.requestId, /^[a-f0-9]{32}$/);
      assert.equal((await request(domain, '/health')).status, 200); assert.equal((await request(domain, '/health/live')).status, 200);
    }
    const alias = await request(c.refereeAliases[0], '/admin-login'); assert.equal(alias.status, 308); assert.equal(alias.headers.location, `https://${c.refereeDomain}:${c.httpsPort}/admin-login`);
    await assert.rejects(request('unknown.example.test', '/'));
    await stop();
    const log = await fs.readFile(path.join(temp, 'logs/access.log'), 'utf8');
    assert.doesNotMatch(log, /do-not-log-me|test-private-jwt|injected-id/);
    for (const line of log.trim().split('\n')) assert.equal(JSON.parse(line).channel, 'edge');
    console.log('真实 Nginx HTTPS 双站点、裁判别名、HTTP跳转、ACME、静态资源、API/上传、代理防伪、日志脱敏全部通过');
  } finally {
    await stop().catch(() => { nginx?.kill(); });
    if (backend) await new Promise(resolve => backend.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  }
}
if (require.main === module) {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => { const match = /^--(nginx|openssl)=(.+)$/.exec(arg); if (!match) throw new Error('仅支持 --nginx=路径 --openssl=路径'); return match.slice(1); }));
  main(args.nginx, args.openssl).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { main };
