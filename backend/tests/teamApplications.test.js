const {test}=require('node:test'),assert=require('node:assert/strict');
const r=require('../utils/teamApplicationRules');
const member=(id,n=String(id))=>({id,player_id:id,jersey_number:n,is_captain:id===1,is_goalkeeper:false,is_foreign:false,is_sports_training:false});
const body=members=>({team_name:'测试队',shirt_color:'红',shorts_color:'红',socks_color:'红',members});
test('颜色留空或仅空格均保存为空，正式名单仍校验人员与队长',()=>{
  const data=r.normalize({...body([member(1)]),shirt_color:'  ',shorts_color:'',socks_color:null},{complete:true});
  assert.deepEqual([data.shirt_color,data.shorts_color,data.socks_color],[null,null,null]);
  assert.throws(()=>r.normalize({...body([member(1)]),shirt_color:'红'.repeat(51)},{complete:true}));
});
test('球队号码规范化，支持0及大整数；拒绝负数、小数、重复号码和重复队员',()=>{
  assert.equal(r.number('000'),'0');assert.equal(r.number('01'),'1');assert.equal(r.number('99999999999999999999'),'99999999999999999999');
  for(const v of ['-1','1.2','1e3','+1'])assert.throws(()=>r.number(v));
  assert.throws(()=>r.normalize(body([member(1,'01'),member(2,'1')])));assert.throws(()=>r.normalize(body([member(1),{...member(2),player_id:1}])));
});
test('草稿可暂缺号码，正式提交恰好一名队长且完整，无31人上限',()=>{
  assert.equal(r.normalize(body([member(1,''),member(2,'')])).members[0].jersey_number,null);
  assert.throws(()=>r.normalize(body([member(1,'')]),{complete:true}));assert.throws(()=>r.normalize(body([member(2)]),{complete:true}));
  assert.equal(r.normalize(body(Array.from({length:40},(_,i)=>member(i+1))),{complete:true}).members.length,40);
});
test('截止后补正按稳定名单行限制替换，禁止删除、添加和替换其他人',()=>{
  const old=body([member(1),member(2)]),changed=body([member(1),{...member(2),player_id:3,jersey_number:'99',is_foreign:true}]);r.correction(old,changed,[2]);
  assert.throws(()=>r.correction(old,changed,[]));assert.throws(()=>r.correction(old,body([member(1)]),[2]));assert.throws(()=>r.correction(old,body([member(1),member(3)]),[2]));
});
