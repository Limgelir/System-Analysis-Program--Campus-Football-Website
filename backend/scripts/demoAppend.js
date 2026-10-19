// 独立的追加工具。不要与 demoSeed.js 的 RESET/clear 命令混用。
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { assertMigrationsCurrent } = require('../utils/migrationRunner');
const { BACKEND_ROOT, UPLOAD_ROOT } = require('../utils/uploadPaths');
const { buildDemoDefinitions, buildRegistrationEvents } = require('./demoSeed');
const { recordSecurityEvent } = require('../utils/securityEvents');
const history = require('../utils/reportHistory');
const reportService = require('../services/reportService');
const scheduleService = require('../services/scheduleService');
const ROLES = require('../utils/officialAssignments').ROLES.filter(r=>require('../utils/officialRequirements').roleRequired({},r.code));

const ACCOUNT_COUNT = 30;
const CASES = Object.freeze([
  '未选派', '系统裁判待填写', '裁判员已提交', '裁判监督已提交', '双方已提交并有管理员修订',
  '裁判员已退回', '非系统裁判员待管理员代填', '非系统裁判员已代填且裁判监督退回',
  '选派后账号停用待核查', '选派后赛季资格退回待核查'
]);

function parseArguments(argv) {
  const [command, ...args] = argv;
  if (!['plan', 'append'].includes(command)) throw new Error('命令必须明确指定 plan 或 append；没有重置或清理模式');
  const values = {};
  for (const arg of args) {
    const match = /^--(batch|season-id|admin-id)=(.+)$/.exec(arg);
    if (!match || Object.hasOwn(values, match[1])) throw new Error('未知或重复参数');
    values[match[1]] = match[2];
  }
  if (!/^[a-z0-9][a-z0-9-]{2,15}$/.test(values.batch || '')) throw new Error('--batch 必须为 3—16 位小写字母、数字或连字符');
  for (const key of ['season-id', 'admin-id']) {
    if (!/^[1-9]\d*$/.test(values[key] || '') || !Number.isSafeInteger(Number(values[key]))) throw new Error(`必须指定正整数 --${key}`);
  }
  return { command, batch: values.batch, seasonId: Number(values['season-id']), adminId: Number(values['admin-id']) };
}

