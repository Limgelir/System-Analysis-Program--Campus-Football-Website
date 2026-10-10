const fs=require('node:fs/promises');
const path=require('node:path');
const pool=require('../db');
const w=require('../utils/playerWorkflow');
const rules=require('../utils/playerRules');
const images=require('../utils/playerAcademicUpload');
async function preview(id){
  id=rules.id(id);
  const config=await require('./playerSeasonSettingsService').read(id);
  const [files]=await w.sql(pool,`SELECT f.id,f.registration_id,f.revision,f.cleaned_at FROM player_registration_files f JOIN player_season_registrations r ON r.id=f.registration_id WHERE r.season_id=? ORDER BY f.id`,[id]);
  const [events]=await w.sql(pool,'SELECT id,file_id,operation,message,created_at,actor_admin_id FROM player_material_cleanup_events WHERE season_id=? ORDER BY id DESC LIMIT 200',[id]);
  const [[status]]=await pool.execute('SELECT cleanup_status FROM player_season_settings WHERE season_id=?',[id]);
  return {season:config.season,revision:config.revision,ended_at:config.ended_at,cleanup_status:status?.cleanup_status||'not_requested',total:files.length,remaining:files.filter(f=>!f.cleaned_at).length,files,events};
}
async function event(c,id,user,operation,fileId=null,message=null){await c.execute('INSERT INTO player_material_cleanup_events (season_id,file_id,actor_admin_id,operation,message,created_at) VALUES (?,?,?,?,?,?)',[id,fileId,user.id,operation,message,w.chinaSql()]);}
async function cleanup(id,user,revision,body={}){
  id=rules.id(id);rules.onlyKeys(body,['confirm_season_name']);
  await w.transaction(async c=>{
    const [[s]]=await c.execute('SELECT id,season_name FROM seasons WHERE id=? FOR UPDATE',[id]);
    if(!s)throw rules.businessError('赛季不存在',404);
    await w.actor(c,user);
    if(body.confirm_season_name!==s.season_name)throw rules.businessError('请填写完整赛季名称以确认结束并清理');
    await c.execute('INSERT IGNORE INTO player_season_settings (season_id) VALUES (?)',[id]);
    const [[st]]=await c.execute('SELECT * FROM player_season_settings WHERE season_id=? FOR UPDATE',[id]);
    w.expectRevision(st.revision,revision);
    await c.execute("UPDATE player_season_settings SET ended_at=COALESCE(ended_at,?),ended_by_admin_id=COALESCE(ended_by_admin_id,?),cleanup_status='pending',revision=revision+1 WHERE season_id=?",[w.chinaSql(),user.id,id]);
    await event(c,id,user,st.ended_at?'retry':'end_season');
  });
  // 每项独立事务：删除后崩溃可按 ENOENT 安全重试；单项失败不阻止其他材料。
  const [files]=await pool.execute('SELECT f.id FROM player_registration_files f JOIN player_season_registrations r ON r.id=f.registration_id WHERE r.season_id=? AND f.cleaned_at IS NULL',[id]);
  for(const item of files)await w.transaction(async c=>{
    const [[f]]=await c.execute('SELECT f.* FROM player_registration_files f JOIN player_season_registrations r ON r.id=f.registration_id WHERE f.id=? AND r.season_id=? FOR UPDATE',[item.id,id]);
    if(!f||f.cleaned_at)return;
    try{
      if(f.file_path){
        const target=images.resolve(f.file_path);
        const [[other]]=await c.execute('SELECT COUNT(*) AS n FROM player_registration_files WHERE file_path=? AND id<>?',[f.file_path,f.id]);
        if(other.n)throw new Error('材料路径被其他记录引用，需人工检查');
        try{const root=await fs.realpath(images.DIRECTORY),directory=await fs.lstat(images.DIRECTORY),uploadRoot=await fs.realpath(require('../utils/uploadPaths').UPLOAD_ROOT),stat=await fs.lstat(target);if(directory.isSymbolicLink()||path.dirname(root)!==uploadRoot||stat.isSymbolicLink()||!stat.isFile()||path.dirname(await fs.realpath(target))!==root)throw new Error('材料不在受管目录或不是普通文件');await fs.unlink(target);}catch(e){if(e.code!=='ENOENT')throw e;}
      }
      await c.execute('UPDATE player_registration_files SET file_path=NULL,cleaned_at=? WHERE id=?',[w.chinaSql(),f.id]);
      await event(c,id,user,'cleaned',f.id);
    }catch(e){await event(c,id,user,'failed',f.id,e.isBusinessError?'材料路径不合法':e.code?`文件清理失败：${e.code}`:e.message.slice(0,500));}
  });
  await w.transaction(async c=>{await c.execute('SELECT id FROM seasons WHERE id=? FOR UPDATE',[id]);const [[left]]=await c.execute('SELECT COUNT(*) AS n FROM player_registration_files f JOIN player_season_registrations r ON r.id=f.registration_id WHERE r.season_id=? AND f.cleaned_at IS NULL',[id]);await c.execute('UPDATE player_season_settings SET cleanup_status=? WHERE season_id=?',[left.n?'failed':'complete',id]);});
  return preview(id);
}
module.exports={preview,cleanup};
