// 模拟升级前已经存在的测试数据。正式 HTTP 导入必须走新版预览审核。
const service=require('../../services/teamService');
function guard(){if(process.env.REFWEB_INTEGRATION_TEST!=='1'||!process.env.DB_NAME.endsWith('_test'))throw Error('仅限隔离集成测试');}
module.exports={
  create:async body=>{guard();const pool=require('../../db');await pool.execute('INSERT IGNORE INTO season_competitions(season_id,league_type,is_enabled) SELECT id,?,1 FROM seasons WHERE is_active=1',[body.league_type]);return service.addTeam(body);},
  roster:async(id,rows)=>{guard();return service.addRosterBatch(id,rows);}
};
