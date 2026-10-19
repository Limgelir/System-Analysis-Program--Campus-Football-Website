const { createBusinessError } = require('./scheduleValidator');

const REPORT_ROLE_DEFINITIONS = Object.freeze({
  admin: {
    label: '管理员',
    code: 'admin',
    key: 'admin'
  },
  main: {
    label: '裁判员',
    code: 'main',
    key: 'main_referee_id'
  },
  assistant1: {
    label: '第一助理裁判员',
    code: 'assistant1',
    key: 'assistant1_id'
  },
  assistant2: {
    label: '第二助理裁判员',
    code: 'assistant2',
    key: 'assistant2_id'
  },
  fourth: {
    label: '第四官员',
    code: 'fourth',
    key: 'fourth_official_id'
  },
  second: {label:'第二裁判员',code:'second',key:'second_referee_id'},
  timekeeper: {label:'计时员',code:'timekeeper',key:'timekeeper_id'},
  supervisor: {
    label: '裁判监督',
    code: 'supervisor',
    key: 'supervisor_id'
  }
});

function toNullableInt(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeViewerContext(viewer = {}) {
  return {
    id: toNullableInt(viewer.id),
    role: typeof viewer.role === 'string' ? viewer.role : null
  };
}

function resolveAssignedRoleCode(schedule, userId) {
  if (!schedule) {
    return null;
  }

  const normalizedUserId = toNullableInt(userId);
  if (!normalizedUserId || normalizedUserId <= 0) {
    return null;
  }

  if (toNullableInt(schedule.main_referee_id) === normalizedUserId) return 'main';
  if (toNullableInt(schedule.assistant1_id) === normalizedUserId) return 'assistant1';
  if (toNullableInt(schedule.assistant2_id) === normalizedUserId) return 'assistant2';
  if (toNullableInt(schedule.fourth_official_id) === normalizedUserId) return 'fourth';
  if (toNullableInt(schedule.second_referee_id) === normalizedUserId) return 'second';
  if (toNullableInt(schedule.timekeeper_id) === normalizedUserId) return 'timekeeper';
  if (toNullableInt(schedule.supervisor_id) === normalizedUserId) return 'supervisor';

  return null;
}

function resolveAssignedRoleCodes(schedule,userId){
  const id=toNullableInt(userId);if(!id)return [];
  return Object.values(REPORT_ROLE_DEFINITIONS).filter(r=>r.code!=='admin'&&toNullableInt(schedule?.[r.key])===id&&
    (r.code!=='supervisor'||require('./supervisionRules').required(schedule?.supervisor_required))).map(r=>r.code);
}
function buildViewerContext(schedule, viewer = {}) {
  const normalizedViewer = normalizeViewerContext(viewer);
  const isAdmin = normalizedViewer.role === 'admin';
  const assignedRoleCodes=normalizedViewer.role==='referee'?resolveAssignedRoleCodes(schedule,normalizedViewer.id):[];
  const assignedRoleCode=assignedRoleCodes[0]||null;
  const roleDefinition = isAdmin
    ? REPORT_ROLE_DEFINITIONS.admin
    : (assignedRoleCode ? REPORT_ROLE_DEFINITIONS[assignedRoleCode] : null);

  const canView = Boolean(roleDefinition);
  const canProxyMain = isAdmin && schedule?.officials?.some(a => a.role === 'main' && a.source_type === 'external');
  const canEditMain = roleDefinition?.code === 'main' || Boolean(canProxyMain);
  const supervisorRequired=require('./supervisionRules').required(schedule?.supervisor_required);
  const canProxySupervisor=isAdmin&&supervisorRequired&&schedule?.officials?.some(a=>a.role==='supervisor'&&a.source_type==='external');
  const canEditSupervisor=supervisorRequired&&(assignedRoleCodes.includes('supervisor')||Boolean(canProxySupervisor));
  const permissions = {
    can_view: canView,
    can_edit_main: canEditMain,
    can_proxy_main: Boolean(canProxyMain),
    can_edit_supervisor: canEditSupervisor,
    can_proxy_supervisor: Boolean(canProxySupervisor),
    can_read_all_reviews: isAdmin||assignedRoleCodes.includes('supervisor'),
    can_admin_revise: isAdmin,
    can_return_main: isAdmin && schedule?.report?.main_report_status === 'submitted' && schedule?.officials?.some(a=>a.role === 'main' && a.source_type === 'system'),
    can_return_supervisor: isAdmin && schedule?.report?.supervisor_review_status === 'submitted' && schedule?.officials?.some(a=>a.role === 'supervisor' && a.source_type === 'system'),
    is_readonly: canView && !canEditMain && !canEditSupervisor
  };

  const viewerAssignment = roleDefinition
    ? {
        role: roleDefinition.label,
        role_code: roleDefinition.code,
        role_key: roleDefinition.key,
        referee_id: isAdmin ? null : toNullableInt(schedule?.[roleDefinition.key]),
        user_id: normalizedViewer.id,
        is_admin: isAdmin,
        is_assigned_referee: Boolean(assignedRoleCode),
        ...permissions
      }
    : null;

  return {
    viewer_id: normalizedViewer.id,
    viewer_role: isAdmin?'管理员':assignedRoleCodes.map(r=>REPORT_ROLE_DEFINITIONS[r].label).join('、')||null,
    viewer_role_codes: assignedRoleCodes,
    viewer_role_code: roleDefinition ? roleDefinition.code : null,
    viewer_role_key: roleDefinition ? roleDefinition.key : null,
    viewer_assignment: viewerAssignment,
    viewer_permissions: permissions
  };
}

function ensureViewerCanReadReport(schedule, viewer = {}) {
  const context = buildViewerContext(schedule, viewer);
  if (!context.viewer_permissions.can_view) {
    throw createBusinessError('无权查看该报告', {
      statusCode: 403,
      code: 'PERMISSION_DENIED'
    });
  }
  return context;
}

module.exports = {
  REPORT_ROLE_DEFINITIONS,
  normalizeViewerContext,
  resolveAssignedRoleCode,
  resolveAssignedRoleCodes,
  buildViewerContext,
  ensureViewerCanReadReport
};
