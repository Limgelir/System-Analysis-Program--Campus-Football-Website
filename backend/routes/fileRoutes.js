const fs = require('fs');
const express = require('express');
const pool = require('../db');
const scheduleService = require('../services/scheduleService');
const { requireAuth } = require('../middleware/auth');
const { ensureViewerCanReadReport } = require('../utils/reportAccess');
const { resolveManagedRefereePhoto } = require('../utils/refereeUpload');
const { resolveManagedReportUploadPath } = require('../utils/reportUpload');
const { publicErrorMessage } = require('../utils/publicError');
const reportService = require('../services/reportService');

const router = express.Router();

function parsePositiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error(`${label}必须是正整数`);
    error.statusCode = 400;
    throw error;
  }
  return id;
}

async function sendPrivateFile(res, absolutePath, immutable = false) {
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    const error = new Error('文件不存在');
    error.statusCode = 404;
    throw error;
  }
  // 当前图的 URL 不变，替换后不能继续命中旧缓存；版本图片才允许短期私有缓存。
  res.setHeader('Cache-Control', immutable ? 'private, max-age=300, no-transform' : 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  await new Promise((resolve, reject) => {
    res.sendFile(absolutePath, error => error ? reject(error) : resolve());
  });
}

router.get('/referee-photo/:refereeId', requireAuth, async (req, res) => {
  try {
    const refereeId = parsePositiveId(req.params.refereeId, '裁判ID');
    const isAdmin = req.user?.role === 'admin';
    const isSelf = req.user?.role === 'referee' && Number(req.user.id) === refereeId;
    if (!isAdmin && !isSelf) {
      return res.status(403).json({ success: false, message: '无权查看该证件照' });
    }

    const [rows] = await pool.execute(
      'SELECT id_photo_path FROM referee_profile WHERE referee_id = ? LIMIT 1',
      [refereeId]
    );
    const absolutePath = resolveManagedRefereePhoto(rows[0]?.id_photo_path);
    await sendPrivateFile(res, absolutePath);
  } catch (error) {
    if (!res.headersSent) {
      const status = error.statusCode || 500;
      res.status(status).json({ success: false, message: publicErrorMessage(error, '读取证件照失败', status) });
    }
  }
});

router.get('/report/:scheduleId/fourth-official-image', requireAuth, async (req, res) => {
  try {
    const scheduleId = parsePositiveId(req.params.scheduleId, '赛程ID');
    const schedule = await scheduleService.getScheduleById(scheduleId);
    if (!schedule) {
      return res.status(404).json({ success: false, message: '赛程不存在' });
    }
    ensureViewerCanReadReport(schedule, { id: req.user?.id, role: req.user?.role });

    const [rows] = await pool.execute(
      'SELECT fourth_official_image_path FROM match_reports WHERE schedule_id = ? LIMIT 1',
      [scheduleId]
    );
    const absolutePath = resolveManagedReportUploadPath(rows[0]?.fourth_official_image_path);
    await sendPrivateFile(res, absolutePath);
  } catch (error) {
    if (!res.headersSent) {
      const status = error.statusCode || 500;
      res.status(status).json({ success: false, message: publicErrorMessage(error, '读取第四官员记录单失败', status) });
    }
  }
});

router.get('/report/:scheduleId/history/:historyId/:side/image', requireAuth, async (req,res)=>{
  try {
    if (!['before','after'].includes(req.params.side)) return res.status(400).json({success:false,message:'历史图片方向无效'});
    const entry = await reportService.getHistoryDetail(parsePositiveId(req.params.scheduleId,'赛程ID'),parsePositiveId(req.params.historyId,'历史ID'),{id:req.user.id,role:req.user.role});
    const imagePath = entry[`${req.params.side}_snapshot`]?.data?.fourth_official_image_path;
    await sendPrivateFile(res,resolveManagedReportUploadPath(imagePath),true);
  } catch(error) {
    if (!res.headersSent) {
      const status=error.statusCode||500;
      res.status(status).json({success:false,message:publicErrorMessage(error,'读取历史图片失败',status)});
    }
  }
});
module.exports = router;
