const { safeLog } = require('../utils/safeLog');
const express = require('express');
const router = express.Router();

const seasonService = require('../services/seasonService');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { publicErrorMessage } = require('../utils/publicError');

/**
 * 获取当前启用赛季（已登录用户可读）
 */
router.get('/current', requireAuth, async (req, res) => {
  try {
    const season = await seasonService.getCurrentSeason();

    if (!season) {
      return res.status(404).json({
        success: false,
        message: '当前没有启用中的赛季'
      });
    }

    res.json({
      success: true,
      message: '获取当前赛季成功',
      data: season
    });
  } catch (error) {
    safeLog('获取当前赛季失败:', error, 'error');
    res.status(500).json({
      success: false,
      message: publicErrorMessage(error, '获取当前赛季失败', 500)
    });
  }
});

/**
 * 以下接口仅管理员可用
 */
router.use(requireAdmin);

/**
 * 获取全部赛季
 */
router.get('/', async (req, res) => {
  try {
    const seasons = await seasonService.getAllSeasons();
    res.json({
      success: true,
      message: '获取赛季列表成功',
      data: seasons
    });
  } catch (error) {
    safeLog('获取赛季列表失败:', error, 'error');
    res.status(500).json({
      success: false,
      message: publicErrorMessage(error, '获取赛季列表失败', 500)
    });
  }
});

/**
 * 新增赛季
 */
router.post('/', async (req, res) => {
  try {
    const { season_code, season_name, start_date, end_date, is_active } = req.body;

    const season = await seasonService.createSeason({
      season_code,
      season_name,
      start_date,
      end_date,
      is_active
    });

    res.status(201).json({
      success: true,
      message: '赛季创建成功',
      data: season
    });
  } catch (error) {
    safeLog('创建赛季失败:', error, 'error');
    res.status(400).json({
      success: false,
      message: publicErrorMessage(error, '创建赛季失败', 400)
    });
  }
});

/**
 * 启用赛季
 */
router.put('/:id/activate', async (req, res) => {
  try {
    const season = await seasonService.activateSeason(req.params.id);
    res.json({
      success: true,
      message: '赛季启用成功',
      data: season
    });
  } catch (error) {
    safeLog('启用赛季失败:', error, 'error');
    const status = error.message === '赛季不存在' || error.message === '无效的赛季ID' ? 404 : 400;
    res.status(status).json({
      success: false,
      message: publicErrorMessage(error, '启用赛季失败', status)
    });
  }
});

/**
 * 停用赛季
 */
router.put('/:id/deactivate', async (req, res) => {
  try {
    const season = await seasonService.deactivateSeason(req.params.id);
    res.json({
      success: true,
      message: '赛季停用成功',
      data: season
    });
  } catch (error) {
    safeLog('停用赛季失败:', error, 'error');
    const status = error.message === '赛季不存在' || error.message === '无效的赛季ID' ? 404 : 400;
    res.status(status).json({
      success: false,
      message: publicErrorMessage(error, '停用赛季失败', status)
    });
  }
});

module.exports = router;
