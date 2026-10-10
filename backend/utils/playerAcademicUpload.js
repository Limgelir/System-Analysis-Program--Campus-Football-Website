const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const multer=require('multer');
const {UPLOAD_ROOT}=require('./uploadPaths');
const {signatureMatches,extensionForImageMime}=require('./imageFileSecurity');
const rules=require('./playerRules');
const DIRECTORY=path.join(UPLOAD_ROOT,'player-academic');
const MAX_BYTES=5*1024*1024;
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_BYTES,files:1,fields:2,parts:4,fieldSize:100},fileFilter:(req,file,cb)=>cb(extensionForImageMime(file.mimetype)?null:rules.businessError('仅支持 JPG/PNG 图片'),true)}).single('academic_image');
function validate(file){
  if(!file?.buffer||!file.size)throw rules.businessError('请上传一张1系统学籍信息截图');
  if(!signatureMatches(file.buffer,file.mimetype))throw rules.businessError('文件内容与 JPG/PNG 图片格式不符');
  // 沿用现有图片签名验证，并拒绝仅有文件头的截断图片。
  const png=file.mimetype==='image/png';
  if(png?(file.size<45||file.buffer.toString('ascii',12,16)!=='IHDR'||file.buffer.toString('ascii',file.size-8,file.size-4)!=='IEND'):(file.size<12||file.buffer[file.size-2]!==255||file.buffer[file.size-1]!==217))throw rules.businessError('图片不完整，请重新选择 JPG/PNG 截图');
  return {mime:png?'image/png':'image/jpeg',extension:png?'.png':'.jpg',sha256:crypto.createHash('sha256').update(file.buffer).digest('hex')};
}
function middleware(req,res,next){upload(req,res,error=>{
  try{if(error)throw error;req.academicImage=validate(req.file);next();}
  catch(e){req.file=undefined;res.status(400).json({success:false,code:'PLAYER_IMAGE_INVALID',message:e.code==='LIMIT_FILE_SIZE'?'图片不能超过5MB':e.code?.startsWith('LIMIT_')?'请只上传一张截图，并核对提交字段':e.message||'截图上传失败'});}
});}
function resolve(stored){if(typeof stored!=='string'||!/^player-academic\/[a-f0-9-]{36}\.(png|jpg)$/.test(stored))throw rules.businessError('材料文件不存在',404);return path.join(DIRECTORY,path.basename(stored));}
async function save(file,meta){await fs.mkdir(DIRECTORY,{recursive:true,mode:0o700});const stored=`player-academic/${crypto.randomUUID()}${meta.extension}`;await fs.writeFile(resolve(stored),file.buffer,{flag:'wx',mode:0o600});return stored;}
async function remove(stored){try{await fs.unlink(resolve(stored));}catch(e){if(e.code!=='ENOENT')throw e;}}
module.exports={middleware,validate,resolve,save,remove,DIRECTORY,MAX_BYTES};
