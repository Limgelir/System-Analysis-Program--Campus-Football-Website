import { test } from 'node:test'
import assert from 'node:assert/strict'
import { teamGroups } from '../src/teamGroups.js'
test('未参赛负责人只出现在管理队伍；未参加的赛事不生成空标题', () => {
  const t={id:1,league_type:'足协杯',can_manage:true,is_member:false,was_member:false}
  assert.deepEqual(teamGroups([t]),[{title:'我管理的队伍',groups:[{league:'足协杯',items:[t]}]}])
  assert.deepEqual(teamGroups([]),[])
})
test('同名不同赛事独立分组；队长兼参赛同时显示，退队后只保留历史', () => {
  const current={id:1,team_name:'同名队',league_type:'足协杯',can_manage:true,is_member:true,was_member:true}
  const old={id:2,team_name:'同名队',league_type:'大联赛',can_manage:false,is_member:false,was_member:true}
  const sections=teamGroups([current,old])
  assert.deepEqual(sections.map(s=>s.title),['我的队伍','我管理的队伍','曾参加的队伍'])
  assert.deepEqual(sections.map(s=>s.groups[0].items[0].id),[1,1,2])
})

test('四平、嘉定和其它自定义赛事的队伍不会被固定赛事列表过滤掉', () => {
  const names=['大联赛','新生杯','四平足协杯','嘉定足协杯','研究生邀请赛']
  const teams=names.map((league_type,id)=>({id,league_type,is_member:true,can_manage:false,was_member:true}))
  assert.deepEqual(teamGroups(teams)[0].groups.map(g=>g.league),names)
})
