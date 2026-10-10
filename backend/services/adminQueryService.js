const pool=require('../db');
const q=require('../utils/listQuery');
const registrationLabel=status=>({approved:'已注册（已通过）',pending:'已提交（待审核）',returned:'已退回',rejected:'未通过',unsubmitted:'未注册',no_season:'未启用赛季'})[status]||'未注册';

async function listAccounts(options={},exporting=false) {
  const {page,pageSize}=q.pagination(options);
  const query=q.text(options.query,'姓名或学号');
  const active=q.choice(options.is_active,['1','0'],'账号状态');
  const where=[],params=[];
  if(query){where.push("(r.name LIKE ? ESCAPE '!' OR r.student_id LIKE ? ESCAPE '!')");params.push(q.like(query),q.like(query));}
  if(active){where.push('r.is_active=?');params.push(Number(active));}
  const sql=where.length?'WHERE '+where.join(' AND '):'';
  const c=await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[season]]=await c.query('SELECT id,season_name,season_code FROM seasons WHERE is_active=1 ORDER BY id DESC LIMIT 1');
    const [[counts]]=await c.query('SELECT COUNT(*) total_accounts,COALESCE(SUM(is_active=1),0) active_accounts,COALESCE(SUM(is_active=0),0) inactive_accounts FROM referee');
    const [[count]]=await c.execute(`SELECT COUNT(*) total FROM referee r ${sql}`,params);
    const total=Number(count.total);if(exporting)q.guardExport(total);
    const [rows]=await c.execute(`SELECT r.id,r.student_id,r.name,r.grade,r.target_level,r.match_types,r.is_active,r.must_change_password,r.shanghai_fa_registered,r.created_at,p.college,rs.status AS season_registration_status
      FROM referee r LEFT JOIN referee_profile p ON p.referee_id=r.id
      LEFT JOIN referee_season_registrations rs ON rs.referee_id=r.id AND rs.season_id=? ${sql}
      ORDER BY r.created_at DESC,r.id DESC LIMIT ${exporting?5000:pageSize} OFFSET ${exporting?0:(page-1)*pageSize}`,[season?.id||null,...params]);
    await c.commit();
    return {items:rows.map(r=>{const status=season?r.season_registration_status||'unsubmitted':'no_season';return {...r,season_registration_status:status,season_registration_label:registrationLabel(status),shanghai_fa_registered:Boolean(r.shanghai_fa_registered),match_types:String(r.match_types||'').split(',').filter(Boolean)};}),current_season:season||null,pagination:q.pageMeta(page,pageSize,total),summary:counts};
  }catch(e){await c.rollback();throw e;}finally{c.release();}
}
module.exports={listAccounts};
