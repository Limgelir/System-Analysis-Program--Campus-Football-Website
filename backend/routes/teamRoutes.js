const express = require('express');
const multer = require('multer');
const router = express.Router();

const teamService = require('../services/teamService');
const seasonService = require('../services/seasonService');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { publicErrorMessage } = require('../utils/publicError');
const {
  parseRosterExcelBuffer,
  validateExtension
} = require('../utils/rosterExcelParser');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    try {
      validateExtension(file.originalname || '');
      cb(null, true);
    } catch (error) {
      cb(error);
    }
  }
});

const rosterUploadFields = upload.fields([
  { name: 'roster_file', maxCount: 1 },
  { name: 'roster_excel', maxCount: 1 },
  { name: 'roster', maxCount: 1 },
  { name: 'file', maxCount: 1 }
]);

function handleRosterUpload(req, res, next) {
  rosterUploadFields(req, res, (error) => {
    if (!error) {
      return next();
    }

    return res.status(400).json({
      code: 400,
      message: publicErrorMessage(error, '名单文件上传失败', 400)
    });
  });
}

function getUploadedRosterFile(req) {
  if (!req.files || typeof req.files !== 'object') {
    return null;
  }

  const fieldOrder = ['roster_file', 'roster_excel', 'roster', 'file'];
  for (const fieldName of fieldOrder) {
    const fileList = req.files[fieldName];
    if (Array.isArray(fileList) && fileList.length > 0) {
      return fileList[0];
    }
  }

  return null;
}

async function requireCurrentSeason(req, res, next) {
  try {
    const currentSeason = await seasonService.getCurrentSeason();
    if (!currentSeason) {
      return res.status(400).json({
        code: 400,
        message: '请先启用赛季'
      });
    }

    req.currentSeason = currentSeason;
    return next();
  } catch (error) {
    return res.status(500).json({
      code: 500,
      message: publicErrorMessage(error, '获取当前赛季失败', 500)
    });
  }
}

const imports=require('../services/teamImportService');
router.get('/:id/current-roster/export', requireAdmin, async (req, res) => {
  try {
    const { team, roster_batch, players } = await teamService.getCurrentRoster(req.params.id);
    const tags = require('../utils/teamTags').TAGS.filter(tag => players.some(p => Object.hasOwn(p, tag.flag)));
    require('../utils/listQuery').sendCsv(res,
      ['赛季', '比赛类型', '队伍', '名单版本', '号码', '姓名', '学院', '队长', '守门员', ...tags.map(t => t.label), '备注'],
      players.map(p => [team.season_name, team.league_type, team.team_name, roster_batch?.version_no, p.jersey_number, p.player_name, p.college, p.is_captain ? '是' : '否', p.is_goalkeeper ? '是' : '否', ...tags.map(t => p[t.flag] ? '是' : '否'), p.remark]));
  } catch (e) { const status = e.statusCode || 400; res.status(status).json({ code: status, message: publicErrorMessage(e, '名单导出失败', status) }); }
});
const wrap=work=>async(req,res)=>{try{res.json({code:200,data:await work(req)});}catch(e){const status=e.statusCode||500;res.status(status).json({code:status,message:publicErrorMessage(e,'名单导入失败',status)});}};
router.get('/import-template',requireAdmin,async(req,res)=>{
  try {
    const XLSX=require('xlsx'), tags=require('../utils/teamTags');
    const config=req.query.season_id&&req.query.league_type?await require('../services/competitionService').requireCompetition(require('../db'),require('../utils/playerRules').id(req.query.season_id),req.query.league_type):{enable_sports_training:true,enable_football_specialty:true};
    const headers=require('../utils/rosterExcelParser').HEADERS.filter(h=>!tags.TAGS.some(t=>t.label===h&&!tags.enabled(config,t.key)));
    const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([headers]);
    sheet['!cols']=headers.map(()=>({wch:18}));
    XLSX.utils.book_append_sheet(book,sheet,'名单');
    res.attachment('名单导入模板.xlsx').send(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
  } catch(e) { const status=e.statusCode||500;res.status(status).json({code:status,message:publicErrorMessage(e,'名单模板生成失败',status)}); }
});
router.post('/import-preview',requireAdmin,handleRosterUpload,wrap(req=>{
  const file=getUploadedRosterFile(req);if(!file)throw require('../utils/playerRules').businessError('请上传新版名单 Excel 文件');
  return imports.preview(req.body,parseRosterExcelBuffer(file.buffer,file.originalname),req.user);
}));
router.post('/import-confirm',requireAdmin,wrap(req=>imports.confirm(req.body,req.user,req.headers['idempotency-key'])));

// 获取当前启用赛季下的队伍列表（可按赛事类型过滤）
router.get('/list', requireAuth, requireCurrentSeason, async (req, res) => {
  try {
    const { league_type } = req.query;

    const teams = league_type
      ? await teamService.getTeamsByLeague(league_type)
      : await teamService.getAllTeams();

    res.json({
      code: 200,
      message: '获取队伍列表成功',
      data: {
        current_season: req.currentSeason,
        teams
      }
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: publicErrorMessage(error, '获取队伍列表失败', 500)
    });
  }
});

// 获取当前启用赛季下的所有队伍
router.get('/all', requireAuth, requireCurrentSeason, async (req, res) => {
  try {
    const teams = await teamService.getAllTeams();

    res.json({
      code: 200,
      message: '获取队伍列表成功',
      data: {
        current_season: req.currentSeason,
        teams
      }
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: publicErrorMessage(error, '获取队伍列表失败', 500)
    });
  }
});

// 仅管理员可为历史赛程读取对应赛季的队伍候选。
router.get('/season/:seasonId', requireAdmin, async (req, res) => {
  try {
    res.json({ code: 200, data: await teamService.getTeamsForSeason(req.params.seasonId) });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ code: status, message: publicErrorMessage(error, '获取赛季队伍失败', status) });
  }
});

