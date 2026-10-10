const { safeLog } = require('../utils/safeLog');
const express = require('express');
const router = express.Router();
const reportService = require('../services/reportService');
const { requireAuth, requireReferee, requireAdmin } = require('../middleware/auth');
const {
  uploadFourthOfficialImage,
  buildFourthOfficialImagePath,
  removeManagedReportUpload
} = require('../utils/reportUpload');
const {
  assertStoredImageSignature,
  removeStoredFile
} = require('../utils/imageFileSecurity');
const { publicErrorMessage } = require('../utils/publicError');

function buildViewer(req) {
  return {
    id: req.user?.id,
    role: req.user?.role,
    expected_revision: req.get('If-Match')
  };
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

function runFourthOfficialUpload(req, res) {
  return new Promise((resolve, reject) => {
    uploadFourthOfficialImage.single('fourth_official_image')(req, res, async error => {
      if (error) {
        reject(error)
        return
      }
      try {
        if (req.file) await assertStoredImageSignature(req.file)
        resolve()
      } catch (validationError) {
        await removeStoredFile(req.file)
        req.file = undefined
        reject(validationError)
      }
    })
  })
}

router.get('/admin/schedule/:scheduleId/rosters',requireAdmin,async(req,res)=>{try{res.json({success:true,data:await require('../services/matchRosterService').detail(req.params.scheduleId,req.user)});}catch(e){res.status(e.statusCode||400).json({success:false,message:publicErrorMessage(e,'获取比赛名单失败',e.statusCode||400)});}});
router.put('/admin/schedule/:scheduleId/rosters',requireAdmin,async(req,res)=>{try{res.json({success:true,data:await require('../services/matchRosterService').change(req.params.scheduleId,req.user,req.body)});}catch(e){res.status(e.statusCode||400).json({success:false,message:publicErrorMessage(e,'修改比赛名单失败',e.statusCode||400)});}});
router.get('/schedule/:scheduleId', requireAuth, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const data = await reportService.getReportByScheduleId(parseScheduleId(scheduleId), buildViewer(req));
    res.json({ success: true, data });
  } catch (error) {
    safeLog('获取报告详情失败:', error, 'error');
    const status = error.statusCode || 400;
    res.status(status).json({ success: false, message: publicErrorMessage(error, '获取报告失败', status) });
  }
});

router.post('/schedule/:scheduleId/main', requireReferee, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const userId = req.user.id;
    const data = await reportService.updateMainReport(parseScheduleId(scheduleId), userId, req.body, buildViewer(req));
    res.json({ success: true, data, message: '裁判员信息保存成功' });
  } catch (error) {
    safeLog('裁判员信息保存失败:', error, 'error');
    const status = error.statusCode || 400;
    res.status(status).json({ success: false, message: publicErrorMessage(error, '裁判员信息保存失败', status) });
  }
});

router.post('/schedule/:scheduleId/main/submit', requireReferee, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const userId = req.user.id;
    const data = await reportService.submitMainReport(parseScheduleId(scheduleId), userId, buildViewer(req));
    res.json({ success: true, data, message: '裁判员报告提交成功' });
  } catch (error) {
    safeLog('裁判员报告提交失败:', error, 'error');
    const status = error.statusCode || 400;
    res.status(status).json({ success: false, message: publicErrorMessage(error, '裁判员报告提交失败', status) });
  }
});


router.post('/schedule/:scheduleId/fourth-official-image', requireReferee, async (req, res) => {
  try {
    await runFourthOfficialUpload(req, res);

    const { scheduleId } = req.params;
    const userId = req.user.id;
    const data = await reportService.uploadFourthOfficialImage(parseScheduleId(scheduleId), userId, req.file, buildViewer(req));
    res.json({ success: true, data, message: '第四官员记录单上传成功' });
  } catch (error) {
    if (req.file?.filename) {
      try {
        await removeManagedReportUpload(buildFourthOfficialImagePath(req.file.filename));
      } catch (cleanupError) {
        safeLog('第四官员记录单上传失败后清理文件失败:', cleanupError, 'warn');
      }
    }
    safeLog('第四官员记录单上传失败:', error, 'error');
    const status = error.statusCode || 400;
    res.status(status).json({ success: false, message: publicErrorMessage(error, '第四官员记录单上传失败', status) });
  }
});

router.delete('/schedule/:scheduleId/fourth-official-image', requireReferee, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const userId = req.user.id;
    const data = await reportService.removeFourthOfficialImage(parseScheduleId(scheduleId), userId, buildViewer(req));
    res.json({ success: true, data, message: '第四官员记录单删除成功' });
  } catch (error) {
    safeLog('第四官员记录单删除失败:', error, 'error');
    const status = error.statusCode || 400;
    res.status(status).json({ success: false, message: publicErrorMessage(error, '第四官员记录单删除失败', status) });
  }
});

router.post('/schedule/:scheduleId/supervisor', requireReferee, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const userId = req.user.id;
    const data = await reportService.updateSupervisorReport(parseScheduleId(scheduleId), userId, req.body, buildViewer(req));
    res.json({ success: true, data, message: '裁判监督内容保存成功' });
  } catch (error) {
    safeLog('裁判监督内容保存失败:', error, 'error');
    const status = error.statusCode || 400;
    res.status(status).json({ success: false, message: publicErrorMessage(error, '裁判监督内容保存失败', status) });
  }
});

