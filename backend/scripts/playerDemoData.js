// 可在无浏览器的服务器生成明确标注 TEST DATA 的虚构 PNG，不含真实个人资料。
const zlib = require('node:zlib');
const crypto = require('node:crypto');
function image() {
  const width=480,height=160,pixels=Buffer.alloc((width*3+1)*height,245);
  for(let y=0;y<height;y++)pixels[y*(width*3+1)]=0;
  const glyphs={T:['11111','00100','00100','00100','00100','00100','00100'],E:['11111','10000','10000','11110','10000','10000','11111'],S:['01111','10000','10000','01110','00001','00001','11110'],D:['11110','10001','10001','10001','10001','10001','11110'],A:['01110','10001','10001','11111','10001','10001','10001']};
  [...'TEST DATA'].forEach((ch,i)=>glyphs[ch]?.forEach((row,y)=>[...row].forEach((v,x)=>{if(v==='1')for(let dy=0;dy<6;dy++)for(let dx=0;dx<6;dx++){const at=(50+y*6+dy)*(width*3+1)+1+(75+i*36+x*6+dx)*3;pixels.fill(40,at,at+3);}})));
  const crc=b=>{let n=0xffffffff;for(const v of b){n^=v;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,-4)),out.length-4);return out;};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
function parseArguments(argv) {
  const [command,...args]=argv,values={};
  if(!['plan','append'].includes(command))throw Error('必须指定 plan 或 append；本工具没有清空模式');
  for(const arg of args){const m=/^--(batch|size|admin-id)=(.+)$/.exec(arg);if(!m||Object.hasOwn(values,m[1]))throw Error('未知或重复参数');values[m[1]]=m[2];}
  if(!/^[a-z0-9][a-z0-9-]{2,15}$/.test(values.batch||''))throw Error('batch 必须为3—16位小写字母、数字或连字符');
  if(!['small','large'].includes(values.size||'small'))throw Error('size 必须是 small 或 large');
  if(!/^[1-9]\d*$/.test(values['admin-id']||'')||!Number.isSafeInteger(Number(values['admin-id'])))throw Error('必须指定有效 admin-id，不新建管理员');
  return {command,batch:values.batch,size:values.size||'small',adminId:Number(values['admin-id'])};
}
function definitions(batch,size){
  const count=size==='large'?500:24;
  return Array.from({length:count},(_,i)=>({student_id:`PD-${batch}-${String(i+1).padStart(3,'0')}`,name:`测试${batch}球员${i+1}`,college:`虚构学院${i%12+1}`,
    status:i===0||i===count-1?'unsubmitted':i===count-2?'withdrawn':i===count-3?'revoked':i===count-4?'returned':i===count-5?'pending':'approved',
    purpose:i===0?'不参赛负责人':i===1?'场上队长、进球统计':i===2?'普通球员，外援和运训双标记':i>=count-5?'个人申请状态测试':'已审核球员，可按学号添加',password:`Demo!9${crypto.randomBytes(12).toString('base64url')}`}));
}
module.exports={image,parseArguments,definitions};
