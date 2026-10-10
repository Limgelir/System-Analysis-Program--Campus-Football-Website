const express=require('express');
const {requireAuth,requireAdmin}=require('../middleware/auth');
const {revision}=require('../utils/playerRules');
const {safeLog}=require('../utils/safeLog');
const service=require('../services/disciplineService');
const router=express.Router();
function handle(work){return async(req,res)=>{try{res.json({success:true,data:await work(req)});}catch(e){if(!e.statusCode)safeLog('competition_failed',e);res.status(e.statusCode||500).json({success:false,message:e.statusCode?e.message:'赛事操作失败，请稍后重试'});}};}
router.get('/',requireAuth,handle(req=>require('../services/competitionService').list(req.query.season_id)));
router.get('/matches/:id/discipline',requireAuth,handle(async req=>{
  const match=await require('../services/scheduleService').getScheduleById(req.params.id);
  if(!match)throw require('../utils/playerRules').businessError('比赛不存在',404);
  require('../utils/reportAccess').ensureViewerCanReadReport(match,req.user);
  return service.forMatch(req.params.id);
}));
router.get('/:id/discipline',requireAdmin,handle(req=>service.summary(req.params.id)));
for(const operation of ['reset','adjust'])router.post('/:id/discipline/'+operation,requireAdmin,handle(req=>service.mutate(req.params.id,req.user,revision(req.get('If-Match')),req.body,operation)));
module.exports=router;
