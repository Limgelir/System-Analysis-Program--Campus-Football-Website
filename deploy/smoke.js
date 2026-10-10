const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { validate } = require('./renderProduction');
const { probe, certificateDays } = require('./monitor');
async function main() {
  const sites = validate(JSON.parse(await fs.readFile(process.env.SITES_CONFIG || '/etc/tj-refweb/sites.json', 'utf8')));
  const get = url => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  for (const domain of [sites.refereeDomain, sites.playerDomain]) {
    const base = `https://${domain}`;
    await probe(`${base}/health`);
    assert.ok(await certificateDays(domain) > 21, '证书有效期不足');
    const redirect = await get(`http://${domain}/login`);
    assert.equal(redirect.status, 308); assert.equal(redirect.headers.get('location'), `${base}/login`);
    const page = await get(`${base}/login`); assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    for (const suffix of ['/.env', '/uploads/private.png', '/assets/missing.js']) assert.equal((await get(base + suffix)).status, 404);
  }
  for (const alias of sites.refereeAliases) {
    const r = await get(`https://${alias}/login`); assert.equal(r.status, 308); assert.equal(r.headers.get('location'), `https://${sites.refereeDomain}/login`);
  }
  console.log('双站点 HTTPS、裁判别名、跳转、证书、健康和私有目录隔离通过');
}
if (require.main === module) main().catch(() => { console.error('线上冒烟未通过：检查 DNS、证书、代理、静态产物及数据库；不要开放真实资料'); process.exitCode = 1; });
