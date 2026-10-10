const { safeLog } = require('../utils/safeLog');
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { protectedLogin, sendLoginError } = require('../services/loginSecurityService');
const { requestActor } = require('../utils/securityEvents');
const adminQuery = require('../services/adminQueryService');
const { sendCsv } = require('../utils/listQuery');

const teamService = require('../services/teamService');
const refereeService = require('../services/refereeService');
const adminService = require('../services/adminService');
const { requireAdminAuth, requireAdminSetupComplete } = require('../middleware/auth');
const { publicErrorMessage } = require('../utils/publicError');
const {
  handleRefereePhotoUpload,
  buildRefereePhotoPath,
  removeManagedRefereePhoto
} = require('../utils/refereeUpload');

function parseRefereeId(value) {
  const refereeId = Number(value);
  if (!Number.isInteger(refereeId) || refereeId <= 0) {
    throw new Error('裁判 ID 必须是正整数');
  }
  return refereeId;
}

async function cleanupNewRefereePhoto(file) {
  if (!file?.filename) return;
  try {
    await removeManagedRefereePhoto(buildRefereePhotoPath(file.filename));
  } catch (cleanupError) {
    safeLog('管理员上传证件照失败回滚清理异常:', cleanupError, 'warn');
  }
}

// --------------------
// 无需登录即可访问
// --------------------

// 管理员登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const admin = await protectedLogin({role:'admin',identifier:username,password,ip:req.ip,verify:(...args)=>adminService.login(...args)});

    const secret = process.env.JWT_SECRET;
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

    if (!secret) {
      console.error('JWT_SECRET 未配置');
      return res.status(500).json({
        success: false,
        message: '服务器认证配置缺失'
      });
    }

    const token = jwt.sign(
      {
        id: admin.id,
        username: admin.username,
        role: 'admin',
        tokenVersion: admin.token_version,
        mustChangePassword: admin.must_change_password
      },
      secret,
      { expiresIn, algorithm: 'HS256' }
    );

    res.status(200).json({
      success: true,
      message: '管理员登录成功',
      data: {
        admin_id: admin.id,
        username: admin.username,
        must_change_password: admin.must_change_password,
        token
      }
    });
  } catch (error) {
    sendLoginError(res,error);
  }
});

// --------------------
// 以下接口均需要管理员 JWT
// --------------------
router.use(requireAdminAuth);

// 管理员修改密码
router.put('/password', async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    const adminId = req.user?.id;

    if (!adminId || !oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: '当前密码和新密码不能为空'
      });
    }

    if (newPassword.length < 12) {
      return res.status(400).json({
        success: false,
        message: '管理员密码长度不能少于12位'
      });
    }

    const result = await adminService.updatePassword(adminId, oldPassword, newPassword, requestActor(req));

    res.status(200).json({
      success: true,
      message: result.message
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: publicErrorMessage(error, '密码修改失败', 400)
    });
  }
});

// 被标记为必须改密的管理员只能访问上面的密码接口。
router.use(requireAdminSetupComplete);

// ====== 队伍管理 ======

// 获取队伍列表（按赛事类型过滤）
router.get('/team/list', async (req, res) => {
  try {
    const { league_type } = req.query;

    let teams;
    if (league_type) {
      teams = await teamService.getTeamsByLeague(league_type);
    } else {
      teams = await teamService.getAllTeams();
    }

    res.json({
      code: 200,
      message: '获取队伍列表成功',
      data: teams
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: publicErrorMessage(error, '获取队伍列表失败', 500)
    });
  }
});

// 新增队伍
router.post('/team', async (req, res) => {
  try {
    const { team_name, league_type, description } = req.body;

    if (!team_name || !league_type) {
      return res.status(400).json({
        code: 400,
        message: '队伍名称和赛事类型为必填项'
      });
    }

    const team = await teamService.addTeam({
      team_name,
      league_type,
      description
    });

    res.status(201).json({
      code: 201,
      message: '队伍创建成功',
      data: team
    });
  } catch (error) {
    res.status(400).json({
      code: 400,
      message: publicErrorMessage(error, '创建队伍失败', 400)
    });
  }
});

// 修改队伍
router.put('/team/:id', async (req, res) => {
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

// 删除队伍
router.delete('/team/:id', async (req, res) => {
  try {
    const result = await teamService.deleteTeam(req.params.id);

    res.json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: publicErrorMessage(error, '删除队伍失败', 400)
    });
  }
});

// ====== 裁判管理 ======

// 获取所有裁判列表
router.get('/referee/all', async (req, res) => {
  try {
    const result = await adminQuery.listAccounts(req.query);

    res.json({
      code: 200,
      message: '获取裁判列表成功',
      data: result.items,
      meta: {pagination:result.pagination,summary:result.summary,current_season:result.current_season}
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      code: error.statusCode || 500,
      message: publicErrorMessage(error, '获取裁判列表失败', error.statusCode || 500)
    });
  }
});

router.get('/referee/export', async (req,res) => {
  try {
    const {items} = await adminQuery.listAccounts(req.query,true);
    sendCsv(res,['姓名','学号','学院','当前级别','目标级别','账号状态','是否在上海足协注册','当前赛季注册状态','执法经历'],
      items.map(r=>[r.name,r.student_id,r.college,r.grade,r.target_level,r.is_active?'启用':'停用',r.shanghai_fa_registered?'是':'否',r.season_registration_label,r.match_types]));
  }catch(error){res.status(error.statusCode||500).json({success:false,message:publicErrorMessage(error,'导出失败',error.statusCode||500)});}
});

