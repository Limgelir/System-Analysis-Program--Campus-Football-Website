# 阶段2：裁判报名、优先选派与比赛场地

数据库0019_referee_match_signups，赛程契约schedule-signup-v1。管理员/裁判前端、球员前端和后端需同步发布。已发布的0001—0018未修改；0019只新增字段与表，不回填旧比赛场地。

## 业务规则

- 中国标准时间今天至第6天，共7个自然日；仅当前启用且未结束赛季。当天已开球的比赛仍展示关闭原因。
- 裁判账号启用且比赛所属赛季注册审核通过才可报名。主裁main、边裁assistant、四官fourth、监督supervisor可多选且至少一项；两位边裁统一报名。
- 开球时刻起禁止报名、修改、撤回，没有独立截止时间。旧比赛时间待定时不开放报名。
- 报名和正式选派独立。撤回、资格退回或账号停用不删除原正式岗位；失效报名不参与优先排序。已有正式岗位仍受原资格核查与报告锁定约束。
- 改期保留报名，按上次报名的时间和场地快照提示变化。仍有效的旧报名移出7天窗口后，可以从“我的报名”修改或撤回；已撤回者只能在窗口内重新报名。
- 2026-09-24规则调整（2026-09-25已上线）：管理员可删除尚未开球的比赛，报名及其历史、选派、报告与结果一并删除。时间待定需先补齐，恰好开球起禁止。详见[删除规则与验收](https://github.com/Limgelir/TJ-RefWeb/blob/1013304/docs/schedule-deletion-verification.md)。
- 场地选择：樱花人草、129运动场、铁笼、嘉定人草、嘉定天然草、其它。“其它”必须填写1—120字具体地点。新比赛必填；旧比赛null显示场地待定，填齐后不能清空。报告开始后场地与时间一同锁定。

## 裁判接口

`GET /api/match-signups?view=week|mine&page=1&page_size=20`

仅裁判本人可用。week为当前赛季未来7天；mine包括本人历史、撤回及窗口外报名。返回items、pagination、current_season、server_time（中国标准时间）、window。单场只返回对阵、日期、时间、场地、本人状态与意向、本人正式岗位、资格及不可操作原因；不返回报告、其他报名人、球员名单、学号或私有材料。

`PUT /api/match-signups/:scheduleId`

```json
{
  "action": "save",
  "intentions": ["main", "assistant"],
  "revision": 0,
  "schedule_revision": 0
}
```

action为save或withdraw；revision使用列表返回的signup_revision，首次为0；schedule_revision使用列表当前值。操作者固定来自登录令牌，不接受referee_id。撤回不需要intentions。

每场/裁判唯一报名记录，状态为active/withdrawn；变化追加历史，原记录不删除。同一版本相同内容重复保存不新增事件。并发或旧版本返回409，前端保留尚未提交的意向并刷新当前状态，让裁判核对后再次明确保存。赛程行锁串行协调改期、删除、正式选派与报名；锁定相关资格后用数据库UTC时钟转换UTC+8判断截止。

## 管理员接口

- `GET /api/match-signups/admin/:scheduleId`：分页列出报名、撤回、当前资格、意向、正式岗位和时间/场地变化提示。
- `GET /api/match-signups/admin/:scheduleId/:signupId/history`：该比赛下对应报名的变化历史。事件时间为明确UTC的ISO字符串，前端按Asia/Shanghai展示。
- `GET /api/officials/candidates?season_id=12&schedule_id=85&role=main`：比赛ID必须与赛季匹配，role仍为main/assistant1/assistant2/fourth/supervisor。后端排序后分页：有效已报名且意向匹配→有效已报名其他意向→未报名；组内维持姓名、来源、编号稳定排序。搜索支持姓名和学号；未报名合格者仍可选，监督只允许系统裁判。
- 新建比赛尚无ID时，候选接口可省略schedule_id，沿用该赛季合格名单。已有比赛的前端选派和编辑均传入比赛ID。
- 管理员赛程列表、详情的signup_count为当前报名有效且账号/赛季资格有效的人数。

## 赛程写入扩展

POST /api/schedule增加venue、venue_detail；固定场地只填写venue，“其它”两字段都填写。

PUT /api/schedule/:id与PUT /api/schedule/:id/assign-referees必须携带读取到的整数schedule_revision。每次成功写入递增；缺失、错误或并发旧值返回409/SCHEDULE_REVISION_CONFLICT，禁止覆盖新赛程/选派。前端错误后保留当前表单，核对并重新加载最新赛程后再保存。不能继续使用不带版本的旧客户端。

更新venue漏传时保留原值，旧null场地可继续待定；已知场地不能清空。venue_detail只用于“其它”，不接受固定场地夹带详情。字段进入赛程主数据、公开/球员赛程、CSV、模板预填及新报告快照；旧快照不伪造场地。仅改场地不改变按日期解析名单的规则。

## 验证与运维

新增两项数据审计：报名当前状态/意向与连续追加历史一致，意向白名单且无重复。数据库外键禁止级联删除报名历史。回退以完整数据库及上传备份恢复或前向修复为主，不能删除0019记录或新表来伪造回退。新服务器仍按空库部署，本文不代表已部署。
