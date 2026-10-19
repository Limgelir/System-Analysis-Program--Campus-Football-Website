const { safeLog } = require('../utils/safeLog');
const express = require('express');
const router = express.Router();
const scheduleService = require('../services/scheduleService');
const { requireAdmin, requireAuth, requireReferee } = require('../middleware/auth');
const { ensureViewerCanReadReport } = require('../utils/reportAccess');
const { publicErrorMessage } = require('../utils/publicError');
const {sendCsv} = require('../utils/listQuery');
const scheduleImports = require('../services/scheduleImportService');
const importUpload = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 6, fieldSize: 100000 } }).single('file');
const importResult = work => async (req, res) => {
  try { res.json({ success: true, data: await work(req) }); }
  catch (e) { const status = e.statusCode || 500; res.status(status).json({ success: false, message: publicErrorMessage(e, '赛程导入失败', status) }); }
};
router.get('/import-template', requireAdmin, (req, res, next) => {
  res.download(require('node:path').resolve(__dirname, '../../赛程导入模板.xlsx'), '赛程导入模板.xlsx', error => { if (error) next(error); });
});
router.post('/import-preview', requireAdmin, (req, res, next) => {
  importUpload(req, res, error => error ? res.status(400).json({ success: false, message: error.code === 'LIMIT_FILE_SIZE' ? '文件不能超过2MB' : '文件上传失败，请检查文件与导入选项' }) : next());
}, importResult(req => {
  if (!req.file) throw require('../utils/scheduleValidator').createBusinessError('请上传赛程文件');
  return scheduleImports.preview(req.body, require('../utils/scheduleImportParser').parseScheduleImport(req.file.buffer, req.file.originalname), req.user);
}));
router.post('/import-confirm', requireAdmin, importResult(req => scheduleImports.confirm(req.body, req.user)));

router.get('/workbench',requireAdmin,async(req,res)=>{
  try{res.json({success:true,data:await scheduleService.workbench(req.query.season_id)});}
  catch(e){res.status(e.statusCode||500).json({success:false,message:publicErrorMessage(e,'读取工作台失败',e.statusCode||500)});}
});
router.get('/export',requireAdmin,async(req,res)=>{
  try{
    const {schedules}=await scheduleService.listAdminSchedules({...req.query,seasonId:req.query.season_id,exporting:true});
    const roles=require('../utils/officialAssignments').ROLES;
    sendCsv(res,['赛季','比赛类型','裁判安排','日期','比赛时间','比赛场地','场序','主队','客队',...roles.flatMap(r=>[r.label+'姓名',r.label+'来源']),'裁判员报告','裁判监督报告'],
      schedules.map(s=>[s.season_name,s.match_type,s.futsal?'五人制':'普通',s.match_date,require('../utils/matchTime').displayMatchTime(s.match_time,s.match_end_time),require('../utils/matchVenue').displayVenue(s),s.field_order,s.team_a_name_snapshot,s.team_b_name_snapshot,...roles.flatMap(r=>{
        if(r.code==='supervisor'&&!s.supervisor_required)return ['无需裁判监督',''];
        if(r.code==='fourth'&&!s.fourth_required)return ['无需第四官员',''];
        if(!require('../utils/officialRequirements').roleRequired(s,r.code))return ['不适用',''];
        const official=s.officials.find(a=>a.role===r.code);
        return [official?.name_snapshot||'',official?(official.source_type==='external'?'非系统':'系统'):'未选派'];
      }),s.report_main_status,s.supervisor_required?s.report_supervisor_status:'无需裁判监督报告']));
  }catch(e){res.status(e.statusCode||500).json({success:false,message:publicErrorMessage(e,'导出失败',e.statusCode||500)});}
});

function buildSchedulePayload(body = {}) {
  const payload = scheduleService.normalizeScheduleMutationPayload(body);
  for(const field of require('../utils/scheduleValidator').SCHEDULE_ROLE_FIELDS)if(!Object.hasOwn(body,field))delete payload[field];
  return payload;
}

function buildScheduleAssignmentPayload(body = {}) {
  const contract = scheduleService.getFieldContract();
  const roleFields = Array.isArray(contract.role_fields) && contract.role_fields.length > 0
    ? contract.role_fields
    : ['main_referee_id', 'assistant1_id', 'assistant2_id', 'fourth_official_id', 'supervisor_id'];

  const payload = {schedule_revision:body.schedule_revision,confirm_format_change:body.confirm_format_change===true};
  if(Object.hasOwn(body,'futsal'))payload.futsal=body.futsal;
  if (Object.hasOwn(body, 'fourth_required')) payload.fourth_required = body.fourth_required;
  if (Object.hasOwn(body, 'supervisor_required')) payload.supervisor_required = body.supervisor_required;
  for (const field of roleFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = body[field];
    }
  }

  if (Object.hasOwn(body, 'confirm_distinct_people')) payload.confirm_distinct_people = body.confirm_distinct_people;
  return payload;
}

