const { spawn } = require('node:child_process');
const child = spawn(process.execPath, [require('node:path').join(__dirname, 'runApiIntegrationTests.js')], {
  env: { ...process.env, REFWEB_OPS_INTEGRATION: '1' }, stdio: 'inherit', windowsHide: true
});
child.once('error', () => { process.exitCode = 1; });
child.once('close', code => { process.exitCode = code ?? 1; });
