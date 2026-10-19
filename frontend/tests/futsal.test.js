import test from 'node:test'
import assert from 'node:assert/strict'
import {rolesFor} from '../src/utils/officialRoles.js'
import {intentionsFor,intentionText,roleText} from '../src/utils/matchSignup.js'
import {scheduleCsv} from '../src/utils/scheduleExport.js'
test('普通、五人制及可选监督仅展示适用岗位和意向',()=>{
 assert.deepEqual(rolesFor({futsal:true,supervisor_required:false}).map(r=>r.code),['main','second','timekeeper'])
 assert.deepEqual(intentionsFor({futsal:1,supervisor_required:1}).map(r=>r.value),['main','second','timekeeper','supervisor'])
 assert.deepEqual(intentionsFor({fourth_required:false,supervisor_required:false}).map(r=>r.value),['main','assistant'])
 assert.equal(intentionText(['second','timekeeper']),'第二裁判员、计时员')
 assert.equal(roleText('second,supervisor'),'第二裁判员、裁判监督')
})
test('混合赛程导出用独立列标注五人制职责，不适用岗位不会显示为待选派',()=>{
 const csv=scheduleCsv([{futsal:true,fourth_required:false,supervisor_required:false,officials:[{role:'second',name_snapshot:'第二裁判样例',source_type:'system'}]}])
 assert.match(csv,/第二裁判员来源/);assert.match(csv,/计时员来源/);assert.match(csv,/五人制/);assert.match(csv,/第二裁判样例/);assert.match(csv,/不适用/)
})