function parseScheduleId(value) {
  const scheduleId = Number(value);
  if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
    const error = new Error('赛程 ID 必须是正整数');
    error.statusCode = 400;
    throw error;
  }
  return scheduleId;
}


function buildPhase3Meta(extra = {}) {
  return {
    schedule_contract_version: scheduleService.getFieldContract().version,
    canonical_business_entry: 'schedule-only',
    canonical_backend_routes: 'scheduleRoutes',
    canonical_backend_service: 'scheduleService',
    phase_3_status: 'sealed',
    legacy_match_write_frozen: true,
    ...extra
  };
}

function extractTokenRefereeId(req) {
  const refereeId = Number.parseInt(req.user?.id, 10);
  if (Number.isNaN(refereeId) || refereeId <= 0) {
    return null;
  }
  return refereeId;
}

router.get('/contract', requireAuth, async (req, res) => {
  try {
    res.json({
      success: true,
      data: scheduleService.getFieldContract()
    });
  } catch (error) {
    safeLog('获取赛程字段契约错误:', error, 'error');
    res.status(500).json({
      success: false,
      message: '获取赛程字段契约失败'
    });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const payload = buildSchedulePayload(req.body);
    const schedule = await scheduleService.createSchedule(payload);

    res.json({
      success: true,
      message: '赛程添加成功',
      data: schedule,
      meta: {
        ...buildPhase3Meta()
      }
    });
  } catch (error) {
    if (error.code === 'FIELD_ORDER_CONFLICT') {
      try {
        const preview = await scheduleImports.previewSingle(buildSchedulePayload(req.body), req.user);
        return res.status(409).json({ success: false, code: 'SCHEDULE_REPLACEMENT_CONFIRM_REQUIRED', message: '同场序赛程已存在，请确认是否替换', data: preview });
      } catch (replacementError) { error = replacementError; }
    }
    safeLog('创建赛程错误:', error, 'error');
    res.status(error.statusCode || 400).json({
      success: false,
      code: error.code || 'SCHEDULE_CREATE_FAILED',
      message: publicErrorMessage(error, '添加赛程失败', error.statusCode || 400)
    });
  }
});

router.get('/', requireAdmin, async (req, res) => {
  try {
    const { schedules, ...context } = await scheduleService.listAdminSchedules({ ...req.query, seasonId: req.query.season_id });
    res.json({
      success: true,
      data: schedules,
      meta: buildPhase3Meta({
        list_scope: 'admin-season',
        ...context
      })
    });
  } catch (error) {
    safeLog('获取赛程错误:', error, 'error');
    res.status(error.statusCode || 500).json({
      success: false,
      message: publicErrorMessage(error, '获取赛程失败', error.statusCode || 500)
    });
  }
});

router.get('/type/:matchType', requireAdmin, async (req, res) => {
  try {
    const { matchType } = req.params;
    const { schedules, ...context } = await scheduleService.listAdminSchedules({
      ...req.query, matchType, seasonId: req.query.season_id
    });
    res.json({
      success: true,
      data: schedules,
      meta: buildPhase3Meta({
        list_scope: 'admin-season-filtered',
        ...context,
        match_type: matchType
      })
    });
  } catch (error) {
    safeLog('获取赛程错误:', error, 'error');
    res.status(error.statusCode || 500).json({
      success: false,
      message: publicErrorMessage(error, '获取赛程失败', error.statusCode || 500)
    });
  }
});

router.get('/available/:matchType', requireAuth, async (req, res) => {
  try {
    const { matchType } = req.params;
    await scheduleService.getAvailableSchedules(matchType);

    res.status(410).json({
      success: false,
      message: 'getAvailableSchedules 已在阶段 3-0.4 停用，请改用 /schedule 或 /schedule/type/:matchType',
      meta: buildPhase3Meta({
        endpoint_status: 'disabled',
        replacement_endpoint: matchType ? `/schedule/type/${matchType}` : '/schedule'
      })
    });
  } catch (error) {
    safeLog('获取可用赛程错误:', error, 'error');
    res.status(error.statusCode || 410).json({
      success: false,
      message: publicErrorMessage(error, '获取可用赛程失败', error.statusCode || 410),
      meta: buildPhase3Meta({
        endpoint_status: 'disabled',
        replacement_endpoint: req.params.matchType ? `/schedule/type/${req.params.matchType}` : '/schedule'
      })
    });
  }
});

router.get('/my-assignments', requireReferee, async (req, res) => {
  try {
    const refereeId = extractTokenRefereeId(req);

    if (!refereeId) {
      return res.status(401).json({
        success: false,
        message: '裁判身份无效，无法获取我的执法列表'
      });
    }

    const schedules = await scheduleService.listSchedulesForReferee(refereeId);

    res.json({
      success: true,
      data: schedules,
      meta: buildPhase3Meta({
        list_scope: 'referee-self',
        referee_id: refereeId
      })
    });
  } catch (error) {
    safeLog('获取我的执法列表错误:', error, 'error');
    res.status(error.statusCode || 500).json({
      success: false,
      message: publicErrorMessage(error, '获取我的执法列表失败', error.statusCode || 500)
    });
  }
});