router.post('/schedule/:scheduleId/supervisor/submit', requireReferee, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const userId = req.user.id;
    const data = await reportService.submitSupervisorReport(parseScheduleId(scheduleId), userId, buildViewer(req));
    res.json({ success: true, data, message: '裁判监督报告提交成功' });
  } catch (error) {
    safeLog('裁判监督报告提交失败:', error, 'error');
    const status = error.statusCode || 400;
    res.status(status).json({ success: false, message: publicErrorMessage(error, '裁判监督报告提交失败', status) });
  }
});

// 专用管理员代填入口；普通裁判入口不接受管理员身份，也不从请求体读取操作者。
for (const operation of ['main', 'main/submit', 'supervisor', 'supervisor/submit', 'fourth-official-image']) {
  router.post(`/admin/schedule/:scheduleId/${operation}`, requireAdmin, async (req, res) => {
    try {
      const id = parseScheduleId(req.params.scheduleId), viewer = buildViewer(req);
      let data;
      if (operation === 'main') data = await reportService.updateMainReport(id, viewer.id, req.body, viewer);
      else if (operation === 'main/submit') data = await reportService.submitMainReport(id, viewer.id, viewer);
      else if (operation === 'supervisor') data = await reportService.updateSupervisorReport(id, viewer.id, req.body, viewer);
      else if (operation === 'supervisor/submit') data = await reportService.submitSupervisorReport(id, viewer.id, viewer);
      else {
        // 上传前先进行身份/来源校验，事务内仍会再次检查锁定状态。
        const report = await reportService.getReportByScheduleId(id, viewer);
        if (!report.viewer_permissions.can_proxy_main || report.report.main_report_status === 'submitted') {
          return res.status(403).json({ success: false, message: '只允许为未提交的非系统裁判员报告上传图片' });
        }
        await runFourthOfficialUpload(req, res);
        data = await reportService.uploadFourthOfficialImage(id, viewer.id, req.file, viewer);
      }
      res.json({ success: true, data, message: '管理员代填操作成功' });
    } catch (e) {
      if (req.file) await removeStoredFile(req.file);
      const status = e.statusCode || 400;
      res.status(status).json({ success: false, code: e.code, message: publicErrorMessage(e, '管理员代填失败', status) });
    }
  });
}
router.delete('/admin/schedule/:scheduleId/fourth-official-image', requireAdmin, async (req, res) => {
  try {
    const viewer = buildViewer(req);
    const data = await reportService.removeFourthOfficialImage(parseScheduleId(req.params.scheduleId), viewer.id, viewer);
    res.json({ success: true, data });
  } catch (e) {
    const status = e.statusCode || 400;
    res.status(status).json({ success: false, message: publicErrorMessage(e, '删除图片失败', status) });
  }
});
router.get('/schedule/:scheduleId/history/:section',requireAuth,async(req,res)=>{
  try {
    const data = await reportService.getSectionHistory(parseScheduleId(req.params.scheduleId),req.params.section,buildViewer(req),req.query);
    res.json({success:true,data});
  } catch(e) {
    const status=e.statusCode||400;
    res.status(status).json({success:false,code:e.code,message:publicErrorMessage(e,'读取历史失败',status)});
  }
});
router.get('/schedule/:scheduleId/history-entry/:historyId',requireAuth,async(req,res)=>{
  try {
    const data = await reportService.getHistoryDetail(parseScheduleId(req.params.scheduleId),Number(req.params.historyId),buildViewer(req));
    res.json({success:true,data});
  } catch(e) {
    const status=e.statusCode||400;
    res.status(status).json({success:false,code:e.code,message:publicErrorMessage(e,'读取历史详情失败',status)});
  }
});
for (const operation of ['return','revise']) {
  router.post(`/admin/schedule/:scheduleId/sections/:section/${operation}`,requireAdmin,async(req,res)=>{
    try {
      const method=operation === 'return'?'returnReportSection':'reviseReportSection';
      const data=await reportService[method](parseScheduleId(req.params.scheduleId),req.params.section,buildViewer(req),req.body);
      res.json({success:true,data});
    } catch(e) {
      const status=e.statusCode||400;
      res.status(status).json({success:false,code:e.code,message:publicErrorMessage(e,'管理员报告操作失败',status)});
    }
  });
}
for (const method of ['post','delete']) {
  router[method]('/admin/schedule/:scheduleId/revision-image',requireAdmin,async(req,res)=>{
    try {
      if (method === 'post') await runFourthOfficialUpload(req,res);
      const data=await reportService.reviseReportImage(parseScheduleId(req.params.scheduleId),buildViewer(req),req.body,req.file,method === 'delete');
      res.json({success:true,data});
    } catch(e) {
      if (req.file) await removeStoredFile(req.file);
      const status=e.statusCode||400;
      res.status(status).json({success:false,code:e.code,message:publicErrorMessage(e,'第四官员记录单修订失败',status)});
    }
  });
}
module.exports = router;
