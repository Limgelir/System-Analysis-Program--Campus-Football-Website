const {test}=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../utils/disciplineEngine');
const {fieldOrder,fieldOrderSortKey,disciplineRules}=require('../utils/competitionRules');
const rules={yellow_threshold:3,yellow_suspension:2,red_threshold:1,red_suspension:1};
const card=(type,team=1)=>({key:engine.playerKey(team,7),team_id:team,player_id:7,player_name:'测试球员',jersey_number:'7',card_type:type});
function report(id,cards,events=[],custom=rules){const payload={schedule_id:id,kickoff:`2026-09-${String(id).padStart(2,'0')} 10:00`,team_ids:[1,2],cards};payload.served=engine.serviceReceipts(engine.replay(events,custom),payload,cards);return {id,operation:'report',payload};}
const append=(events,id,cards,custom=rules)=>events.push(report(id,cards,events,custom));
test('文本场序精确区分大小写和前导零，限制空白和控制字符，自然排序',()=>{
  for(const value of ['A1','a1','01','1','J1','半决赛','0','-1'])assert.equal(fieldOrder(value),value);
  assert.equal(fieldOrder(' A1 '),'A1');for(const value of ['',{},[],true,'\n', 'a\u0000b','a'.repeat(51)])assert.equal(fieldOrder(value),null);
  const values=['A10','A2','10','2'];assert.deepEqual(values.sort((a,b)=>fieldOrderSortKey(a)<fieldOrderSortKey(b)?-1:1),['2','10','A2','A10']);
  assert.throws(()=>disciplineRules({...rules,yellow_threshold:0}));assert.throws(()=>disciplineRules({...rules,red_suspension:'1'}));
});
test('黄牌达到阈值保留累计；执行足够场次后只清黄牌，然后重新触发',()=>{
  const e=[];append(e,1,[card('yellow')]);append(e,2,[card('yellow')]);append(e,3,[card('yellow')]);
  let p=engine.replay(e,rules).players[0];assert.equal(p.yellow,3);assert.equal(p.remaining,2);
  append(e,4,[]);assert.equal(engine.replay(e,rules).players[0].yellow,3);
  append(e,5,[]);p=engine.replay(e,rules).players[0];assert.equal(p.yellow,0);assert.equal(p.remaining,0);assert.equal(p.total_yellow,3);
  append(e,6,[card('yellow')]);append(e,7,[card('yellow')]);append(e,8,[card('yellow')]);assert.equal(engine.replay(e,rules).players[0].remaining,2);
});
test('两黄变红忽略本场黄牌；服满红牌停赛后保留之前的黄牌',()=>{
  const e=[];append(e,1,[card('yellow')]);append(e,2,[card('yellow')]);append(e,3,[card('yellow'),card('yellow'),card('second_yellow_red')]);
  let p=engine.replay(e,rules).players[0];assert.equal(p.yellow,2);assert.equal(p.red,1);assert.equal(p.remaining,1);
  append(e,4,[]);p=engine.replay(e,rules).players[0];assert.equal(p.yellow,2);assert.equal(p.red,0);
});
test('红黄牌同时触发只执行较长处罚，服满两种累计均清零',()=>{
  const e=[];append(e,1,[card('yellow')]);append(e,2,[card('yellow')]);append(e,3,[card('yellow'),card('red')]);
  let p=engine.replay(e,rules).players[0];assert.equal(p.remaining,2);assert.equal(p.trigger_yellow,true);assert.equal(p.trigger_red,true);
  append(e,4,[]);append(e,5,[]);p=engine.replay(e,rules).players[0];assert.equal(p.yellow,0);assert.equal(p.red,0);
});
test('同一永久球员在不同队独立累计；尚未比赛的预测不消耗实际停赛',()=>{
  const e=[];append(e,1,[card('red'),card('yellow',2)]);const state=engine.replay(e,rules);
  assert.equal(state.players.find(p=>p.team_id===2).remaining,0);
  const projection=engine.project(state.players,[{id:2,team_a_id:1,team_b_id:2,kickoff:'2026-09-02 10:00'},{id:3,team_a_id:1,team_b_id:2,kickoff:'2026-09-03 10:00'}]);
  assert.equal(projection[0].suspensions.length,1);assert.equal(projection[1].suspensions.length,0);assert.equal(state.players[0].remaining,1);
});
test('历史修订不能把未记录的比赛自动当作服满停赛；补交更早比赛也不扣减',()=>{
  const e=[report(1,[]),report(2,[])];e[0].payload.cards=[card('red')];const state=engine.replay(e,rules);
  assert.equal(state.players[0].remaining,1);assert.equal(state.warnings.length,1);
  e.push(report(0,[],e));assert.equal(engine.replay(e,rules).players[0].remaining,1);
});
test('整项赛事清零解除未完成停赛、保留历史；旧阶段补报不再次累计',()=>{
  const e=[];append(e,1,[card('red')]);e.push({id:2,operation:'reset',reason:'进入淘汰赛',payload:{cutoff:'2026-09-03 12:00'}});
  append(e,2,[card('red')]);append(e,4,[card('yellow')]);const p=engine.replay(e,rules).players[0];
  assert.equal(p.remaining,0);assert.equal(p.red,0);assert.equal(p.yellow,1);assert.equal(p.total_red,2);
});
test('停赛球员在后场吃牌产生核对提示，不自动认定服满',()=>{
  const e=[];append(e,1,[card('red')]);append(e,2,[card('yellow')]);const s=engine.replay(e,rules);assert.equal(s.players[0].remaining,1);assert.equal(s.warnings.length,1);
});


test('纠正服满记录重新执行时保留服满后新增的同色牌',()=>{
  const r={...rules,yellow_threshold:3,yellow_suspension:1};const e=[];
  append(e,1,[card('yellow')],r);append(e,2,[card('yellow')],r);append(e,3,[card('yellow')],r);append(e,4,[],r);append(e,5,[card('yellow')],r);
  e.push({operation:'adjust',payload:{key:card('yellow').key,origin:3,remaining:1},reason:'误认服满'});
  const p=engine.replay(e,r).players[0];assert.equal(p.remaining,1);assert.equal(p.yellow,4);
});

test('修订撤销原停赛后，旧的人工延长不得成为没有来源的停赛',()=>{
  const e=[];append(e,1,[card('red')]);e.push({operation:'adjust',payload:{key:card('red').key,origin:1,remaining:2}});
  e[0].payload.cards=[card('yellow')];let s=engine.replay(e,rules);assert.equal(s.players[0].remaining,0);assert.equal(s.warnings.length,1);
  e.push({operation:'adjust',payload:{key:card('yellow').key,origin:null,remaining:0},reason:'已核对撤销原处罚'});s=engine.replay(e,rules);assert.equal(s.warnings.length,0);assert.equal(s.players[0].yellow,1);
});
