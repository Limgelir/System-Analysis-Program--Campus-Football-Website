const {test}=require('node:test');
const assert=require('node:assert/strict');
const w=require('../utils/playerWorkflow');
const image=require('../utils/playerAcademicUpload');
test('中国时间：固定时区、闰日、精确截止边界以及非法日期',()=>{
  assert.equal(w.chinaSql('2026-09-08T00:00:00.000Z'),'2026-09-08 08:00:00.000');
  assert.equal(w.chinaIso('2026-09-08 08:00:00'),'2026-09-08T08:00:00.000+08:00');
  assert.equal(w.normalizeTime('2028-02-29T08:10:00+08:00','开放'),'2028-02-29 08:10:00.000');
  for(const value of ['2026-02-29T08:00:00+08:00','2026-09-08T24:00:00+08:00','2026-09-08T08:00','2026-09-08T08:00:00Z'])assert.throws(()=>w.normalizeTime(value,'时间'));
  const open='2026-09-08 08:00:00.000',close='2026-09-08 09:00:00.000';
  assert.equal(w.windowStatus(open,close,open),'open');assert.equal(w.windowStatus(open,close,close),'closed');
  assert.equal(w.windowStatus(open,close,'2026-09-08 07:59:59.999'),'upcoming');assert.equal(w.windowStatus(null,null),'unconfigured');
  assert.throws(()=>w.windowPair({a:'2026-09-08T08:00:00+08:00',b:null},'a','b','窗口'));
});
test('学籍材料：拒绝伪装图片、截断文件和路径穿越',()=>{
  for(const buffer of [Buffer.from('<html>bad</html>'),Buffer.from('89504e470d0a1a0a','hex')])assert.throws(()=>image.validate({buffer,size:buffer.length,mimetype:'image/png'}));
  for(const stored of ['../secret','player-academic/../../secret','reports/a.png'])assert.throws(()=>image.resolve(stored));
});
