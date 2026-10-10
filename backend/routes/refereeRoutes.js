const { safeLog } = require('../utils/safeLog');
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { protectedLogin, sendLoginError } = require('../services/loginSecurityService');
const { requestActor } = require('../utils/securityEvents');
const { validateRefereePassword } = require('../utils/passwordPolicy');
const { publicErrorMessage } = require('../utils/publicError');

const refereeService = require('../services/refereeService');
const { requireReferee, requireRefereeAuth, requireAdmin } = require('../middleware/auth');
const {
  handleRefereePhotoUpload,
  buildRefereePhotoPath,
  removeManagedRefereePhoto
} = require('../utils/refereeUpload');

function ensureSelf(req, res, next) {
  const tokenUserId = String(req.user?.id || '');
  const targetId = String(req.params.id || '');

  if (!tokenUserId || !targetId || tokenUserId !== targetId) {
    return res.status(403).json({
      success: false,
      message: '无权访问其他裁判信息'
    });
  }

  next();
}

async function cleanupNewRefereePhoto(file) {
  if (!file?.filename) return;
  try {
    await removeManagedRefereePhoto(buildRefereePhotoPath(file.filename));
  } catch (cleanupError) {
    safeLog('裁判证件照失败回滚清理异常:', cleanupError, 'warn');
  }
}

// --------------------
// 无需登录即可访问
// --------------------

// 裁判注册
router.post('/register', handleRefereePhotoUpload, async (req, res) => {
  try {
    const {
      student_id,
      name,
      grade,
      target_level,
      level_promoted_at,
      match_types,
      password,
      password_confirm,
      gender,
      college,
      height_cm,
      weight_kg,
      officiated_count_base
    } = req.body;

    if (!student_id || !name || !password || !grade || !target_level) {
      throw new Error('缺少必填字段');
    }

    if (!gender || !college || !height_cm || !weight_kg) {
      throw new Error('性别、学院、身高、体重为必填项');
    }

    if (!req.file) {
      throw new Error('证件照不能为空');
    }

    if (password !== password_confirm) {
      throw new Error('两次密码不一致');
    }

    validateRefereePassword(password);

    const id_photo_path = req.file ? buildRefereePhotoPath(req.file.filename) : null;

    const result = await refereeService.register({
      shanghai_fa_registered: req.body.shanghai_fa_registered,
      student_id,
      name,
      grade,
      target_level,
      level_promoted_at,
      match_types,
      password,
      gender,
      college,
      height_cm: parseInt(height_cm),
      weight_kg: parseFloat(weight_kg),
      id_photo_path,
      officiated_count_base: parseInt(officiated_count_base || 0)
    }, requestActor(req));

    res.status(201).json({
      success: true,
      message: '注册成功',
      data: result
    });
  } catch (error) {
    await cleanupNewRefereePhoto(req.file);
    res.status(400).json({
      success: false,
      message: publicErrorMessage(error, '注册失败', 400)
    });
  }
});

// 裁判登录
router.post('/login', async (req, res) => {
  try {
    const { student_id, password } = req.body;

    const user = await protectedLogin({role:'referee',identifier:student_id,password,ip:req.ip,verify:(...args)=>refereeService.login(...args)});

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
        id: user.id,
        student_id: user.student_id,
        name: user.name,
        role: 'referee',
        tokenVersion: user.token_version,
        mustChangePassword: user.must_change_password
      },
      secret,
      { expiresIn, algorithm: 'HS256' }
    );

    res.status(200).json({
      success: true,
      message: '登录成功',
      data: {
        ...user,
        token
      }
    });
  } catch (error) {
    sendLoginError(res,error);
  }
});

// --------------------
// 裁判自助接口：需要 referee JWT
// --------------------

// 获取所有裁判列表（供裁判端选择执法人员等使用）
router.get('/all', requireReferee, async (req, res) => {
  try {
    const referees = await refereeService.getAllReferees();
    res.status(200).json({
      success: true,
      data: referees
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: publicErrorMessage(error, '获取裁判列表失败', 500)
    });
  }
});

