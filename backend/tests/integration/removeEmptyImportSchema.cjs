// Only used when reconstructing old schemas inside the runner-owned empty test DB.
module.exports=async c=>{
  const assert=require('node:assert/strict');
  assert.equal(process.env.REFWEB_INTEGRATION_TEST,'1');assert.ok(process.env.DB_NAME.endsWith('_test'));
  const [[count]]=await c.query('SELECT COUNT(*) n FROM imported_player_identities');assert.equal(count.n,0);
  for(const [table,column]of [['team','manager_import_person_id'],['team_applications','manager_import_person_id'],['team_application_members','import_person_id'],['team_player','import_person_id']]){
    await c.query(`ALTER TABLE ${table} DROP FOREIGN KEY fk_${table}_import_person`);
    await c.query(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
  await c.query('DROP TABLE imported_player_identities');
};
