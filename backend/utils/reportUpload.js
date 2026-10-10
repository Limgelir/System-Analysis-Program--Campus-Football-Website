const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { REPORT_UPLOAD_DIR, ensureUploadDirectories } = require('./uploadPaths');
const { extensionForImageMime } = require('./imageFileSecurity');

const PUBLIC_REPORT_UPLOAD_PREFIX = '/uploads/reports';
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/jpg']);
const MAX_FILE_SIZE = 10 * 1024 * 1024;

ensureUploadDirectories();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, REPORT_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const extension = extensionForImageMime(file?.mimetype);
    cb(null, `report-fourth-official-${crypto.randomUUID()}${extension || ''}`);
  }
});

const uploadFourthOfficialImage = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file?.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error('仅支持 JPG/PNG 图片，且大小不能超过 10MB'));
  }
});

function buildFourthOfficialImagePath(filename) {
  return `${PUBLIC_REPORT_UPLOAD_PREFIX}/${filename}`;
}

function isManagedReportUploadPath(relativePath) {
  return typeof relativePath === 'string' && relativePath.startsWith(`${PUBLIC_REPORT_UPLOAD_PREFIX}/`);
}

function resolveManagedReportUploadPath(relativePath) {
  if (!isManagedReportUploadPath(relativePath)) {
    return null;
  }

  const fileName = path.basename(relativePath);
  return path.join(REPORT_UPLOAD_DIR, fileName);
}

async function removeManagedReportUpload(relativePath) {
  const absolutePath = resolveManagedReportUploadPath(relativePath);
  if (!absolutePath) {
    return false;
  }

  try {
    await fs.promises.unlink(absolutePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

module.exports = {
  REPORT_UPLOAD_DIR,
  PUBLIC_REPORT_UPLOAD_PREFIX,
  uploadFourthOfficialImage,
  buildFourthOfficialImagePath,
  resolveManagedReportUploadPath,
  removeManagedReportUpload
};
