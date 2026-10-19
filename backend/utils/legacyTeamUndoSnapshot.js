const assert = require('node:assert/strict');

const fields = ['status','manager_player_id','manager_import_person_id','team_name','shirt_color','shorts_color','socks_color',
  'auto_review','return_reason','return_snapshot','member_comments','revoke_reason','effective_from','reviewed_by_admin_id','reviewed_at','submitted_at','submitted_snapshot'];
const jsonFields = new Set(['auto_review','return_snapshot','member_comments','submitted_snapshot']);
// 仅用于经人工确认的旧记录补齐；调用方须核验备份、当前版本、球队和赛程证据。
function build({current, event, original, teamRevision=null, createdSelections=[], firstReturnConfirmed=false}) {
  assert.equal(current.admin_undo, null);
  assert.ok(['returned','revoked'].includes(event.operation));
  assert.equal(current.status,event.operation);
  assert.equal(current.revision,event.revision);
  assert.equal(event.before_snapshot.revision,event.revision-1);
  let source=original;
  if(firstReturnConfirmed){
    assert.equal(event.operation,'returned');assert.equal(current.team_id,null);
    assert.equal(event.before_snapshot.status,'pending');
    source={...current,...event.before_snapshot,return_reason:null,return_snapshot:null,member_comments:null,reviewed_by_admin_id:null,reviewed_at:null};
  }
  assert.ok(source);
  assert.equal(source.id,current.id);assert.equal(source.revision,event.revision-1);
  assert.equal(source.status,event.operation==='revoked'?'approved':'pending');
  const before={};
  for(const key of fields){assert.ok(Object.hasOwn(source,key),'Missing field '+key);const value=source[key];before[key]=jsonFields.has(key)&&typeof value==='string'?JSON.parse(value):value;}
  for(const key of fields.filter(k=>Object.hasOwn(event.before_snapshot,k)))assert.deepEqual(before[key],event.before_snapshot[key],'Historical mismatch '+key);
  assert.ok(Array.isArray(event.before_snapshot.members)&&event.before_snapshot.members.length);
  return {operation:event.operation,revision:current.revision,before,members:event.before_snapshot.members,
    team_revision:teamRevision,selections:[],drafts:[],created_selections:createdSelections};
}
module.exports={build,fields};
