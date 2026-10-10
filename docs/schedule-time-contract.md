# 比赛开球时间接口约定

0020 补充：`field_order` 为1—50字符文本，同赛季同赛事精确唯一；字母、前导零和大小写保留。`match_type` 须为该赛季已添加的赛事名称，详见[赛事与停赛约定](competitions-discipline-contract.md)。

阶段1历史契约：schedule-time-v1，数据库迁移0018_schedule_match_time。当前阶段2扩展为schedule-signup-v1/0019，赛程更新必须携带schedule_revision，新建必须填写场地，详见[阶段2接口](phase2-signup-contract.md)。仅在现有赛程主数据上扩展；未恢复旧matches写入接口。

## 存储与语义

- match_date：YYYY-MM-DD，原有中国标准时间业务日期。
- match_time：API为严格五字符HH:mm，数据库为TIME且秒固定为0；00:00合法，24:00非法。允许null表示旧比赛时间待定。
- 日期与时间是Asia/Shanghai的本地比赛时刻，不转换成浏览器本地时间。不含结束时间或时长。
- 0018只新增可空列及约束，不回填旧比赛、不改历史快照。新库结构已同步，初始化后仍执行完整迁移链。

## 写入

POST /api/schedule 新建时必须提供match_time，连同原有match_type、team_a_id、team_b_id、match_date、field_order等字段校验。五岗仍可后续补派。

```json
{
  "match_type": "足协杯",
  "team_a_id": 1,
  "team_b_id": 2,
  "match_date": "2026-09-20",
  "match_time": "17:35",
  "field_order": "A1"
}
```

示例队伍ID需替换为当前启用赛季的同赛事球队。

PUT /api/schedule/:id 仍采用现有完整赛程表单契约，不是仅更新任意单字段的PATCH。match_time漏传时保留当前值；旧比赛原值为null时可继续留空；补齐后不能再清空。所有新建/更新均拒绝非字符串、秒、空白、24:00、17:60等格式。字段由原有白名单进入服务层。

任一报告分区开始后，修改开球时间返回400 / SCHEDULE_CORE_LOCKED；管理员报告修订不能解锁时间。时间校验错误使用MATCH_TIME_REQUIRED或MATCH_TIME_INVALID，返回400。

## 读取与排序

- 管理员赛程列表、详情、裁判本人赛程/统计、管理员裁判履历、工作台含match_time；详情的match及template_prefill也含同一字段。
- 球员和访客球队比赛列表含match_time；只增加公开时间，不扩大私有数据范围。本场名单接口继续按日期解析名单。
- 同日排序：已知时间升序 → 待定 → 场序升序 → ID升序。各页面原有日期升序/降序方向保留。
- 管理员轻量编辑保存后重新请求当前分页，避免时间改变后跨页排序停留在旧位置。
- CSV增加“开球时间”列；null显示“时间待定”，00:00保持原值。
- 新报告历史快照保存当时match_time，旧快照无此字段时显示待定，不用最新比赛值伪造历史。
- 比赛时间与名单生效业务日期独立；仅改时间不重置比赛名单选择，不改变按比赛日期解析版本的规则。

## 发布要求

后端、两个前端与0018一起更新。新服务器执行空库初始化和全部迁移；已有本地库执行增量迁移。旧前端新建时不传时间会被拒绝，不能混用不同版本。

阶段1未包含报名入口；阶段2已实现裁判选派报名，开球前可报名、修改或撤回，不设独立截止时间。当前规则见[阶段2接口约定](phase2-signup-contract.md)。
