const path = require('node:path');
const XLSX = require('xlsx');
const rules = require('./playerRules');
const r = require('./teamApplicationRules');
const HEADERS = ['学号','姓名','号码','场上队长','守门员','外援','运训','备注','足球特长生'];
const ALLOWED_EXTENSIONS = ['.xls','.xlsx'];
function validateExtension(name) {
  const ext=path.extname(String(name)).toLowerCase();
  if(!ALLOWED_EXTENSIONS.includes(ext))throw rules.businessError('仅支持 .xls 和 .xlsx 格式的名单文件');
  return ext;
}
function flag(value) {
  if(['','否','0'].includes(value))return false;
  if(['是','1'].includes(value))return true;
  throw rules.businessError('角色及标记只能填写是、否、1、0或留空');
}
function parseWorkbook(book, name) {
  const sheetName=book.SheetNames?.[0], sheet=book.Sheets?.[sheetName];
  if(!sheet?.['!ref'])throw rules.businessError('Excel 首个工作表没有名单');
  const range=XLSX.utils.decode_range(sheet['!ref']);
  const value=(row,col)=>String(sheet[XLSX.utils.encode_cell({r:row,c:col})]?.v??'').trim();
  const headers=Array.from({length:range.e.c+1},(_,col)=>value(0,col));
  const required=HEADERS.filter(h=>!['运训','足球特长生'].includes(h));
  if(required.some(h=>!headers.includes(h))||new Set(headers).size!==headers.length||headers.some(h=>!HEADERS.includes(h)))throw rules.businessError('请下载新版模板，保留学号、姓名、号码、场上队长、守门员、外援和备注列');
  const sourceColumns=HEADERS.map(h=>headers.indexOf(h));
  // 遍历真实单元格坐标，保留空行后的行号；不按固定人数截断。
  const players=[],errors=[],numbers=new Map(),students=new Map();
  for(let row=1;row<=range.e.r;row++){
    const values=sourceColumns.map(col=>col<0?'':value(row,col));
    if(values.every(v=>!v)&&!sourceColumns.some(col=>col>=0&&sheet[XLSX.utils.encode_cell({r:row,c:col})]?.f))continue;
    try {
      sourceColumns.filter(col=>col>=0).forEach(col=>{const cell=sheet[XLSX.utils.encode_cell({r:row,c:col})];if(cell?.f)throw rules.businessError('名单字段不能使用公式，请粘贴为文本或值');});
      const idCell=sheet[XLSX.utils.encode_cell({r:row,c:sourceColumns[0]})];
      if(idCell?.t==='n'&&(!Number.isSafeInteger(idCell.v)||String(idCell.v).length>15))throw rules.businessError('学号的数字精度可能丢失，请按文本重新填写');
      const student_id=rules.studentId(values[0]),jersey_number=r.number(values[2],true);
      if(students.has(student_id))throw rules.businessError(`学号与第 ${students.get(student_id)} 行重复`);
      if(numbers.has(jersey_number))throw rules.businessError(`号码与第 ${numbers.get(jersey_number)} 行重复（01与1视为同号）`);
      const item={row_number:row+1,student_id,player_name:r.text(values[1],'姓名',100),jersey_number,...Object.fromEntries(r.FLAGS.map((f,i)=>[f,flag(values[f==='is_football_specialty'?8:i+3])])),remark:r.text(values[7],'备注',255,true)};
      players.push(item);students.set(student_id,row+1);numbers.set(jersey_number,row+1);
    }catch(e){if(!e.isBusinessError)throw e;errors.push({row_number:row+1,message:e.message});}
  }
  if(!players.length&&!errors.length)errors.push({row_number:null,message:'名单至少需要一名球员'});
  return {source_name:path.basename(name),sheet_name:sheetName,players,errors,player_count:players.length,inspected_row_range:{start:2,end:range.e.r+1}};
}
function parseRosterExcelBuffer(buffer,name='roster.xlsx') {
  validateExtension(name);if(!Buffer.isBuffer(buffer))throw rules.businessError('缺少 Excel 文件内容');
  let book;try{book=XLSX.read(buffer,{type:'buffer',cellDates:false});}catch{throw rules.businessError('Excel 文件无法读取，请使用完整的新版模板');}
  return parseWorkbook(book,name);
}
function parseRosterExcelFile(file,name=path.basename(file)){return parseRosterExcelBuffer(require('node:fs').readFileSync(file),name);}
module.exports={HEADERS,ALLOWED_EXTENSIONS,validateExtension,parseRosterExcelBuffer,parseRosterExcelFile};
