const express=require('express');
const {requirePlayer,requireAdmin}=require('../middleware/auth');
const {handler}=require('./playerRoutes');
const rules=require('../utils/playerRules');
const service=require('../services/playerCollegeChangeService');
const upload=require('../utils/playerAcademicUpload');
const version=req=>rules.revision(req.get('If-Match'));
async function sendFile(req,res) {
  try { const item=await service.file(req.params.id,req.user);res.set({'Cache-Control':'private, no-store','Content-Type':item.mime,'X-Content-Type-Options':'nosniff'});await new Promise((resolve,reject)=>res.sendFile(item.path,e=>e?reject(e):resolve())); }
  catch(e) { if(!res.headersSent)res.status(e.isBusinessError?e.statusCode:e.code==='ENOENT'?404:500).json({success:false,message:e.isBusinessError?e.message:'截图文件不可用，请联系管理员'}); }
}
const player=express.Router();player.use(requirePlayer);
player.get('/current',handler(req=>service.current(req.user,req.query)));
player.post('/',upload.middleware,handler(req=>service.submit(req.user,req.body,req.get('Idempotency-Key'),req.file,req.academicImage),201));
player.get('/:id',handler(req=>service.detail(req.params.id,req.user)));
player.get('/:id/image',sendFile);
player.post('/:id/withdraw',handler(req=>service.withdraw(req.params.id,req.user,req.body,version(req))));
const admin=express.Router();admin.use(requireAdmin);
admin.get('/',handler(req=>service.list(req.query)));
admin.get('/:id',handler(req=>service.detail(req.params.id,req.user)));
admin.get('/:id/image',sendFile);
for(const action of ['approve','return'])admin.post(`/:id/${action}`,handler(req=>service.review(req.params.id,action,req.user,req.body,version(req))));
module.exports={player,admin};
