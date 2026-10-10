// Read-only local inventory: no account identifiers, names, credentials or writes.
const mysql=require('mysql2/promise');
const {loadTestConnectionEnvironment}=require('./runApiIntegrationTests');
const {matchCollege}=require('../utils/collegeIdentity');
async function main(){
  const {connection}=loadTestConnectionEnvironment();
  const c=await mysql.createConnection({...connection,database:process.env.DB_NAME||'referee_system'});
  try{
    const result={scope:'本机数据库一次性标准化只读计划；尚未更新账号；后续球员自行修改仍需审核',groups:[]};
    for(const [role,sql]of [['player','SELECT college,COUNT(*) count FROM player_accounts GROUP BY college'],['referee','SELECT p.college,COUNT(*) count FROM referee r LEFT JOIN referee_profile p ON p.referee_id=r.id GROUP BY p.college']]){
      const [rows]=await c.query(sql);
      for(const row of rows)result.groups.push({role,original_college:row.college,count:Number(row.count),...matchCollege(row.college),one_time_direct_change:!!matchCollege(row.college).college&&matchCollege(row.college).college!==row.college});
    }
    result.summary={total:0,one_time_direct_changes:0,already_standard:0,unmatched:0};
    for(const row of result.groups){result.summary.total+=row.count;result.summary[row.one_time_direct_change?'one_time_direct_changes':row.method==='unmatched'?'unmatched':'already_standard']+=row.count;}
    console.log(JSON.stringify(result,null,2));
  }finally{await c.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
