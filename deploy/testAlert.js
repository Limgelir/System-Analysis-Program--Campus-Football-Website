// 仅在操作者明确执行 --send 时发送给私有配置中的接收人。
const { notify } = require('./monitor');
if (process.argv.length !== 3 || process.argv[2] !== '--send') {
  console.error('用法: node --env-file=/etc/tj-refweb/ops.env deploy/testAlert.js --send');
  process.exitCode = 1;
} else {
  notify({ source: 'tj-refweb', time: new Date().toISOString(), status: 'test', checks: [] })
    .then(() => console.log('测试告警已由发送服务接受，请接收人核对收件箱与垃圾邮件'))
    .catch(() => { console.error('测试告警发送失败，请检查私有邮件配置、授权码及网络'); process.exitCode = 1; });
}