// 获取自己的裁判信息
router.get('/:id', requireReferee, ensureSelf, async (req, res) => {
  try {
    const { id } = req.params;

    const referee = await refereeService.getRefereeById(id);

    res.status(200).json({
      success: true,
      data: referee
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: publicErrorMessage(error, '获取裁判信息失败', 404)
    });
  }
});

// 裁判修改自己的密码
router.put('/:id/password', requireRefereeAuth, ensureSelf, async (req, res) => {
  try {
    const { id } = req.params;
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: '旧密码和新密码不能为空'
      });
    }

    validateRefereePassword(newPassword);

    const result = await refereeService.updatePassword(id, oldPassword, newPassword, requestActor(req));

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

// 独立字段入口，不开放通用资料编辑。
router.put('/:id/shanghai-fa-registration', requireReferee, ensureSelf, async (req, res) => {
  try {
    const data = await refereeService.updateShanghaiFaRegistration(req.params.id, req.body);
    res.json({ success: true, message: '上海足协注册情况已保存', data });
  } catch (error) {
    res.status(400).json({ success: false, message: publicErrorMessage(error, '保存上海足协注册情况失败', 400) });
  }
});

router.put('/:id/grade', requireReferee, ensureSelf, async (req, res) => {
  try {
    const data = await refereeService.updateOwnGrade(req.params.id, req.body);
    res.json({ success: true, message: '当前级别及升入时间已保存', data });
  } catch (error) {
    res.status(400).json({ success: false, message: publicErrorMessage(error, '保存当前级别失败', 400) });
  }
});

router.put('/:id/college', requireReferee, ensureSelf, async (req, res) => {
  try {
    const data = await refereeService.updateOwnCollege(req.params.id, req.body);
    res.json({ success: true, message: '学院已保存', data });
  } catch (error) {
    res.status(400).json({ success: false, message: publicErrorMessage(error, '保存学院失败', 400) });
  }
});

// 其他账号主资料仍由管理员维护，赛季资料通过独立的赛季注册接口提交。
router.put('/:id/profile', requireReferee, ensureSelf, (req, res) => {
  res.status(403).json({
    success: false,
    code: 'REFEREE_PROFILE_ADMIN_ONLY',
    message: '账号主资料注册后仅允许管理员修改'
  });
});

// --------------------
// 兼容保留的管理员端点：需要 admin JWT
// --------------------

// 管理员：添加裁判（不需要密码）
router.post('/admin/add', requireAdmin, async (req, res) => {
  try {
    const { student_id, name, grade, target_level, match_types, level_promoted_at } = req.body;

    if (!student_id || !name) {
      return res.status(400).json({
        code: 400,
        message: '学号和姓名为必填项'
      });
    }

    const referee = await refereeService.addRefereeByAdmin({
      student_id,
      name,
      grade,
      target_level,
      level_promoted_at,
      match_types
    }, requestActor(req));

    res.status(201).json({
      code: 201,
      message: '裁判添加成功',
      data: referee
    });
  } catch (error) {
    res.status(400).json({
      code: 400,
      message: publicErrorMessage(error, '添加裁判失败', 400)
    });
  }
});

// 管理员：修改裁判信息
router.put('/admin/:id', requireAdmin, async (req, res) => {
  try {
    const { name, grade, target_level, level_promoted_at, match_types } = req.body;

    const referee = await refereeService.updateRefereeByAdmin(req.params.id, {
      name,
      grade,
      target_level,
      level_promoted_at,
      match_types
    });

    res.json({
      code: 200,
      message: '裁判信息更新成功',
      data: referee
    });
  } catch (error) {
    res.status(400).json({
      code: 400,
      message: publicErrorMessage(error, '修改裁判失败', 400)
    });
  }
});

// 管理员：删除裁判
router.delete('/admin/:id', requireAdmin, async (req, res) => {
  try {
    const result = await refereeService.deleteRefereeByAdmin(req.params.id, requestActor(req));

    res.json({
      code: 200,
      message: result.message,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      code: 400,
      message: publicErrorMessage(error, '删除裁判失败', 400)
    });
  }
});

module.exports = router;
