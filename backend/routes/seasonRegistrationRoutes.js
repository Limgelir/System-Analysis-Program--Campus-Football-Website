const express = require('express');
const router = express.Router();

const seasonRegistrationService = require('../services/seasonRegistrationService');
const { requireAdmin, requireReferee } = require('../middleware/auth');
const { publicErrorMessage } = require('../utils/publicError');

function sendError(res, error, fallback = '赛季注册操作失败') {
  const status = Number(error?.statusCode || 400);
  res.status(status >= 400 && status < 600 ? status : 500).json({
    success: false,
    code: error?.code || 'SEASON_REGISTRATION_ERROR',
    message: publicErrorMessage(error, fallback, status)
  });
}

// 裁判：读取当前赛季、当前申请状态和账号资料预填值。
router.get('/current', requireReferee, async (req, res) => {
  try {
    const data = await seasonRegistrationService.getCurrentForReferee(req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, '获取当前赛季注册状态失败');
  }
});

// 裁判：首次提交，或在 rejected / returned 后修改快照并重新提交。
router.post('/current/submit', requireReferee, async (req, res) => {
  try {
    const data = await seasonRegistrationService.submitCurrent(req.user.id, req.body);
    res.status(201).json({
      success: true,
      message: data.application_version === 1 ? '赛季注册申请已提交' : '赛季注册申请已重新提交',
      data
    });
  } catch (error) {
    sendError(res, error, '提交赛季注册申请失败');
  }
});

// 以下端点全部需要管理员身份；eligibile 必须定义在 /:id 之前。
router.get('/admin/eligible', requireAdmin, async (req, res) => {
  try {
    const data = await seasonRegistrationService.listEligible({
      seasonId: req.query.season_id,
      query: req.query.query,
      matchType: req.query.match_type,
      page: req.query.page,
      pageSize: req.query.page_size
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, '获取可选派裁判失败');
  }
});

router.get('/admin', requireAdmin, async (req, res) => {
  try {
    const data = await seasonRegistrationService.listForAdmin({
      seasonId: req.query.season_id,
      status: req.query.status,
      query: req.query.query,
      grade: req.query.grade,
      matchType: req.query.match_type,
      page: req.query.page,
      pageSize: req.query.page_size
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, '获取赛季注册申请列表失败');
  }
});

router.get('/admin/export', requireAdmin, async (req,res) => {
  try {
    const data=await seasonRegistrationService.listForAdmin({seasonId:req.query.season_id,status:'approved',query:req.query.query,grade:req.query.grade,matchType:req.query.match_type,exporting:true});
    require('../utils/listQuery').sendCsv(res,['赛季','姓名（当季）','学号','学院（当季）','级别（当季）','身高','体重','执法经历（当季）','账号状态','可选派'],
      data.items.map(r=>[data.season.season_name,r.name_snapshot,r.student_id,r.college_snapshot,r.grade_snapshot,r.height_cm_snapshot,r.weight_kg_snapshot,r.match_types_snapshot,r.account_is_active?'启用':'停用',r.is_eligible?'是':'否']));
  }catch(e){sendError(res,e,'导出赛季名单失败');}
});

router.get('/admin/:id', requireAdmin, async (req, res) => {
  try {
    const data = await seasonRegistrationService.getDetailForAdmin(req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, '获取赛季注册申请详情失败');
  }
});

router.post('/admin/:id/approve', requireAdmin, async (req, res) => {
  try {
    const data = await seasonRegistrationService.review(
      req.params.id,
      req.user.id,
      'approve',
      req.body?.reason ?? req.body?.comment
    );
    res.json({ success: true, message: '赛季注册申请已通过', data });
  } catch (error) {
    sendError(res, error, '通过赛季注册申请失败');
  }
});

router.post('/admin/:id/reject', requireAdmin, async (req, res) => {
  try {
    const data = await seasonRegistrationService.review(
      req.params.id,
      req.user.id,
      'reject',
      req.body?.reason
    );
    res.json({ success: true, message: '赛季注册申请已驳回', data });
  } catch (error) {
    sendError(res, error, '驳回赛季注册申请失败');
  }
});

router.post('/admin/:id/return', requireAdmin, async (req, res) => {
  try {
    const data = await seasonRegistrationService.review(
      req.params.id,
      req.user.id,
      'return',
      req.body?.reason
    );
    res.json({ success: true, message: '已退回赛季注册申请', data });
  } catch (error) {
    sendError(res, error, '退回赛季注册申请失败');
  }
});

module.exports = router;
