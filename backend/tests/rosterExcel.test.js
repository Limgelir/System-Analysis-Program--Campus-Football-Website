const {test}=require('node:test');
const assert=require('node:assert/strict');
const XLSX=require('xlsx');
const parser=require('../utils/rosterExcelParser');
function parse(rows,mutate=()=>{}){const s=XLSX.utils.aoa_to_sheet([parser.HEADERS,...rows]);mutate(s);const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,s,'名单');return parser.parseRosterExcelBuffer(XLSX.write(b,{type:'buffer',bookType:'xlsx'}),'名单.xlsx');}
test('Excel超过31人完整解析，空行不改变错误行号',()=>{const rows=Array.from({length:40},(_,i)=>['ID'+i,'同名',String(i),i?'':'是','','是','是','']);rows.splice(2,0,[]);const d=parse(rows);assert.equal(d.players.length,40);assert.equal(d.players[3].row_number,6);assert.equal(d.errors.length,0);assert.equal(d.players[0].is_foreign,true);});
test('缺字段、重复规范号码、重复学号逐行报告，不静默丢弃',()=>{const d=parse([['001','甲','01'],[],['002','乙','1'],['001','甲','3'],['003','丙','-1'],['004','丁',''],['','戊','6']]);assert.deepEqual(d.errors.map(e=>e.row_number),[4,5,6,7,8]);assert.equal(d.players[0].student_id,'001');assert.equal(d.players[0].jersey_number,'1');});
test('拒绝公式、无效标记及可能丢失精度的学号',()=>{const d=parse([['1','甲','0'],['2','乙','1','','是吧'],[1234567890123456,'丙','2']],s=>{s.C2={t:'n',v:0,f:'1-1'};});assert.equal(d.errors.length,3);assert.match(d.errors[0].message,/公式/);assert.match(d.errors[2].message,/精度/);});
test('旧模板明确要求升级，空新模板提示至少一人',()=>{const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([['号码','姓名','备注'],['1','甲','']]),'旧');assert.throws(()=>parser.parseRosterExcelBuffer(XLSX.write(b,{type:'buffer',bookType:'xlsx'}),'old.xlsx'),/新版模板/);assert.match(parse([]).errors[0].message,/至少/);});

test('足球特长生列独立于备注，按赛事生成的无运训模板和原八列模板均可解析',()=>{
  const current=parse([['001','甲','1','是','否','是','否','保留备注','是']]);
  assert.equal(current.players[0].is_football_specialty,true);assert.equal(current.players[0].remark,'保留备注');
  for(const headers of [parser.HEADERS.filter(h=>h!=='运训'),parser.HEADERS.slice(0,8)]){
    const b=XLSX.utils.book_new(),values={'学号':'001','姓名':'甲','号码':'1','场上队长':'是','足球特长生':'是','备注':'备注'};
    XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([headers,headers.map(h=>values[h]||'')]),'名单');
    const result=parser.parseRosterExcelBuffer(XLSX.write(b,{type:'buffer',bookType:'xlsx'}),'test.xlsx');
    assert.equal(result.errors.length,0);assert.equal(result.players[0].is_football_specialty,headers.includes('足球特长生'));assert.equal(result.players[0].remark,'备注');
  }
});
