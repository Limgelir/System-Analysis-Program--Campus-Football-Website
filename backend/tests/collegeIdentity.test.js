const {test}=require('node:test'),assert=require('node:assert/strict');
const {COLLEGES,requireCollege,matchCollege}=require('../utils/collegeIdentity');
test('50个选择项覆盖新增中心；新写入仅接受选择项原名',()=>{
  assert.equal(COLLEGES.length,50);assert.equal(new Set(COLLEGES).size,50);
  assert.ok(COLLEGES.includes('上海自主智能无人系统科学中心'));
  for(const name of COLLEGES)assert.equal(requireCollege(name),name);
  for(const value of ['土木学院','未知学院','',' 土木工程学院 ',null,[],true])assert.throws(()=>requireCollege(value));
});
test('旧学院按明确别名、学校前缀、空格和括号匹配；歧义名称保留',()=>{
  for(const value of ['土木学院','土木工程','同济大学 土木工程学院',' 土木工程学院 '])assert.equal(matchCollege(value).college,'土木工程学院');
  for(const value of ['软件学院','计算机学院','计算机','软件','计算机科学与技术学院 (软件学院)'])assert.equal(matchCollege(value).college,'计算机科学与技术学院（软件学院）');
  for(const value of ['体育部','体育教学部','国际足球学院'])assert.equal(matchCollege(value).college,'体育部（国际足球学院）');
  for(const value of ['中德','工程学院','机械与能源工程学院','机能学院','环境与科学学院','',null])assert.equal(matchCollege(value).college,null);
  assert.notEqual(matchCollege('医学院').college,matchCollege('口腔医学院').college);
  assert.notEqual(matchCollege('中德学院').college,matchCollege('中德工程学院').college);
});
test('生产账号确认表中的五种旧写法可归属，注册和后续修改仍必须选择标准项',()=>{
  const pairs=[['交通','交通学院（铁道与城市轨道交通研究院）'],['体育部国际足球学院','体育部（国际足球学院）'],['国际足球学校','体育部（国际足球学院）'],['同济大学自主智能无人系统科学中心','上海自主智能无人系统科学中心'],['上海自主智能无人科学中心','上海自主智能无人系统科学中心']];
  for(const [old,target]of pairs){assert.equal(matchCollege(old).college,target);assert.throws(()=>requireCollege(old));}
  assert.equal(matchCollege('上线验收').college,null);
});
