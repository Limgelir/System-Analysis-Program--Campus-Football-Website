const jwt = require('jsonwebtoken');
const adminService = require('../services/adminService');
const refereeService = require('../services/refereeService');
const playerService = require('../services/playerService');

function getTokenFromHeader(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token;
}

async function authenticate(req, res, next) {
  try {
    const token = getTokenFromHeader(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: '未提供认证令牌'
      });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('JWT_SECRET 未配置');
      return res.status(500).json({
        success: false,
        message: '服务器认证配置缺失'
      });
    }

    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (!['admin','referee','player'].includes(decoded.role) || !Number.isSafeInteger(decoded.id) || decoded.id <= 0 || !Number.isSafeInteger(decoded.tokenVersion) || decoded.tokenVersion < 0) {
      return res.status(401).json({success:false,message:'认证失败或令牌已过期'});
    }
    req.user = decoded;

    if (decoded.role === 'admin') {
      const state = await adminService.getSecurityState(decoded.id);
      if (!state || Number(decoded.tokenVersion) !== Number(state.token_version)) {
        return res.status(401).json({
          success: false,
          message: '管理员会话已失效，请重新登录'
        });
      }
      req.user.adminMustChangePassword = Boolean(state.must_change_password);
    }

    if (decoded.role === 'referee') {
      const state = await refereeService.getSecurityState(decoded.id);
      if (!state || !state.is_active || Number(decoded.tokenVersion) !== Number(state.token_version)) {
        return res.status(401).json({
          success: false,
          message: '裁判会话已失效，请重新登录'
        });
      }
      req.user.refereeMustChangePassword = Boolean(state.must_change_password);
    }

    if (decoded.role === 'player') {
      const state = await playerService.getSecurityState(decoded.id);
      if (!state || !state.is_active || decoded.tokenVersion !== state.token_version) {
        return res.status(401).json({success:false,message:'球员会话已失效，请重新登录'});
      }
      req.user.playerMustChangePassword = Boolean(state.must_change_password);
    }
    req.authenticatedActor = { id: decoded.id, role: decoded.role };
    next();
  } catch (error) {
    if (!['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error.name)) {
      require('../utils/safeLog').safeLog('authentication_backend_failed', error);
      return res.status(503).json({ success: false, message: '认证服务暂不可用，请稍后重试' });
    }
    return res.status(401).json({
      success: false,
      message: '认证失败或令牌已过期'
    });
  }
}

function requireAdminSetupComplete(req, res, next) {
  if (req.user?.role === 'admin' && req.user?.adminMustChangePassword) {
    return res.status(403).json({
      success: false,
      code: 'ADMIN_PASSWORD_CHANGE_REQUIRED',
      message: '必须先修改管理员密码'
    });
  }
  next();
}

function requireRefereeSetupComplete(req, res, next) {
  if (req.user?.role === 'referee' && req.user?.refereeMustChangePassword) {
    return res.status(403).json({
      success: false,
      code: 'REFEREE_PASSWORD_CHANGE_REQUIRED',
      message: '必须先修改裁判账号密码'
    });
  }
  next();
}

function requireAuth(req, res, next) {
  authenticate(req, res, function onAuthed() {
    // 历史requireAuth仅属于裁判/管理员边界。新球员接口使用专门中间件，
    // 不因新增一种合法JWT而开放旧名单、赛程、报告、图片及审核历史。
    if (!['admin','referee'].includes(req.user.role)) {
      return res.status(403).json({success:false,message:'无权访问此功能'});
    }
    requireAdminSetupComplete(req, res, function onAdminReady() {
      requireRefereeSetupComplete(req, res, next);
    });
  });
}

function requireRole(role, authMiddleware = requireAuth) {
  return function roleMiddleware(req, res, next) {
    authMiddleware(req, res, function onAuthed() {
      if (!req.user || req.user.role !== role) {
        return res.status(403).json({
          success: false,
          message: role === 'admin' ? '无管理员权限' : role === 'player' ? '无球员权限' : '无裁判权限'
        });
      }

      next();
    });
  };
}

const requireAdminAuth = requireRole('admin', authenticate);
const requireRefereeAuth = requireRole('referee', authenticate);
const requireAdmin = requireRole('admin');
const requireReferee = requireRole('referee');
const requirePlayerAuth = requireRole('player', authenticate);
function requirePlayer(req,res,next) {
  requirePlayerAuth(req,res,()=>{
    if (req.user.playerMustChangePassword) return res.status(403).json({success:false,code:'PLAYER_PASSWORD_CHANGE_REQUIRED',message:'请先修改临时密码'});
    next();
  });
}

module.exports = {
  authenticate,
  requireAuth,
  requireAdminAuth,
  requireRefereeAuth,
  requireAdmin,
  requireAdminSetupComplete,
  requireRefereeSetupComplete,
  requireReferee,
  requirePlayerAuth,
  requirePlayer,
  requireRole
};
