const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extensionForImageMime,
  signatureMatches
} = require('../utils/imageFileSecurity');

test('上传图片扩展名只由服务端认可的 MIME 类型决定', () => {
  assert.equal(extensionForImageMime('image/jpeg'), '.jpg');
  assert.equal(extensionForImageMime('image/png'), '.png');
  assert.equal(extensionForImageMime('text/html'), null);
});

test('上传图片必须包含匹配的 JPG 或 PNG 文件头', () => {
  assert.equal(signatureMatches(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg'), true);
  assert.equal(
    signatureMatches(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'),
    true
  );
  assert.equal(signatureMatches(Buffer.from('<script>'), 'image/png'), false);
  assert.equal(signatureMatches(Buffer.from([0xff, 0xd8, 0xff]), 'image/png'), false);
});