// 获取裁判详情（管理员）
router.get('/referee/:id', async (req, res) => {
  try {
    const referee = await refereeService.getRefereeById(parseRefereeId(req.params.id));
    res.json({
      code: 200,
      message: '获取裁判详情成功',
      data: referee
    });
  } catch (error) {
    res.status(404).json({
      code: 404,
      message: publicErrorMessage(error, '获取裁判详情失败', 404)
    });
  }
});

const parseMatchTypes = (value) => {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [trimmed];
      } catch (error) {
        return trimmed.split(',').map(item => item.trim()).filter(Boolean);
      }
    }
    return trimmed.split(',').map(item => item.trim()).filter(Boolean);
  }
  return [];
};

// 新增裁判（管理员）
router.post('/referee', handleRefereePhotoUpload, async (req, res) => {
  try {
    const {
      student_id,
      name,
      grade,
      target_level,
      level_promoted_at,
      match_types,
      gender,
      college,
      height_cm,
      weight_kg,
      officiated_count_base
    } = req.body;

    if (!student_id || !name || !grade || !target_level) {
      throw new Error('学号、姓名、当前级别和目标级别为必填项');
    }

    if (!gender || !college || !height_cm || !weight_kg) {
      throw new Error('性别、学院、身高、体重为必填项');
    }

    if (!req.file) {
      throw new Error('证件照不能为空');
    }

    const normalizedMatchTypes = parseMatchTypes(match_types);

    if (!Array.isArray(normalizedMatchTypes) || normalizedMatchTypes.length === 0) {
      throw new Error('请至少选择一种比赛种类');
    }

    const id_photo_path = req.file ? buildRefereePhotoPath(req.file.filename) : null;

    const referee = await refereeService.addRefereeByAdmin({
      student_id,
      name,
      grade,
      target_level,
      level_promoted_at,
      match_types: normalizedMatchTypes,
      gender,
      college,
      height_cm: parseInt(height_cm),
      weight_kg: parseFloat(weight_kg),
      id_photo_path,
      officiated_count_base: parseInt(officiated_count_base || 0)
    }, requestActor(req));

    res.status(201).json({
      code: 201,
      message: '裁判添加成功',
      data: referee
    });
  } catch (error) {
    await cleanupNewRefereePhoto(req.file);
    res.status(400).json({
      code: 400,
      message: publicErrorMessage(error, '添加裁判失败', 400)
    });
  }
});

// 修改裁判信息（管理员）
router.put('/referee/:id', handleRefereePhotoUpload, async (req, res) => {
  try {
    const {
      name,
      grade,
      target_level,
      level_promoted_at,
      match_types,
      gender,
      college,
      height_cm,
      weight_kg,
      officiated_count_base
    } = req.body;
    const refereeId = parseRefereeId(req.params.id);
    const existingReferee = await refereeService.getRefereeById(refereeId);
    const id_photo_path = req.file ? buildRefereePhotoPath(req.file.filename) : undefined;

    const referee = await refereeService.updateRefereeByAdmin(refereeId, {
      name,
      grade,
      target_level,
      level_promoted_at,
      match_types: match_types === undefined ? undefined : parseMatchTypes(match_types),
      gender,
      college,
      height_cm,
      weight_kg,
      id_photo_path,
      officiated_count_base
    });

    if (req.file && existingReferee.id_photo_path && existingReferee.id_photo_path !== id_photo_path) {
      try {
        await removeManagedRefereePhoto(existingReferee.id_photo_path);
      } catch (cleanupError) {
        safeLog('旧裁判证件照清理失败:', cleanupError, 'warn');
      }
    }

    res.json({
      code: 200,
      message: '裁判信息更新成功',
      data: referee
    });
  } catch (error) {
    await cleanupNewRefereePhoto(req.file);
    res.status(400).json({
      code: 400,
      message: publicErrorMessage(error, '更新裁判失败', 400)
    });
  }
});

// 启用或停用裁判账号；状态变化时递增令牌版本，使所有旧 JWT 立即失效。
router.patch('/referee/:id/status', async (req, res) => {
  try {
    const refereeId = parseRefereeId(req.params.id);
    const value = req.body?.is_active;
    if (![true, false, 1, 0, '1', '0'].includes(value)) {
      throw new Error('is_active 必须是布尔值');
    }
    const referee = await refereeService.setActiveByAdmin(
      refereeId,
      value === true || value === 1 || value === '1', requestActor(req)
    );
    res.json({
      code: 200,
      message: referee.is_active ? '裁判账号已启用' : '裁判账号已停用',
      data: referee
    });
  } catch (error) {
    res.status(400).json({
      code: 400,
      message: publicErrorMessage(error, '更新裁判账号状态失败', 400)
    });
  }
});

router.post('/referee/:id/reset-password', async (req, res) => {
  try {
    const refereeId = parseRefereeId(req.params.id);
    const result = await refereeService.resetPasswordByAdmin(refereeId, requestActor(req));
    res.json({
      code: 200,
      message: '裁判密码已重置，所有旧登录令牌已失效',
      data: result
    });
  } catch (error) {
    res.status(400).json({
      code: 400,
      message: publicErrorMessage(error, '重置裁判密码失败', 400)
    });
  }
});

// 删除裁判（管理员）
router.delete('/referee/:id', async (req, res) => {
  try {
    const refereeId = parseRefereeId(req.params.id);
    const existingReferee = await refereeService.getRefereeById(refereeId);
    const result = await refereeService.deleteRefereeByAdmin(refereeId, requestActor(req));

    if (existingReferee.id_photo_path) {
      try {
        await removeManagedRefereePhoto(existingReferee.id_photo_path);
      } catch (cleanupError) {
        safeLog('裁判删除后证件照清理失败:', cleanupError, 'warn');
      }
    }

    res.json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: publicErrorMessage(error, '删除裁判失败', 400)
    });
  }
});


module.exports = router;