router.get('/my-stat-trends', requireReferee, async (req, res) => {
  try {
    const refereeId = extractTokenRefereeId(req);

    if (!refereeId) {
      return res.status(401).json({
        success: false,
        message: '裁判身份无效，无法获取执法变化数据'
      });
    }

    const trends = await scheduleService.listStatTrendsForReferee(refereeId);

    res.json({
      success: true,
      data: trends,
      meta: buildPhase3Meta({
        list_scope: 'referee-self-stat-trends',
        referee_id: refereeId
      })
    });
  } catch (error) {
    safeLog('获取执法变化数据错误:', error, 'error');
    res.status(error.statusCode || 500).json({
      success: false,
      message: publicErrorMessage(error, '获取执法变化数据失败', error.statusCode || 500)
    });
  }
});

router.get('/:scheduleId/fourth-official-sheet', requireAdmin, async (req, res) => {
  try {
    const { buffer, filename } = await require('../services/fourthOfficialSheetService').generate(parseScheduleId(req.params.scheduleId), req.query.template);
    res.set('Cache-Control', 'no-store');
    res.type(require('../utils/fourthOfficialDocument').MIME);
    res.set('Content-Disposition', `attachment; filename="fourth-official.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  } catch (error) {
    safeLog('生成四官单错误:', error, 'error');
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: publicErrorMessage(error, '生成四官单失败，请重试', status) });
  }
});

router.get('/:scheduleId', requireAuth, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const schedule = await scheduleService.getScheduleById(parseScheduleId(scheduleId));

    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: '赛程不存在'
      });
    }

    ensureViewerCanReadReport(schedule, {
      id: req.user?.id,
      role: req.user?.role
    });

    res.json({
      success: true,
      data: schedule,
      meta: buildPhase3Meta({
        detail_scope: 'schedule-main-info-referees-report'
      })
    });
  } catch (error) {
    safeLog('获取赛程详情错误:', error, 'error');
    res.status(error.statusCode || 500).json({
      success: false,
      message: publicErrorMessage(error, '获取赛程详情失败', error.statusCode || 500)
    });
  }
});


router.post('/:scheduleId/assignment-warnings', requireAdmin, async (req,res) => {
  try {
    const schedule = await scheduleService.getScheduleById(parseScheduleId(req.params.scheduleId));
    if (!schedule) return res.status(404).json({success:false,message:'赛程不存在'});
    const warnings = await require('../services/assignmentWarningService').warnings(require('../db'),schedule,buildScheduleAssignmentPayload(req.body));
    res.json({success:true,data:warnings});
  } catch (error) { res.status(error.statusCode||400).json({success:false,message:publicErrorMessage(error,'读取时间重合提示失败',error.statusCode||400)}); }
});

router.put('/:scheduleId/assign-referees', requireAdmin, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const payload = buildScheduleAssignmentPayload(req.body);
    const schedule = await scheduleService.assignReferees(parseScheduleId(scheduleId), payload, req.user);

    res.json({
      success: true,
      message: '裁判选派更新成功',
      data: schedule,
      meta: buildPhase3Meta({
        write_scope: 'admin-assignment',
        assignment_patch_fields: Object.keys(payload)
      })
    });
  } catch (error) {
    safeLog('裁判选派错误:', error, 'error');
    res.status(error.statusCode || 400).json({
      success: false,
      code: error.code || 'SCHEDULE_ASSIGNMENT_FAILED',
      message: publicErrorMessage(error, '裁判选派失败', error.statusCode || 400)
    });
  }
});

router.delete('/:scheduleId', requireAdmin, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const result = await scheduleService.deleteSchedule(parseScheduleId(scheduleId), req.body?.schedule_revision);

    res.json({
      success: true,
      message: '赛程删除成功',
      data: result,
      meta: buildPhase3Meta({
        delete_rule: 'before-kickoff-only'
      })
    });
  } catch (error) {
    safeLog('删除赛程错误:', error, 'error');
    res.status(error.statusCode || 400).json({
      success: false,
      code: error.code || 'SCHEDULE_DELETE_FAILED',
      message: publicErrorMessage(error, '删除赛程失败', error.statusCode || 400)
    });
  }
});

router.put('/:scheduleId', requireAdmin, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const payload = buildSchedulePayload(req.body);
    const schedule = await scheduleService.updateSchedule(parseScheduleId(scheduleId), payload, req.user);

    res.json({
      success: true,
      message: '赛程更新成功',
      data: schedule,
      meta: {
        ...buildPhase3Meta()
      }
    });
  } catch (error) {
    safeLog('更新赛程错误:', error, 'error');
    res.status(error.statusCode || 400).json({
      success: false,
      code: error.code || 'SCHEDULE_UPDATE_FAILED',
      message: publicErrorMessage(error, '更新赛程失败', error.statusCode || 400)
    });
  }
});

module.exports = router;
