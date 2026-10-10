// Exercise the real screenshot + admin review path when older regression cases need a changed college.
const crypto=require('node:crypto');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=','base64');
module.exports=async(request,expectStatus,token,admin,college)=>{
  const me=await request('/api/player/me',{token});expectStatus(me,200,'修改学院前资料');
  const form=new FormData();form.append('new_college',college);form.append('account_revision',String(me.data.data.revision));form.append('academic_image',new Blob([png],{type:'image/png'}),'test.png');
  const submission=await request('/api/player/college-changes',{token,body:form,headers:{'Idempotency-Key':crypto.randomUUID()}});expectStatus(submission,201,'提交学院修改');
  const d=submission.data.data;
  const approved=await request(`/api/player-admin/college-changes/${d.change.id}/approve`,{token:admin,body:{account_revision:d.account.revision},headers:{'If-Match':String(d.change.revision)}});expectStatus(approved,200,'审核学院修改');
  return approved.data.data.account;
};
