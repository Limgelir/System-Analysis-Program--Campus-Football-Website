const router=require('express').Router();
const service=require('../services/matchSignupService');
const {requireReferee,requireAdmin}=require('../middleware/auth');
const {createBusinessError}=require('../utils/scheduleValidator');
const {publicErrorMessage}=require('../utils/publicError');
const id=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw createBusinessError('比赛或报名编号无效');return n;};
const handle=fn=>async(req,res)=>{try{res.json({success:true,data:await fn(req)});}catch(e){const status=e.statusCode||500;res.status(status).json({success:false,code:e.code,message:publicErrorMessage(e,'报名操作失败，请重试',status)});}};
router.get('/',requireReferee,handle(req=>service.list(req.user.id,req.query)));
router.get('/memberships/:competitionId',requireReferee,handle(req=>require('../services/refereeMembershipService').read(req.user.id,id(req.params.competitionId))));
router.put('/memberships/:competitionId',requireReferee,handle(req=>require('../services/refereeMembershipService').save(req.user.id,id(req.params.competitionId),req.body)));
router.get('/assignment-board',requireAdmin,handle(req=>require('../services/assignmentBoardService').list(req.query)));
router.get('/assignment-board/export',requireAdmin,async(req,res)=>{
  try {
    const {dayFilters,assignmentDayTable}=require('../utils/assignmentDayExport');
    const {schedules}=await require('../services/scheduleService').listAdminSchedules(dayFilters(req.query));
    if(!schedules.length)throw createBusinessError('该赛事在这个比赛日暂无比赛，请刷新后重试');
    const {headers,rows}=assignmentDayTable(schedules);
    require('../utils/listQuery').sendCsv(res,headers,rows);
  } catch(e) {
    const status=e.statusCode||500;
    res.status(status).json({success:false,message:publicErrorMessage(e,'导出失败，请重试',status)});
  }
});
router.put('/:scheduleId',requireReferee,handle(req=>service.mutate(req.user.id,id(req.params.scheduleId),req.body)));
router.get('/admin/:scheduleId',requireAdmin,handle(req=>service.adminList(id(req.params.scheduleId),req.query)));
router.get('/admin/:scheduleId/:signupId/history',requireAdmin,handle(req=>service.history(id(req.params.scheduleId),id(req.params.signupId))));
module.exports=router;