function assertAuthorized(env, database) {
  if (env.DEMO_APPEND_CONFIRM !== `APPEND_${database}`) throw new Error(`请显式设置 DEMO_APPEND_CONFIRM=APPEND_${database}；只追加，不接受 RESET 授权`);
  if (env.NODE_ENV === 'production' && env.DEMO_APPEND_ALLOW_PRODUCTION !== 'true') throw new Error('演示服务器还需 DEMO_APPEND_ALLOW_PRODUCTION=true；不要用于真实个人资料测试');
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function validateOutput(file) {
  if (path.extname(file) !== '.seed') throw new Error('凭据文件必须使用 .seed 扩展名');
  const blocked = [UPLOAD_ROOT, path.resolve(BACKEND_ROOT, '../frontend'), path.resolve(BACKEND_ROOT, '../player-frontend'), path.resolve('/var/www')];
  if (blocked.some(root => inside(root, file))) throw new Error('凭据不能写入上传目录或公开网页目录');
  return file;
}

function outputPath(env, batch) {
  const configured = env.DEMO_APPEND_OUTPUT || path.join(BACKEND_ROOT, `demo-append-${batch}.seed`);
  if (env.NODE_ENV === 'production' && !path.isAbsolute(configured)) throw new Error('生产环境 DEMO_APPEND_OUTPUT 必须是绝对路径');
  return validateOutput(path.resolve(BACKEND_ROOT, configured));
}

function definitions(batch, today) {
  const refs = buildDemoDefinitions('large', new Date(`${today}T12:00:00Z`), 'all-approved').referees.slice(0, ACCOUNT_COUNT);
  refs.forEach((ref, i) => {
    ref.student_id = `DEMO-${batch}-R${String(i + 1).padStart(3, '0')}`;
    ref.name = `追加${batch}-裁判${String(i + 1).padStart(2, '0')}`;
    ref.must_change_password = i < 3 || i === 27;
    ref.registration_status = i === 25 ? 'pending' : i === 26 ? 'rejected' : i === 27 ? 'unsubmitted' : 'approved';
  });
  refs[23].name = refs[24].name = `追加${batch}-同名裁判`;
  return refs;
}

function password() { return `Aa9!${crypto.randomBytes(9).toString('base64url')}`; }
function shiftDate(today, days) {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function addRegistration(c, ref, seasonId, adminId) {
  const events = buildRegistrationEvents(ref, seasonId, adminId);
  if (!events.length) return null;
  for (const event of events) {
    if (event.reason) {
      event.reason = `[追加演示样例] ${event.reason}`;
      event.after_snapshot.review_reason = event.reason;
    }
  }
  const snapshot = events.at(-1).after_snapshot;
  const [result] = await c.execute(`INSERT INTO referee_season_registrations
    (season_id,referee_id,name_snapshot,height_cm_snapshot,weight_kg_snapshot,college_snapshot,grade_snapshot,
     match_types_snapshot,status,submitted_at,reviewed_at,reviewed_by_admin_id,review_reason,application_version)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`, [seasonId,ref.id,snapshot.name_snapshot,snapshot.height_cm_snapshot,
    snapshot.weight_kg_snapshot,snapshot.college_snapshot,snapshot.grade_snapshot,JSON.stringify(snapshot.match_types_snapshot),
    snapshot.status,snapshot.submitted_at,snapshot.reviewed_at,snapshot.reviewed_by_admin_id,snapshot.review_reason]);
  const registrationId = Number(result.insertId);
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const before = i ? { id: registrationId, ...events[i - 1].after_snapshot } : null;
    await c.execute(`INSERT INTO referee_season_registration_events
      (registration_id,season_id,referee_id,event_type,from_status,to_status,application_version,actor_type,
       actor_referee_id,actor_admin_id,reason,before_snapshot,after_snapshot,created_at)
      VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?)`, [registrationId,seasonId,ref.id,event.event_type,before?.status || null,
      event.after_snapshot.status,event.actor_type,event.actor_referee_id,event.actor_admin_id,event.reason,
      before ? JSON.stringify(before) : null,JSON.stringify({id:registrationId,...event.after_snapshot}),event.created_at]);
  }
  return registrationId;
}

async function addTeam(c, seasonId, batch, type, index, historical = false, twoVersions = false) {
  await c.execute('INSERT IGNORE INTO season_competitions(season_id,league_type) VALUES (?,?)',[seasonId,type]);
  const name = `追加${batch}-${historical ? '历史' : ''}${type}${index + 1}`;
  const [result] = await c.execute('INSERT INTO team (season_id,team_name,league_type,description) VALUES (?,?,?,?)',
    [seasonId,name,type,`仅供测试；追加批次 ${batch}；不得用重置脚本清理`]);
  const team = { id:Number(result.insertId), name, type };
  for (let version = 1; version <= (twoVersions ? 2 : 1); version++) {
    const [roster] = await c.execute('INSERT INTO team_roster_batches (team_id,season_id,version_no) VALUES (?,?,?)',[team.id,seasonId,version]);
    for (let n = 1; n <= 23; n++) {
      const [player] = await c.execute('INSERT INTO team_player (roster_batch_id,team_id,jersey_number,player_name,remark) VALUES (?,?,?,?,?)',
        [roster.insertId,team.id,String(n),`演示球员${index + 1}-${n}-v${version}`,`批次 ${batch}`]);
      if (n === 1) team.playerId = Number(player.insertId);
    }
  }
  return team;
}

async function transition(c, schedule, section, operation, adminId, work) {
  const reportId = schedule.report.id;
  const owner = schedule.officials.find(a => a.role === section);
  const adminAction = ['return','revise'].includes(operation);
  const proxy = section === 'main' && owner.source_type === 'external';
  const viewer = {role:adminAction || proxy ? 'admin':'referee', id:adminAction || proxy ? adminId:owner.referee_id};
  const state = await history.readSectionState(c,reportId,section,true);
  const before = await history.captureSnapshot(c,reportId,section);
  await work();
  const after = await history.captureSnapshot(c,reportId,section);
  await history.appendHistory(c,{reportId,section,state,before,after,operation,
    sourceType:adminAction?'admin_revision':proxy?'admin_proxy':'referee',viewer,reason:'[追加演示样例] 用于测试版本、锁定及分区权限'});
  if(section==='main'&&['submit','revise'].includes(operation))await require('../services/matchPublicationService').afterWrite(c,reportId,operation==='submit'?'submit_main':'revise',adminAction?'revise':null);
  if (!adminAction) {
    await c.execute(`INSERT INTO report_actor_events
      (report_id,owner_assignment_id,operation,source_type,actor_referee_id,actor_admin_id,actor_name_snapshot,owner_assignment_snapshot)
      VALUES (?,?,?,?,?,?,?,?)`, [reportId,owner.id,`${operation}_${section}`,proxy?'admin_proxy':'referee',
      proxy?null:owner.referee_id,proxy?adminId:null,'[追加演示脚本] 合成操作',JSON.stringify(owner)]);
  }
}

async function fillReport(c, schedule, kind, home, adminId) {
  // 所有目标 schedule/report 都是当前事务刚 INSERT 的记录；不接收外部旧报告 ID。
  const id = schedule.report.id;
  const main = [2,4,5,7].includes(kind);
  const supervisor = [3,4,5,7].includes(kind);
  if (main) {
    await transition(c,schedule,'main','save',adminId,() => reportService.writeMainContent(c,schedule,id,{
      home_score:1, away_score:0,
      goals:[{player_team_id:home.id,credited_team_id:home.id,team_player_id:home.playerId,goal_type:'normal',minute_base:25,minute_extra:0,description:'追加演示进球'}],
      cards:[{team_id:home.id,team_player_id:home.playerId,card_type:'yellow',minute_base:40,minute_extra:0,description:'追加演示黄牌'}],
      stats:[{role:'main',running_distance_m:9000,max_heart_rate:180,sprint_count:20},{role:'assistant1',running_distance_m:6000},{role:'assistant2',running_distance_m:6100}]
    }));
    await transition(c,schedule,'main','submit',adminId,async() => {
      await reportService.validateMainReportState(c,schedule,id,{});
      await c.execute("UPDATE match_reports SET main_report_status='submitted',main_report_submitted_at=NOW() WHERE id=?",[id]);
    });
  }
  if (supervisor) {
    await transition(c,schedule,'supervisor','save',adminId,() => reportService.writeSupervisorContent(c,schedule,id,{
      reviews:['main','assistant1','assistant2','fourth'].map(target_role => ({target_role,score:8.5,advice:'追加演示：保持跑位与沟通'}))
    }));
    await transition(c,schedule,'supervisor','submit',adminId,async() => {
      await reportService.validateSupervisorComplete(c,schedule,id);
      await c.execute("UPDATE match_reports SET supervisor_review_status='submitted',supervisor_review_submitted_at=NOW() WHERE id=?",[id]);
    });
  }
  if (kind === 4) await transition(c,schedule,'main','revise',adminId,() => reportService.writeMainContent(c,schedule,id,{stats:[{role:'main',running_distance_m:9200}]}));
  if (kind === 5 || kind === 7) {
    const section = kind === 5 ? 'main':'supervisor';
    const prefix = history.sectionPrefix(section);
    await transition(c,schedule,section,'return',adminId,() => c.execute(`UPDATE match_reports SET ${prefix}_status='returned' WHERE id=?`,[id]));
  }
}

async function addSchedule(c, {seasonId,type,home,away,date,order,refs,externals,kind,adminId}) {
  let people = refs.slice(0,5).map(ref => ({referee_id:ref.id,external_referee_id:null,name:ref.name}));
  if (kind === 0) people = [];
  if ([6,7].includes(kind)) for (let i = 0; i < 4; i++) people[i] = {referee_id:null,external_referee_id:externals[i].id,name:externals[i].name};
  if ([8,9].includes(kind)) people[0] = {referee_id:refs[kind === 8 ? 28:29].id,external_referee_id:null,name:refs[kind === 8 ? 28:29].name};
  const fields = ROLES.map(r=>r.field).join(',');
  const snapshots = ROLES.map(r=>`${r.name}_snapshot`).join(',');
  const [result] = await c.execute(`INSERT INTO match_schedules
    (season_id,match_type,team_a_id,team_b_id,team_a_name_snapshot,team_b_name_snapshot,match_date,match_time,venue,field_order,${fields},${snapshots})
    VALUES (${Array(20).fill('?').join(',')})`, [seasonId,type,home.id,away.id,home.name,away.name,date,'17:35','樱花人草',order,
    ...ROLES.map((_,i)=>people[i]?.referee_id || null),...ROLES.map((_,i)=>people[i]?.name || null)]);
  const id = Number(result.insertId);
  await c.execute('UPDATE match_schedules SET field_order_sort=? WHERE id=?',[require('../utils/competitionRules').fieldOrderSortKey(order),id]);
  for (let i = 0; i < people.length; i++) {
    const person = people[i];
    await c.execute(`INSERT INTO match_official_assignments
      (schedule_id,role,source_type,referee_id,external_referee_id,name_snapshot) VALUES (?,?,?,?,?,?)`,
      [id,ROLES[i].code,person.referee_id?'system':'external',person.referee_id,person.external_referee_id,person.name]);
  }
  const schedule = await scheduleService.queryScheduleDetail(c,id);
  await fillReport(c,schedule,kind,home,adminId);
  return {id,season_id:seasonId,match_type:type,field_order:order,match_date:date,match_time:'17:35',venue:'樱花人草',home_team:home.name,away_team:away.name,
    scenario:CASES[kind],officials:schedule.officials.map(a=>({role:a.role,source_type:a.source_type,referee_id:a.referee_id,external_referee_id:a.external_referee_id,name:a.name_snapshot}))};
}

async function appendData(c, refs, options, season, today) {
  const actor = {role:'admin',id:options.adminId};
  for (const ref of refs) {
    ref.initial_password = password();
    const hash = await bcrypt.hash(ref.initial_password,12);
    const [result] = await c.execute(`INSERT INTO referee
      (student_id,name,grade,target_level,shanghai_fa_registered,level_promoted_at,match_types,password_hash,must_change_password,password_changed_at,is_active)
      VALUES (?,?,?,?,?,?,?,?,?,NOW(),1)`,[ref.student_id,ref.name,ref.grade,ref.target_level,ref.shanghai_fa_registered?1:0,
      ref.level_promoted_at,ref.match_types,hash,ref.must_change_password?1:0]);
    ref.id = Number(result.insertId);
    await c.execute('INSERT INTO referee_profile (referee_id,gender,college,height_cm,weight_kg,officiated_count_base) VALUES (?,?,?,?,?,?)',
      [ref.id,ref.gender,ref.college,ref.height_cm,ref.weight_kg,ref.officiated_count_base]);
    await recordSecurityEvent(c,'account_created','referee',ref.id,actor);
    ref.registrationId = await addRegistration(c,ref,season.id,options.adminId);
  }
  const externals = [];
  for (let i = 0; i < 4; i++) {
    const name = i === 3 ? refs[23].name : `追加${options.batch}-校外${i + 1}`;
    const [result] = await c.execute('INSERT INTO external_referees (name,note,created_by_admin_id) VALUES (?,?,?)',
      [name,`追加演示批次 ${options.batch}；非系统裁判无登录账号`,options.adminId]);
    externals.push({id:Number(result.insertId),name});
  }
  const teams = [], schedules = [];
  for (const type of ['足协杯','大联赛','新生杯']) {
    const group = [];
    for (let i = 0; i < 4; i++) group.push(await addTeam(c,season.id,options.batch,type,i,false,type==='足协杯' && i===0));
    teams.push(...group);
    for (let kind = 0; kind < CASES.length; kind++) schedules.push(await addSchedule(c,{
      seasonId:season.id,type,home:group[kind % 4],away:group[(kind + 1) % 4],
      date:shiftDate(today,[0,1,6,8,9].includes(kind)?1 + kind % 5:-1 - kind % 5),order:`DEMO-${options.batch}-${kind+1}`,
      refs,externals,kind,adminId:options.adminId
    }));
  }
  // 只停用本批新账号、退回本批新申请，构造选派后资格失效；不触碰已有人员。
  await c.execute('UPDATE referee SET is_active=0,token_version=token_version+1 WHERE id=?',[refs[28].id]);
  refs[28].is_active = false;
  await recordSecurityEvent(c,'account_disabled','referee',refs[28].id,actor);
  const ref = refs[29];
  const [[previousEvent]] = await c.execute('SELECT after_snapshot FROM referee_season_registration_events WHERE registration_id=? ORDER BY id DESC LIMIT 1',[ref.registrationId]);
  const before = history.parseJson(previousEvent.after_snapshot);
  const reason = '[追加演示样例] 选派后资格退回，用于工作台核查';
  await c.execute("UPDATE referee_season_registrations SET status='returned',review_reason=?,reviewed_at=NOW() WHERE id=?",[reason,ref.registrationId]);
  const [[returnedRow]] = await c.execute('SELECT reviewed_at FROM referee_season_registrations WHERE id=?',[ref.registrationId]);
  const after = {...before,status:'returned',review_reason:reason,reviewed_at:returnedRow.reviewed_at};
  await c.execute(`INSERT INTO referee_season_registration_events
    (registration_id,season_id,referee_id,event_type,from_status,to_status,application_version,actor_type,actor_admin_id,reason,before_snapshot,after_snapshot)
    VALUES (?,?,?,'returned','approved','returned',1,'admin',?,?,?,?)`,
    [ref.registrationId,season.id,ref.id,options.adminId,reason,JSON.stringify(before),JSON.stringify(after)]);
  ref.registration_status = 'returned';

  // 独立历史样例赛季始终不启用，不切换当前赛季，也不在旧业务赛季插入数据。
  const historicalStart = shiftDate(today,-400), historicalEnd = shiftDate(today,-35);
  const [oldSeason] = await c.execute('INSERT INTO seasons (season_code,season_name,start_date,end_date,is_active) VALUES (?,?,?,?,0)',
    [`d-${options.batch}`,`测试${options.batch}`,historicalStart,historicalEnd]);
  const historicalId = Number(oldSeason.insertId);
  for (const item of refs.slice(0,5)) await addRegistration(c,item,historicalId,options.adminId);
  const oldTeams = [];
  for (let i = 0; i < 2; i++) oldTeams.push(await addTeam(c,historicalId,options.batch,'足协杯',i,true));
  teams.push(...oldTeams);
  schedules.push(await addSchedule(c,{seasonId:historicalId,type:'足协杯',home:oldTeams[0],away:oldTeams[1],date:shiftDate(today,-60),order:1,refs,externals,kind:4,adminId:options.adminId}));
  return {warning:'仅供演示；审核、提交及修订历史为脚本合成样例，关联指定管理员，不代表人工真实操作。密码仅为生成时初始值，后续改密不会更新本文件。',
    batch:options.batch,generated_at:new Date().toISOString(),target_season:season,historical_season_id:historicalId,
    summary:{added_accounts:refs.length,added_teams:teams.length,added_schedules:schedules.length,added_external_referees:externals.length,added_inactive_seasons:1},
    referee_accounts:refs.map(r=>({id:r.id,student_id:r.student_id,name:r.name,initial_password:r.initial_password,
      must_change_password:r.must_change_password,is_active:r.is_active,registration_status:r.registration_status,
      grade:r.grade,target_level:r.target_level,shanghai_fa_registered:r.shanghai_fa_registered,
      test_purpose:!r.is_active?'已选派后停用：无法登录，工作台待核查':r.must_change_password?'先验证首次强制改密，再进行注册或报告':r.registration_status==='returned'?'选派后资格退回：工作台待核查，可重新申请':r.registration_status})),
    external_referees:externals,teams,schedule_assignments:schedules};
}

async function run(options, env = process.env) {
  const c = await pool.getConnection();
  let locked = false, transaction = false, handle = null, createdFile = false, commitAttempted = false;
  let file;
  try {
    const [[db]] = await c.query('SELECT DATABASE() AS name, CAST(CURRENT_DATE() AS CHAR) AS today');
    if (!db.name) throw new Error('没有选择数据库');
    if (options.command === 'append') assertAuthorized(env,db.name);
    await assertMigrationsCurrent(c);
    const [[lock]] = await c.execute("SELECT GET_LOCK(CONCAT(DATABASE(), ':demo_seed'), 60) AS acquired");
    if (Number(lock.acquired) !== 1) throw new Error('另一个演示数据任务正在运行，请稍后重试');
    locked = true;
    const refs = definitions(options.batch,db.today);
    const [existing] = await c.query('SELECT id,student_id FROM referee WHERE student_id IN (?)',[refs.map(r=>r.student_id)]);
    if (existing.length === ACCOUNT_COUNT) return {status:'skipped',batch:options.batch,added_accounts:0,message:'本批次账号已存在；没有重置密码、覆盖修改或重复生成。'};
    if (existing.length) throw new Error('批次存在部分同名账号，拒绝补写或覆盖；请核对已有批次或改用全新批次号');
    const [[oldSeason]] = await c.execute('SELECT id FROM seasons WHERE season_code=? OR season_name=?',[`d-${options.batch}`,`测试${options.batch}`]);
    if (oldSeason) throw new Error('批次历史赛季已存在，拒绝覆盖或重新生成');
    const [[admin]] = await c.execute('SELECT id FROM admin WHERE id=?',[options.adminId]);
    if (!admin) throw new Error('指定管理员不存在；不会创建或修改管理员');
    file = outputPath(env,options.batch);
    try { await fs.lstat(file); throw new Error('凭据文件已存在，拒绝覆盖；请核对批次和文件'); }
    catch(error) { if (error.code !== 'ENOENT') throw error; }
    await c.beginTransaction(); transaction = true;
    const [[season]] = await c.execute('SELECT id,season_code,season_name,start_date,end_date,is_active FROM seasons WHERE id=? FOR UPDATE',[options.seasonId]);
    if (!season || !season.is_active) throw new Error('必须明确选择当前启用赛季；脚本不会启用、切换或修改旧赛季');
    if (options.command === 'plan') {
      await c.rollback(); transaction = false;
      return {status:'plan',database:db.name,batch:options.batch,target_season:season,credential_file:file,
        added_accounts:30,added_teams:14,added_schedules:31,added_external_referees:4,added_inactive_seasons:1,
        scenarios:CASES,message:'只读预览；当前赛季不变。比赛日期相对数据库今天生成，临近比赛可在工作台看到。'};
    }
    await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
    validateOutput(path.join(await fs.realpath(path.dirname(file)),path.basename(file)));
    handle = await fs.open(file,'wx',0o600); createdFile = true;
    const payload = await appendData(c,refs,options,season,db.today);
    payload.database = db.name;
    // 先以排他方式持久化凭据再提交数据库，防止账号已生成但初始密码丢失。
    await handle.writeFile(`${JSON.stringify(payload,null,2)}\n`,'utf8');
    await handle.sync(); await handle.close(); handle = null;
    commitAttempted = true;
    await c.commit(); transaction = false;
    return {status:'appended',batch:options.batch,...payload.summary,credential_file:file,message:'只追加新数据；原账号、密码、当前赛季和上传文件保持不变。'};
  } catch(error) {
    if (handle) await handle.close().catch(()=>{});
    let rolledBack = false;
    if (transaction) { try { await c.rollback(); rolledBack = true; } catch { /* 保留凭据供核对，不猜测数据库结果。 */ } }
    // 仅清理由本次 wx 创建且已确认未提交的文件；绝不删除旧凭据或上传文件。
    if (createdFile && rolledBack && !commitAttempted) await fs.unlink(file);
    if (commitAttempted) throw new Error(`数据库提交结果需核对；保留凭据文件 ${file}。请先查询同批次账号，勿重置或覆盖。`);
    throw error;
  } finally {
    if (locked) await c.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':demo_seed'))").catch(()=>{});
    c.release();
  }
}

if (require.main === module) {
  Promise.resolve().then(()=>run(parseArguments(process.argv.slice(2)))).then(result=>console.log(JSON.stringify(result,null,2)))
    .catch(error=>{console.error(`追加演示数据失败：${error.code ? `${error.code}（数据库或文件操作失败，请保留旧数据排查）`:error.message}`);process.exitCode=1;})
    .finally(()=>pool.end());
}
module.exports = {parseArguments,assertAuthorized,outputPath,definitions,password,shiftDate,run,ACCOUNT_COUNT,CASES};
