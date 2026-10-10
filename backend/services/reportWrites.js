const pool = require('../db');
const scheduleService = require('./scheduleService');
const { createBusinessError } = require('../utils/scheduleValidator');
const { buildFourthOfficialImagePath } = require('../utils/reportUpload');
const history = require('../utils/reportHistory');
const integerFields = ['running_distance_m','max_heart_rate','sprint_count','high_intensity_distance_m','avg_heart_rate','red_card_count','yellow_card_count','penalty_count','offside_flag_count','assist_count'];
const statFields = ['running_distance_m','max_heart_rate','sprint_count','high_intensity_distance_m','avg_heart_rate','avg_speed_mps','red_card_count','red_card_accuracy','yellow_card_count','yellow_card_accuracy','penalty_count','penalty_accuracy','offside_flag_count','assist_count'];
function statValue(stat, field) {
  const raw = stat[field];
  if (raw === null || raw === undefined || raw === '') return null;
  if (!['string','number'].includes(typeof raw)) throw createBusinessError(`${field} 必须是数字`);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || (integerFields.includes(field) && !Number.isInteger(n)) || (field.endsWith('_accuracy') && n > 100)) throw createBusinessError(`${field} 数值不合法`);
  return n;
}
function actor(userId, context) { return context || { id: userId, role: 'referee' }; }
function target(schedule, role) { return schedule.officials.find(a => a.role === role); }
module.exports = {
  async withReportWrite(scheduleId, viewer, area, operation, work, options = {}) {
    const c = await pool.getConnection();
    let response;
    try {
      await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await c.beginTransaction();
      // 所有报告写入与选派都先锁同一赛程，再锁报告，串行化权限/锁定检查。
      const locked = await scheduleService.getScheduleByIdForWrite(c, scheduleId);
      if (!locked) throw createBusinessError('赛程不存在', { statusCode: 404 });
      const schedule = await scheduleService.queryScheduleDetail(c, scheduleId);
      if (!schedule.report?.id) throw createBusinessError('报告不存在', { statusCode: 404 });
      await c.execute('SELECT id FROM match_reports WHERE id = ? FOR UPDATE', [schedule.report.id]);
      const owner = target(schedule, area === 'main' ? 'main' : 'supervisor');
      if(area==='supervisor'&&!require('../utils/supervisionRules').required(schedule.supervisor_required))throw createBusinessError('本场不需要裁判监督，无需填写裁判监督报告',{code:'SUPERVISOR_NOT_REQUIRED'});
      const adminAction = options.adminAction;
      const reason = adminAction ? history.requiredReason(options.reason) : null;
      const isProxy = viewer.role === 'admin' && owner?.source_type === 'external';
      const isSelf = viewer.role === 'referee' && owner?.source_type === 'system' && Number(owner.referee_id) === Number(viewer.id);
      if (adminAction) {
        if (viewer.role !== 'admin') throw createBusinessError('仅管理员可以退回或修订报告',{statusCode:403});
        if (!owner) throw createBusinessError('请先完成该分区负责人的选派');
        if (adminAction === 'return' && owner.source_type !== 'system') throw createBusinessError('非系统裁判没有登录账号，不能退回；请使用管理员修订');
      } else if (!isProxy && !isSelf) throw createBusinessError(area === 'main' ? '仅系统裁判员本人或代非系统裁判员的管理员可以操作裁判员区' : '仅系统裁判监督本人或代非系统裁判监督的管理员可以操作裁判监督区', { statusCode: 403, code: 'PERMISSION_DENIED' });
      const status = area === 'main' ? schedule.report.main_report_status : schedule.report.supervisor_review_status;
      if (!adminAction && status === 'submitted') throw createBusinessError('报告已提交，内容已锁定；不能重复提交或修改', { code: area === 'main' ? 'MAIN_REPORT_LOCKED' : 'SUPERVISOR_REPORT_LOCKED' });
      if (adminAction === 'return' && status !== 'submitted') throw createBusinessError('只有已提交的分区可以退回重填');
      const state = await history.readSectionState(c,schedule.report.id,area,true);
      history.checkRevision(viewer.expected_revision,state.revision);
      const before = await history.captureSnapshot(c,schedule.report.id,area);
      await require('./matchRosterService').freeze(c, schedule);
      await work(c, schedule, schedule.report.id);
      const after = await history.captureSnapshot(c,schedule.report.id,area);
      const historyOperation = adminAction === 'return' ? 'return' : operation === 'revise' ? 'revise' : operation.startsWith('submit_') ? 'submit' : operation.startsWith('save_') ? 'save' : operation;
      await history.appendHistory(c,{reportId:schedule.report.id,section:area,state,before,after,operation:historyOperation,sourceType:adminAction?'admin_revision':isProxy?'admin_proxy':'referee',viewer,reason});
      if (area === 'main') await require('./matchPublicationService').afterWrite(c,schedule.report.id,operation,adminAction);
      if (!adminAction) {
        const [[person]] = await c.execute(viewer.role === 'admin' ? 'SELECT username AS name FROM admin WHERE id = ?' : 'SELECT name FROM referee WHERE id = ?', [viewer.id]);
        await c.execute(`INSERT INTO report_actor_events
        (report_id,owner_assignment_id,operation,source_type,actor_referee_id,actor_admin_id,actor_name_snapshot)
        VALUES (?,?,?,?,?,?,?)`, [schedule.report.id,owner.id,operation,isProxy ? 'admin_proxy' : 'referee',isProxy ? null : viewer.id,isProxy ? viewer.id : null,person.name]);
      }
      // 在提交前构造回显：读取失败会整体回滚，避免已存图片被路由误当失败清理。
      response = await this.getReportByScheduleId(scheduleId, viewer, c);
      await c.commit();
    } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
    // 旧图片已进入只读历史快照，不能物理删除；失败的新上传由路由清理。
    return response;
  },
  async uploadFourthOfficialImage(scheduleId, userId, file, context) {
    if (!file?.filename) throw createBusinessError('请先选择要上传的第四官员记录单图片');
    const imagePath = buildFourthOfficialImagePath(file.filename);
    return this.withReportWrite(scheduleId, actor(userId, context), 'main', 'upload_image', async (c, schedule, id) => {
      await c.execute(`UPDATE match_reports SET fourth_official_image_path = ?, main_report_started_at = COALESCE(main_report_started_at, NOW()) WHERE id = ?`, [imagePath,id]);
      return { removePath: schedule.report.fourth_official_image_path };
    });
  },
  async removeFourthOfficialImage(scheduleId, userId, context) {
    return this.withReportWrite(scheduleId, actor(userId, context), 'main', 'remove_image', async (c, schedule, id) => {
      if (!schedule.report.fourth_official_image_path) throw createBusinessError('当前没有已上传的第四官员记录单图片');
      await c.execute(`UPDATE match_reports SET fourth_official_image_path = NULL, main_report_started_at = COALESCE(main_report_started_at,NOW()) WHERE id = ?`, [id]);
      return { removePath: schedule.report.fourth_official_image_path };
    });
  },
  async updateMainReport(scheduleId, userId, body = {}, context) {
    return this.withReportWrite(scheduleId, actor(userId, context), 'main', 'save_main', (c, schedule, id) => this.writeMainContent(c,schedule,id,body));
  },
  async writeMainContent(c, schedule, id, body) {
      if (Object.hasOwn(body, 'stats') && !Array.isArray(body.stats)) throw createBusinessError('stats 必须是数组');
      const state = await this.validateMainReportState(c, schedule, id, body);
      await c.execute(`UPDATE match_reports SET home_score=?, away_score=?, home_penalty_score=?, away_penalty_score=?, main_report_started_at=COALESCE(main_report_started_at,NOW()) WHERE id=?`, [state.home_score,state.away_score,state.home_penalty_score,state.away_penalty_score,id]);
      const seen = new Set();
      for (const stat of body.stats || []) {
        if (!stat || !['main','assistant1','assistant2'].includes(stat.role) || seen.has(stat.role)) throw createBusinessError('统计岗位无效或重复');
        seen.add(stat.role);
        const assigned = target(schedule, stat.role);
        // 模板始终包含三个岗位；空岗位的空数据不落库，非空数据明确拒绝。
        if (!assigned) {
          if (statFields.some(f => stat[f] !== undefined && stat[f] !== null && stat[f] !== '')) throw createBusinessError('请先完成对应岗位选派再填写执法数据');
          continue;
        }
        if ((stat.assignment_id != null && Number(stat.assignment_id) !== Number(assigned.id)) || (stat.referee_id != null && Number(stat.referee_id) !== Number(assigned.referee_id))) throw createBusinessError('统计不能指定其他裁判或岗位');
        await c.execute(`INSERT INTO match_referee_stats (report_id,referee_id,assignment_id,role,${statFields.join(',')})
          VALUES (${Array(4 + statFields.length).fill('?').join(',')}) ON DUPLICATE KEY UPDATE
          assignment_id=VALUES(assignment_id),referee_id=VALUES(referee_id),${statFields.map(f => `${f}=VALUES(${f})`).join(',')}`,
        [id,assigned.referee_id,assigned.id,stat.role,...statFields.map(f => statValue(stat,f))]);
      }
      if (Array.isArray(body.cards)) {
        await c.execute('DELETE FROM match_cards WHERE report_id=?', [id]);
        for (const card of state.cards) await c.execute(`INSERT INTO match_cards (report_id,team_id,team_player_id,card_type,minute_base,minute_extra,minute_label,description) VALUES (?,?,?,?,?,?,?,?)`, [id,card.team_id,card.team_player_id,card.card_type,card.minute_base,card.minute_extra,card.minute_label,card.description]);
      }
      if (Array.isArray(body.goals)) {
        await c.execute('DELETE FROM match_goals WHERE report_id=?', [id]);
        for (const goal of state.goals) await c.execute(`INSERT INTO match_goals (report_id,player_team_id,credited_team_id,team_player_id,goal_type,minute_base,minute_extra,minute_label,description) VALUES (?,?,?,?,?,?,?,?,?)`, [id,goal.player_team_id,goal.credited_team_id,goal.team_player_id,goal.goal_type,goal.minute_base,goal.minute_extra,goal.minute_label,goal.description]);
      }
  },
  async submitMainReport(scheduleId, userId, context) {
    return this.withReportWrite(scheduleId, actor(userId, context), 'main', 'submit_main', async (c,schedule,id) => {
      await this.validateMainReportState(c,schedule,id,{});
      await c.execute(`UPDATE match_reports SET main_report_status='submitted',main_report_submitted_at=NOW(),main_report_started_at=COALESCE(main_report_started_at,NOW()) WHERE id=?`, [id]);
    });
  },
  async updateSupervisorReport(scheduleId, userId, body = {}, context) {
    return this.withReportWrite(scheduleId, actor(userId,context), 'supervisor', 'save_supervisor', (c,schedule,id) => this.writeSupervisorContent(c,schedule,id,body));
  },
  async writeSupervisorContent(c,schedule,id,body) {
      if (Object.hasOwn(body,'reviews') && !Array.isArray(body.reviews)) throw createBusinessError('reviews 必须是数组');
      const seen = new Set(), supervisor = target(schedule,'supervisor');
      for (const review of body.reviews || []) {
        if (!review || !require('../utils/officialRequirements').fieldRoles(schedule).includes(review.target_role) || seen.has(review.target_role)) throw createBusinessError('评价岗位无效或重复');
        seen.add(review.target_role);
        const assigned = target(schedule, review.target_role);
        const hasScore = review.score !== undefined && review.score !== null && review.score !== '';
        const advice = review.advice == null ? null : String(review.advice).trim() || null;
        if (!assigned) {
          if (hasScore || advice) throw createBusinessError('请先完成被评分岗位选派');
          continue;
        }
        if (review.target_assignment_id != null && Number(review.target_assignment_id) !== Number(assigned.id)) throw createBusinessError('评分不能指定其他岗位');
        if (!hasScore) {
          if (advice) throw createBusinessError('填写评价建议时必须同时填写评分');
          await c.execute('DELETE FROM match_referee_reviews WHERE report_id=? AND target_role=?', [id,review.target_role]);
          continue;
        }
        if (!['string','number'].includes(typeof review.score)) throw createBusinessError('评分必须是数字');
        const score = Number(review.score);
        if (!Number.isFinite(score) || score < 1 || score > 10 || Math.abs(score * 10 - Math.round(score * 10)) > 0.000001) throw createBusinessError('评分必须为1到10之间的数字，最多一位小数');
        if (advice?.length > 100) throw createBusinessError('评价建议不能超过100字');
        await c.execute(`INSERT INTO match_referee_reviews (report_id,reviewer_referee_id,target_referee_id,target_role,score,advice,target_assignment_id,reviewer_assignment_id)
          VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE score=VALUES(score),advice=VALUES(advice),target_assignment_id=VALUES(target_assignment_id),reviewer_assignment_id=VALUES(reviewer_assignment_id),target_referee_id=VALUES(target_referee_id),reviewer_referee_id=VALUES(reviewer_referee_id)`,
        [id,supervisor.referee_id,assigned.referee_id,review.target_role,score.toFixed(1),advice,assigned.id,supervisor.id]);
      }
      await c.execute('UPDATE match_reports SET supervisor_review_started_at=COALESCE(supervisor_review_started_at,NOW()) WHERE id=?', [id]);
  },
  async validateSupervisorComplete(c,schedule,id) {
      const [reviews] = await c.execute('SELECT target_role,target_assignment_id FROM match_referee_reviews WHERE report_id=?', [id]);
      if (!require('../utils/officialRequirements').fieldRoles(schedule).every(role => {
        const a = target(schedule,role);
        return a && reviews.some(rv => rv.target_role === role && Number(rv.target_assignment_id) === Number(a.id));
      })) throw createBusinessError('请先完成本场所需场上裁判岗位的全部评分');
  },
  async submitSupervisorReport(scheduleId, userId, context) {
    return this.withReportWrite(scheduleId, actor(userId,context), 'supervisor', 'submit_supervisor', async (c,schedule,id) => {
      await this.validateSupervisorComplete(c,schedule,id);
      await c.execute(`UPDATE match_reports SET supervisor_review_status='submitted',supervisor_review_submitted_at=NOW(),supervisor_review_started_at=COALESCE(supervisor_review_started_at,NOW()) WHERE id=?`, [id]);
    });
  },
  async returnReportSection(scheduleId,section,viewer,body = {}) {
    const prefix = history.sectionPrefix(section);
    if (Object.keys(body).some(k=>k!=='reason')) throw createBusinessError('退回只能提交原因，不能夹带报告或赛程修改');
    return this.withReportWrite(scheduleId,viewer,section,'return',async(c,schedule,id)=>{
      // 保留原提交时间，作为上次提交记录；started_at 永不清空，岗位继续锁定。
      await c.execute(`UPDATE match_reports SET ${prefix}_status='returned',${prefix}_started_at=COALESCE(${prefix}_started_at,NOW()) WHERE id=?`,[id]);
    },{adminAction:'return',reason:body.reason});
  },
  async reviseReportSection(scheduleId,section,viewer,body = {}) {
    history.sectionPrefix(section);
    if (Object.keys(body).some(k=>!['reason','data'].includes(k)) || !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw createBusinessError('修订必须提交原因和对应分区内容');
    const fields = section === 'main' ? ['home_score','away_score','home_penalty_score','away_penalty_score','stats','cards','goals'] : ['reviews'];
    if (!Object.keys(body.data).length || Object.keys(body.data).some(k=>!fields.includes(k))) throw createBusinessError('修订只能更改对应分区内容，不能修改状态、比赛或裁判岗位');
    return this.withReportWrite(scheduleId,viewer,section,'revise',async(c,schedule,id)=>{
      if (section === 'main') await this.writeMainContent(c,schedule,id,body.data);
      else {
        await this.writeSupervisorContent(c,schedule,id,body.data);
        if (schedule.report.supervisor_review_status === 'submitted') await this.validateSupervisorComplete(c,schedule,id);
      }
    },{adminAction:'revise',reason:body.reason});
  },
  async reviseReportImage(scheduleId,viewer,body,file,remove = false) {
    if (Object.keys(body || {}).some(k=>k!=='reason')) throw createBusinessError('图片修订只能提交原因和图片');
    if (!remove && !file?.filename) throw createBusinessError('请先选择图片');
    return this.withReportWrite(scheduleId,viewer,'main',remove?'remove_image':'upload_image',async(c,schedule,id)=>{
      if (remove && !schedule.report.fourth_official_image_path) throw createBusinessError('当前没有第四官员记录单图片');
      await c.execute('UPDATE match_reports SET fourth_official_image_path=?,main_report_started_at=COALESCE(main_report_started_at,NOW()) WHERE id=?',[remove?null:buildFourthOfficialImagePath(file.filename),id]);
    },{adminAction:'revise',reason:body.reason});
  }
};
