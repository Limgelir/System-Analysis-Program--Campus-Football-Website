const fs = require('fs');

const MIME_TO_EXTENSION = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png']
]);

function extensionForImageMime(mimeType) {
  return MIME_TO_EXTENSION.get(String(mimeType || '').toLowerCase()) || null;
}

function signatureMatches(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer)) return false;
  const normalizedMime = String(mimeType || '').toLowerCase();
  if (normalizedMime === 'image/jpeg' || normalizedMime === 'image/jpg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (normalizedMime === 'image/png') {
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return buffer.length >= pngSignature.length && buffer.subarray(0, 8).equals(pngSignature);
  }
  return false;
}

async function assertStoredImageSignature(file) {
  if (!file?.path || !extensionForImageMime(file.mimetype)) {
    throw new Error('仅支持真实的 JPG/PNG 图片');
  }

  const handle = await fs.promises.open(file.path, 'r');
  try {
    const header = Buffer.alloc(8);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (!signatureMatches(header.subarray(0, bytesRead), file.mimetype)) {
      throw new Error('文件内容与 JPG/PNG 图片格式不符');
    }
  } finally {
    await handle.close();
  }
}

async function removeStoredFile(file) {
  if (!file?.path) return;
  try {
    await fs.promises.unlink(file.path);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('上传校验失败后的临时文件清理失败:', error.message);
    }
  }
}

module.exports = {
  MIME_TO_EXTENSION,
  extensionForImageMime,
  signatureMatches,
  assertStoredImageSignature,
  removeStoredFile
};
