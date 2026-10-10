const express = require('express');
const jwt = require('jsonwebtoken');
const player = require('../services/playerService');
const pool = require('../db');
const { protectedLogin, sendLoginError } = require('../services/loginSecurityService');
const { requirePlayerAuth, requirePlayer } = require('../middleware/auth');
const { safeLog } = require('../utils/safeLog');
const rules = require('../utils/playerRules');
const router = express.Router();
router.use((req,res,next)=>{ res.set('Cache-Control','no-store'); next(); });

function handler(work, status = 200) {
  return async (req,res) => {
    try { res.status(status).json({success:true,data:await work(req)}); }
    catch (error) {
      const code=error.isBusinessError ? error.statusCode || 400 : 500;
      if (!error.isBusinessError) safeLog('player_request_failed',error);
      res.status(code).json({success:false,code:error.isBusinessError?error.code:'INTERNAL_ERROR',message:error.isBusinessError?error.message:'操作失败，请稍后再试'});
    }
  };
}
router.post('/register',handler(req=>player.register(req.body,{ip:req.ip}),201));
router.post('/login',async(req,res)=>{
  try {
    const account=await protectedLogin({role:'player',identifier:req.body?.student_id,password:req.body?.password,ip:req.ip,verify:(...args)=>player.login(...args)});
    const {token_version,...data}=account;
    const token=jwt.sign({id:account.id,role:'player',tokenVersion:token_version},process.env.JWT_SECRET,{algorithm:'HS256',expiresIn:process.env.JWT_EXPIRES_IN||'7d'});
    res.json({success:true,data:{...data,token}});
  } catch(error) { sendLoginError(res,error); }
});
router.put('/me/gender',requirePlayerAuth,handler(req=>player.setGender(req.user.id,req.body,rules.revision(req.get('If-Match')),req.user)));
router.get('/me',requirePlayerAuth,handler(req=>player.getProfile(req.user.id)));
router.put('/me/password',requirePlayerAuth,handler(req=>player.changePassword(req.user.id,req.body,rules.revision(req.get('If-Match')),req.user)));
router.post('/logout',requirePlayerAuth,handler(req=>player.logout(req.user.id,rules.revision(req.get('If-Match')),req.user)));
router.use(requirePlayer);
router.put('/me',handler(req=>player.updateProfile(req.user.id,req.body,rules.revision(req.get('If-Match')),req.user)));
router.put('/me/student-id',handler(req=>player.changeStudentId(req.user.id,req.body,rules.revision(req.get('If-Match')),req.user)));
router.get('/context',handler(async()=>{
  const [[season]]=await pool.execute('SELECT id,season_name,season_code,start_date,end_date FROM seasons WHERE is_active=1 LIMIT 1');
  return {season:season||null,features:{season_registration:true,team_registration:true,public_matches:true,scorers:false,standings:false},message:season?'请在个人注册开放时间内提交本季学籍材料。':'暂无启用赛季，账号可以正常使用。'};
}));
module.exports=router;
module.exports.handler=handler;
