const express=require('express');
const service=require('../services/playerPublicService');
const {requirePlayer,requireAdmin}=require('../middleware/auth');
const {safeLog}=require('../utils/safeLog');
function handle(work){return async(req,res)=>{try{res.json({success:true,data:await work(req)});}catch(e){if(!e.isBusinessError)safeLog('player_public_failed',e);res.status(e.isBusinessError?e.statusCode||400:500).json({success:false,message:e.isBusinessError?e.message:'查询失败，请稍后重试'});}};}
const publicRouter=express.Router();
publicRouter.get('/competitions',handle(req=>require('../services/competitionService').list(req.query.season_id)));
publicRouter.get('/seasons',handle(()=>service.seasons()));
publicRouter.get('/teams',handle(req=>service.teams(req.query)));
publicRouter.get('/teams/:id',handle(req=>service.detail(req.params.id)));
publicRouter.get('/matches/:id',handle(req=>service.matchDetail(req.params.id)));
for(const feature of ['scorers','standings'])publicRouter.get('/'+feature,handle(req=>service.extension(feature,req.query)));
const player=express.Router();
player.get('/my-teams',requirePlayer,handle(req=>service.mine(req.user,req.query)));
player.get('/team-results/:id',requirePlayer,handle(async req=>{const d=await service.detail(req.params.id);return {...d,...await service.matches(d.team.id,undefined,req.user.id)};}));
const admin=express.Router();
admin.get('/competition-format',requireAdmin,handle(req=>service.extension('competition-format',req.query)));
module.exports={publicRouter,player,admin};