// 获取单个队伍
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const team = await teamService.getTeamById(req.params.id);
    res.json({
      code: 200,
      message: '获取队伍信息成功',
      data: team
    });
  } catch (error) {
    res.status(404).json({
      code: 404,
      message: publicErrorMessage(error, '获取队伍信息失败', 404)
    });
  }
});

// 获取当前名单（最新批次）
router.get('/:id/current-roster', requireAuth, async (req, res) => {
  try {
    const result = await teamService.getCurrentRoster(req.params.id);
    res.json({
      code: 200,
      message: '获取当前名单成功',
      data: result
    });
  } catch (error) {
    res.status(404).json({
      code: 404,
      message: publicErrorMessage(error, '获取当前名单失败', 404)
    });
  }
});

// 获取历史名单批次
router.get('/:id/roster-batches', requireAuth, async (req, res) => {
  try {
    const result = await teamService.getRosterBatches(req.params.id);
    res.json({
      code: 200,
      message: '获取历史名单批次成功',
      data: result
    });
  } catch (error) {
    res.status(404).json({
      code: 404,
      message: publicErrorMessage(error, '获取历史名单失败', 404)
    });
  }
});

// 获取某个历史名单批次的球员明细
router.get('/:id/roster-batches/:batchId', requireAuth, async (req, res) => {
  try {
    const result = await teamService.getRosterBatchPlayers(req.params.id, req.params.batchId);
    res.json({
      code: 200,
      message: '获取名单批次球员成功',
      data: result
    });
  } catch (error) {
    res.status(404).json({
      code: 404,
      message: publicErrorMessage(error, '获取名单球员失败', 404)
    });
  }
});

// 旧入口保留明确提示，禁止跳过当前学号关联及预览审核。
router.post('/',requireAdmin,(req,res)=>res.status(400).json({code:400,message:'请使用新版 Excel 导入预览并确认，不能直接导入未关联的名单'}));
router.post('/:id/roster',requireAdmin,(req,res)=>res.status(400).json({code:400,message:'请先预览并确认新名单；不能直接覆盖正式名单'}));

// 修改队伍（管理员）
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { team_name, league_type, description } = req.body;

    const team = await teamService.updateTeam(req.params.id, {
      team_name,
      league_type,
      description
    });

    res.json({
      code: 200,
      message: '队伍更新成功',
      data: team
    });
  } catch (error) {
    res.status(400).json({
      code: 400,
      message: publicErrorMessage(error, '更新队伍失败', 400)
    });
  }
});

// 删除队伍（管理员）
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const result = await teamService.deleteTeam(req.params.id);

    res.json({
      code: 200,
      message: result.message,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      code: 400,
      message: publicErrorMessage(error, '删除队伍失败', 400)
    });
  }
});

module.exports = router;
