const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { REFEREE_UPLOAD_DIR, ensureUploadDirectories } = require('./uploadPaths');
const {
  extensionForImageMime,
  assertStoredImageSignature,
  removeStoredFile
} = require('./imageFileSecurity');

const PUBLIC_REFEREE_UPLOAD_PREFIX = '/uploads/referees';
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/jpg']);
const MAX_FILE_SIZE = 10 * 1024 * 1024;

ensureUploadDirectories();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, REFEREE_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const extension = extensionForImageMime(file?.mimetype);
    cb(null, `referee-${crypto.randomUUID()}${extension || ''}`);
  }
});

const uploadRefereePhoto = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file?.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('仅支持 JPG/PNG 图片'));
  }
});

function handleRefereePhotoUpload(req, res, next) {
  uploadRefereePhoto.single('id_photo')(req, res, async error => {
    try {
      if (error) throw error;
      if (req.file) await assertStoredImageSignature(req.file);
      next();
    } catch (uploadError) {
      await removeStoredFile(req.file);
      req.file = undefined;
      res.status(400).json({
        success: false,
        message: uploadError.message || '证件照上传失败'
      });
    }
  });
}

function buildRefereePhotoPath(filename) {
  return `${PUBLIC_REFEREE_UPLOAD_PREFIX}/${filename}`;
}

function resolveManagedRefereePhoto(relativePath) {
  if (
    typeof relativePath !== 'string' ||
    !relativePath.startsWith(`${PUBLIC_REFEREE_UPLOAD_PREFIX}/`)
  ) {
    return null;
  }

  return path.join(REFEREE_UPLOAD_DIR, path.basename(relativePath));
}

async function removeManagedRefereePhoto(relativePath) {
  const absolutePath = resolveManagedRefereePhoto(relativePath);
  if (!absolutePath) {
    return false;
  }

  try {
    await fs.promises.unlink(absolutePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

module.exports = {
  REFEREE_UPLOAD_DIR,
  PUBLIC_REFEREE_UPLOAD_PREFIX,
  uploadRefereePhoto,
  handleRefereePhotoUpload,
  buildRefereePhotoPath,
  resolveManagedRefereePhoto,
  removeManagedRefereePhoto
};
