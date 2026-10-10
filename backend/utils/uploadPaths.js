const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const configuredUploadDir = String(process.env.UPLOAD_DIR || '').trim();
const UPLOAD_ROOT = configuredUploadDir
  ? path.resolve(BACKEND_ROOT, configuredUploadDir)
  : path.join(BACKEND_ROOT, 'uploads');
const REFEREE_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'referees');
const REPORT_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'reports');

function ensureUploadDirectories() {
  for (const directory of [UPLOAD_ROOT, REFEREE_UPLOAD_DIR, REPORT_UPLOAD_DIR]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      fs.chmodSync(directory, 0o700);
    }
  }
}

module.exports = {
  BACKEND_ROOT,
  UPLOAD_ROOT,
  REFEREE_UPLOAD_DIR,
  REPORT_UPLOAD_DIR,
  ensureUploadDirectories
};
