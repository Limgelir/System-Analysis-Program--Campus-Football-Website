# 球员系统接口与数据约定

性别与标签（迁移0030）：球员注册必填 `gender: "male" | "female"`；旧账号返回 `null`，前端立即弹窗。本人 `PUT /api/player/me/gender` 仅允许首次填入，管理员 `PUT /api/player-admin/:id/gender` 须同时提供 `reason`；两者均须账号版本 `If-Match`，保存递增版本并记录 `gender_changed`，本人重复修改返回409 `PLAYER_GENDER_LOCKED`。

赛事设置新增布尔 `enable_sports_training`（默认true）、`enable_football_specialty`（默认false）、可空单项上限 `max_football_specialty_players` 和 `combined_player_limits` 数组。组合格式为 `{ "tags": ["foreign", "football_specialty"], "max": 5 }`，标签可选 `foreign/sports_training/football_specialty`，须选择2—3个已启用且不重复的标签，最多4个唯一组合；同一球员在一组内只计1人。名单增加布尔 `is_football_specialty`；关闭的标签不会在展示DTO中暴露有效标记或参与自动限制。

球员 `POST /api/player/team-applications/:id/submit-manual` 使用申请版本 `If-Match`，仅自动失败且仍有提交权限的申请可调用；重新验证基本资料后进入pending，保存 `auto_review.manual_requested=true`。管理员仍须使用 `override-approve` 并填写原因来通过未满足自动限制的申请。在线名单缺性别返回400 `TEAM_GENDER_REQUIRED`，任何人工通过入口也不能跳过。详见[球员标签规则实现](../backend/utils/teamTags.js)。

学院管理：注册学院及学院修改申请的新学院须为共享目录50项之一。球员修改学院必须截图审核；直接修改资料接口不能改变学院。裁判本人 `PUT /api/referee/:id/college` 仍直接保存，与赛季状态独立。迁移0025只自动更新可靠匹配的裁判学院，保留球员原学院；0026新增球员学院审核表。球队自动检查读取当前生效账号学院。详见[学院规则实现](../backend/utils/collegeIdentity.js)。

报名限制：赛事可选报名限制、`auto_failed`状态、批准前重查、管理员填写原因人工通过、跨赛事参队明细和学籍详情以[球队自动审核规则](team-auto-review-rules.md)为准。下文早期“外援／运训仅人工审核”等描述由该约定补充。

赛季字段：共用管理员 `POST /api/season` 的 `season_code`、`season_name` 去除首尾空格后均为必填、最多20个Unicode字符；超过时返回400及明确中文原因，不改变当前启用赛季。比赛时间、场地与裁判报名规则见[阶段2接口约定](phase2-signup-contract.md)。

适用：第1—5批（阶段1—9）。已确认业务规则以 `player-system-requirements.md` 为准。本文明确已实现接口及后续批次的接入约定，标为“后续”的路径目前没有业务路由。

## 学院审核新增接口

| 方法与路径 | 请求及结果 |
| --- | --- |
| GET `/api/player/college-changes/current` | 本人 `account,pending,items,pagination`；支持 `page/page_size` |
| POST `/api/player/college-changes` | multipart `new_college,account_revision,academic_image`；UUID `Idempotency-Key`；201返回 `change,account,events,replayed`。原学院由服务端取账号；图片验证复用学籍上传 |
| GET `/api/player/college-changes/:id`、`/:id/image` | 本人申请详情、操作历史及私有截图 |
| POST `/api/player/college-changes/:id/withdraw` | 空对象及申请版本 `If-Match`；仅待审可撤回 |
| GET `/api/player-admin/college-changes` | `status,q,page,page_size`；状态pending/approved/returned/withdrawn；返回items/summary/pagination |
| GET `/api/player-admin/college-changes/:id`、`/:id/image` | 管理员详情和私有截图 |
| POST `/api/player-admin/college-changes/:id/approve` | `If-Match`申请版本；`account_revision`必填，`reason`可选；复核后事务更新学院、审计和提示 |
| POST `/api/player-admin/college-changes/:id/return` | `If-Match`申请版本；`reason`必填，账号学院不变 |

申请独立于赛季/窗口，最多一条待审；重提须上传截图。非法学院400 `COLLEGE_SELECTION_REQUIRED`，已有待审409 `COLLEGE_CHANGE_PENDING`，状态/版本/账号变化409。截图仅本人/管理员可读、private/no-store。完整规则见[学院审核实现](../backend/services/playerCollegeChangeService.js)。

## 工程与身份

- `frontend/`：原裁判端和共用管理员端，开发端口 5174。
- `player-frontend/`：独立球员端，开发端口 5175；独立依赖和锁文件，沿用 Vue/Vite/Axios 与现有校徽。
- `backend/`：同一个 Express 服务、同一个 MySQL 库，开发端口 3000；两个前端代理本站 `/api`。
- 球员用 `player_accounts.id` 永久标识，与 `referee.id`、学号均不是同一身份空间。JWT 的 role 必须匹配对应端点，不能用数字 ID 相等推导岗位权限。
- 球员仅使用 `playerToken` 本地存储键；管理员、裁判仍使用原存储键。服务端校验启停、token_version 和强制改密状态。
- 学号在球员账号内按数据库唯一约束比较（不区分大小写）；修改后立即释放旧号。历史关系只使用永久 ID，不按姓名或历史学号自动归并。
- 账号资料修改记录前后快照。姓名直接更新，学院须截图审核通过后更新；当季正式名单读最新生效资料，历史批次和报告保留快照。

## 已实现接口

球员路径前缀 `/api/player`；所有响应禁止缓存，密码哈希和内部会话版本不返回。

| 方法与路径 | 权限 | 请求与结果 |
| --- | --- | --- |
| POST `/register` | 访客 | `student_id,name,college,password,password_confirm`；201，返回账号资料；不自动登录 |
| POST `/login` | 访客 | `student_id,password`；返回账号资料和 `token` |
| GET `/me` | 球员，包括需改临时密码者 | 本人资料：`id,student_id,name,college,is_active,must_change_password,revision,created_at,updated_at` |
| PUT `/me` | 正常球员 | `name`，立即保存；兼容传入与当前值完全相同的 `college`，若不同则400 `PLAYER_COLLEGE_REVIEW_REQUIRED`，不部分保存姓名 |
| PUT `/me/student-id` | 正常球员 | `student_id,current_password`；成功后 `reauthenticate:true`，所有旧会话失效 |
| PUT `/me/password` | 球员，包括需改临时密码者 | `current_password,new_password,password_confirm`；成功后重新登录，解除强制改密 |
| POST `/logout` | 球员，包括需改临时密码者 | 空对象；撤销该账号所有旧令牌 |
| GET `/context` | 正常球员 | `season` 或 null；`features.season_registration/team_registration` 为 true，`public_matches` 为 false；主页使用下述注册与球队上下文 |

管理员路径前缀 `/api/player-admin`；只有完成密码初始化的管理员能使用。

| 方法与路径 | 请求与结果 |
| --- | --- |
| GET `/` | `q` 搜索姓名/学号/学院，`active=0或1`；`page` 默认1，`page_size` 默认20、最多100；返回 `players,pagination` |
| GET `/:id` | 返回 `player,history`，history 为最近100条账号操作和前后快照 |
| POST `/:id/reset-password` | `reason` 必填；返回一次性显示的随机 `temporary_password`，旧令牌失效；下次登录必须改密 |
| PUT `/:id/status` | `is_active` 为布尔值，`reason` 必填；启停均撤销旧令牌 |
| PUT `/:id/student-id` | `student_id,reason`；核实后纠正，不合并账号，旧学号立即释放，旧令牌失效 |

除注册、登录外的上述写接口必须发送 `If-Match: <revision>`，例如 `If-Match: 0`。版本是十进制整数，不加引号。读取、校验、写入、版本递增与事件写入在事务内完成；普通球员在写事务内再次检查会话版本和启停。

成功响应：`{success:true,data:...}`。错误响应：`{success:false,code,message}`（登录及原有认证中间件保留既有错误结构，客户端以状态码和 message 处理）。

| HTTP | 典型情况 | 客户端行为 |
| --- | --- | --- |
| 400 | 字段错误、当前密码错误、缺少核实原因 | 保留输入并显示原因 |
| 401 | 未登录、令牌撤销/过期、停用 | 清除球员会话并重新登录 |
| 403 | 角色错误或 `PLAYER_PASSWORD_CHANGE_REQUIRED` | 拒绝操作；需改临时密码时前往账号设置 |
| 404 | 账号不存在 | 提示并返回列表 |
| 409 | `PLAYER_REVISION_REQUIRED/CONFLICT`、`STUDENT_ID_TAKEN` | 刷新核对或换学号，不自动覆盖别人保存的资料 |
| 429 | IP 速率限制或持久登录锁 | 按 Retry-After 等待；保留错误提示 |
| 500/503 | 内部失败 | 通用提示，不返回 SQL、密码和令牌 |

不自动重试写请求。网络中断导致结果不确定时先刷新资料或重新登录核验；版本号和唯一索引阻止重复注册、陈旧写入。密码遵循现有策略：至少8位、大小写字母/数字/符号至少两类、最多72 UTF-8字节。重置密码不写入审计快照、日志或持久通知。

登录失败计数写入 `login_security_buckets`，以角色+账号ID归并；Unicode 别名以数据库确认的账号为准。五次同账号同来源失败会锁5分钟，跨来源账号阈值20次。球员和裁判的 IP 登录/注册限流实例独立。开发默认每 IP 注册5次/小时；集中验收及后续校园共享出口部署须通过 `REGISTRATION_RATE_LIMIT_MAX` 配置适当阈值。测试运行器只在隔离环境提高 IP 阈值，保留账号锁阈值。

## 第2批已实现：窗口、学籍和站内提示

所有端点需正常登录且已完成临时密码修改，角色由后端确定。日期时间输入采用带 `+08:00` 的ISO字符串（如 `2026-09-08T18:00:00+08:00`），返回统一保留三位毫秒。窗口开放时刻包含、截止时刻不包含。未配置时间成对传null；写入不依赖服务器所在时区。

| 方法与完整路径 | 请求和结果 |
| --- | --- |
| GET `/api/player/season-registration/current` | 当前赛季及本人账号、申请、提交/审核快照、`revision`、`status`、窗口时间和状态、`can_submit/can_withdraw/is_correction`、材料版本、操作记录、已启用赛事；无赛季时 `season:null` |
| POST `/api/player/season-registration/submit` | multipart：`season_id,account_revision,academic_image`；`If-Match` 为申请revision，无申请为0；另需UUID `Idempotency-Key`；返回201及最新本人上下文 |
| POST `/api/player/season-registration/withdraw` | JSON `season_id`、申请 `If-Match`；仅pending可撤回，重提须处于普通窗口 |
| GET `/api/player/season-registration/:id` | 本人当前或历史申请详情；其他球员403 |
| GET `/api/player/season-registration/:id/files/:fileId` | 本人私有材料二进制，只读；`Cache-Control: private, no-store`；清理后410 |
| GET `/api/player/notifications` | 本人最近30条提示及已读时间，不返回其他人的材料或身份信息 |
| PUT `/api/player/notifications/:id/read` | 本人提示标记已读，重复标记不重写首次已读时间 |
| GET `/api/player-admin/season-settings/:seasonId` | 赛季聚合配置；未设置时返回revision0和三个关闭的赛事，不因读取写入数据库 |
| PUT `/api/player-admin/season-settings/:seasonId` | 配置 `If-Match`；个人开放/截止时间与完整三项 `competitions`，整体保存、审计和版本递增 |
| GET `/api/player-admin/season-settings/:seasonId/history` | 最近50次配置前后快照、管理员与时间 |
| GET `/api/player-admin/season-registrations` | `season_id` 默认当前、`status`、`q`（姓名/当前学号/学院）、`page/page_size`；返回 `season,items,summary,pagination` |
| GET `/api/player-admin/season-registrations/:id` | 申请、最新账号资料与revision、提交/审核资料快照、文件版本、最近100条申请事件 |
| POST `/api/player-admin/season-registrations/:id/approve` | 申请 `If-Match`，JSON `account_revision,reason`；reason可空，账号版本变化须刷新核对 |
| POST `/api/player-admin/season-registrations/:id/return` | 申请 `If-Match`，JSON `reason` 必填；pending → returned |
| POST `/api/player-admin/season-registrations/:id/revoke` | 申请 `If-Match`，JSON `reason` 必填；approved → revoked，通知本人及相关正式球队负责人/队长 |
| GET `/api/player-admin/season-registrations/:id/files/:fileId` | 管理员私有材料二进制，限制同上 |

0020 起赛事配置项：`league_type,is_enabled,registration_opens_at,registration_closes_at,rules_text,change_windows,yellow_threshold,yellow_suspension,red_threshold,red_suspension`。新赛季赛事为空，由管理员逐项添加；支持预设和自定义名称，四项停赛参数必填，已有正式报告后锁定。详见[赛事与停赛约定](competitions-discipline-contract.md)；`change_windows` 每项包含 `id`（新建为null）、`opens_at,closes_at`。已有窗口ID必须属于当前赛事，移除只标记取消，历史保留。名单修改窗口配置已经通过本资源完成，后续名单申请直接使用此配置，无需另设重复配置入口。

上传最多一张5MB JPG/PNG，验证实际文件签名和完整结束标记；保存在 `UPLOAD_ROOT/player-academic` 的随机文件名下，无静态公开路由。接口只返回文件ID、revision、类型、摘要、时间和可用状态，不返回磁盘路径。浏览器携带Authorization读取Blob，切换或离开页面时回收对象URL。

同一球员同一幂等键且请求内容一致时返回已有结果，`replayed:true`，不重复落盘、创建申请或事件；内容不同409。不同幂等键用旧申请版本提交同样409。资料、申请状态、版本、文件引用、申请事件与通知采用事务更新。上传写入中途数据库失败会删除本次新文件；提交结果不确定时保留文件供检查，避免误删可能已提交的引用。

普通无记录/withdrawn提交要求窗口开放；returned/revoked可截止后补正。提交及审核仍要求当季启用且未结束。approve前检查最新账号版本、启用状态、截图文件仍存在；重新提交保存新的账号快照，通过审核另存审核时账号快照，事后修改资料不会倒改历史。

新增典型409代码：`PLAYER_WORKFLOW_CONFLICT`、`PLAYER_PROFILE_CHANGED`、`PLAYER_REQUEST_KEY_CONFLICT`、`PLAYER_REGISTRATION_WINDOW_CLOSED`、`PLAYER_REGISTRATION_STATE`、`PLAYER_SEASON_CHANGED`、`PLAYER_SEASON_ENDED`、`PLAYER_MATERIAL_UNAVAILABLE`。前端保留错误提示，要求刷新核对，不能静默覆盖。审核记录与通知在同一事务内产生，重复审核409。

`playerRegistrationService.assertEligible(connection,playerId,seasonId)` 是球员线上报名在写事务内调用的资格校验；拒绝未通过、已撤销、停用账号、跨季或已结束赛季。2026-09-23 管理员特殊导入改为允许先录入待关联身份，账号授权仍须学号、姓名一致且当季学籍审核通过，不改写旧报告和进球快照。

## 第3批已实现：球队报名、整队审批和角色变更

所有路径要求正常登录，创建和写操作再次校验当前赛季、账号启用及会话版本。球员只能管理自己负责或担任场上队长的球队；普通成员可看本队报名的允许字段，不能编辑、读取队友学号或审核历史。材料仍通过第2批私有接口读取。

| 方法与完整路径 | 请求和结果 |
| --- | --- |
| GET `/api/player/team-applications/context` | `seasons,current_season_id,competitions,ended`，只返回当前赛季已启用赛事配置 |
| GET `/api/player/team-applications` | 本人管理或参与的初始报名；`season_id`默认当前，`status,league_type,q,page,page_size`；`season,items,pagination` |
| POST `/api/player/team-applications` | `season_id,competition_id,team_name`及可选三项颜色；创建人为负责人，UUID `Idempotency-Key`必填，201返回草稿详情 |
| GET `/api/player/team-applications/:id` | 报名元数据、当前管理角色、名单、汇总、窗口、权限；管理角色另含补正范围、差异、历史及资料快照 |
| GET `/api/player/team-applications/:id/players?student_id=...` | 本队管理角色在可编辑状态下按当前完整学号查询；只返回已通过当季资格的账号信息，不查历史学号 |
| PUT `/api/player/team-applications/:id` | 全量草稿体及申请 `If-Match`；号码允许暂缺，保存后新队长立即获得协作权 |
| POST `/api/player/team-applications/:id/submit` | 空对象及申请 `If-Match`；完整校验、冻结名单、保存提交快照，变pending |
| POST `/api/player/team-applications/:id/withdraw` | 空对象及申请 `If-Match`；仅正常报名窗口内pending可撤回 |
| GET `/api/player-admin/team-applications` | 管理员按赛季/赛事/状态/队名分页查询，参数同球员列表 |
| GET `/api/player-admin/team-applications/:id` | 完整申请、每人最新资料/学籍状态、同类赛事有效已通过队数、截图申请ID、历史和 `review_token` |
| POST `/api/player-admin/team-applications/:id/approve` | `review_token,reason`（reason可空）、申请 `If-Match`；同一事务发布原正式球队、初始名单批次、事件与通知 |
| POST `/api/player-admin/team-applications/:id/return` | `review_token,reason,replaceable_member_ids,member_comments`、申请 `If-Match`；reason必填，指定ID为稳定名单行ID，comments为行ID到说明的对象 |
| POST `/api/player-admin/team-applications/:id/revoke` | `review_token,reason`（必填）、申请 `If-Match`；仅当前启用赛事已通过的线上首次报名可撤销，返回 `revoked`，保留球队编号、名单批次及赛程 |
| GET `/api/player/teams/:id/role-candidates` | `role=manager或captain,student_id`，仅现任管理角色；新负责人须有启用账号，新队长另须在当前有效名单且通过当季资格 |
| GET `/api/player/teams/:id/role-changes` | 当前管理角色、球队revision、`can_request`及最近100条申请 |
| POST `/api/player/teams/:id/role-changes` | `role,new_player_id,reason`、**球队** `If-Match`、UUID `Idempotency-Key`；201返回申请详情，每队每角色最多一份pending |
| GET `/api/player/role-changes/:id` | 现任管理角色读取原任/新任资料、申请、历史；申请人身份本身不授予权限，仍按球队当前角色判断 |
| POST `/api/player/role-changes/:id/withdraw` | 空对象及**角色申请** `If-Match`；pending可撤回，正常窗口外也可操作 |
| GET `/api/player-admin/role-changes` | `season_id,status,page,page_size`，管理员分页查询角色申请 |
| GET `/api/player-admin/role-changes/:id` | 申请详情、当前有效名单及资格检查、历史、`review_token` |
| POST `/api/player-admin/role-changes/:id/approve`或`/return` | `review_token,reason`及角色申请 `If-Match`；退回必填理由；通过立即改变角色及权限，原名单历史不重写 |

草稿体：`team_name,shirt_color,shorts_color,socks_color,members`。每个成员含 `id`（首次保存新行为null）、永久 `player_id`、`jersey_number`、布尔 `is_captain,is_goalkeeper,is_foreign,is_sports_training`。不接受客户端提交任意负责人、赛事或快照。号码在接口内用规范化十进制字符串传递，避免JavaScript大整数精度损失；0有效、前导零移除，当前存储容量为20位。草稿缺号允许多行null，提交须逐行完整、恰好一名队长且同队号码/球员无重复。线上报名没有31人上限。

普通draft/withdrawn仅报名窗口内创建、编辑、提交；returned在截止外可受限补正。`team_return_replacements`按**最新returned事件的revision**取授权，包括最新轮次未指定任何人的情况；不继承旧授权。补正时稳定行数和ID保持，仅指定行可改player_id；号码、角色、标记、队名及颜色可按理由修正。保存与重新提交两次校验。被移除的草稿行软保留，审计快照记录原资料，不能用别的申请行ID写入。

状态更改使用 `If-Match`、记录锁、唯一事件revision及原子事务；球队工作流使用READ COMMITTED避免等待赛季写锁后仍看到旧快照。相同创建幂等键和内容返回原申请，键复用到不同内容409。已处理审核再次提交409，不会再发布正式队或名单。角色申请撤回/退回后重新申请应使用新幂等键。

管理员详情的 `review_token` 摘要覆盖申请/球队版本、赛事配置和所审成员的最新账号资料、学籍及同类赛事队数。审核时锁定相关资料重新生成摘要，变化返回 `TEAM_REVIEW_CHANGED`；不能在旧审核页盲目批准。正式队名按赛季、赛事唯一，在提交和审批时双重检查；允许不同赛事同名。首次发布和后续名单变更均立即生效，已有当天和过去赛程保留名单选择。

成员数量按本赛季同类赛事、当前有效正式批次中的不同team_id统计，排除其他赛事、待审申请、未来名单版本和重复批次。正式角色审批只修改team中的当前角色指针并追加历史；原team_player姓名/角色快照及比赛记录不改写。当季报名页队长显示采用当前角色指针。

新增迁移 `0015_team_application_workflow` 保存提交/退回快照、成员说明、幂等键、稳定成员软移除、正式球队修订号、角色申请资料快照与 `team_role_change_events`。旧直接写入入口拒绝绕过审核；第4批通过统一的预览确认和名单发布服务接入新导入。

## 0031：撤销球队报名通过

0031 增加 `revoked`（已撤销通过）、`application.revoke_reason`、`application.registration_revoked` 和 `permissions.can_revoke`。撤销时沿用当前负责人、队长及最新正式名单，原申请的负责人／草稿队长仅可在报名窗口内编辑和重提；截止外不能保存、普通提交或申请人工审核，退回也不延长该队报名期限。重新提交变为待审核，再次通过沿用球队编号并追加正式名单版本。

撤销原因向本队成员展示并发送站内通知，前后快照保留在 `revoked` 事件中。撤销期间不计入当前正式参队统计，也不能安排新赛程或通过名单／角色变更、导入绕过重审。已有赛程、比分、历史名单保留，已有赛程仍可维护；撤销前已安排的比赛保留当时采用的名单，重新通过不自动替换这些比赛的名单。此功能仅覆盖在线首次报名，不撤销 Excel 导入或单独的中期名单变更。

队长、守门员、外援、运训、足球特长生为独立标记，可以兼任；正式提交仍要求恰好一名队长。运训和足球特长生受赛事标签开关及人数上限约束，多标签合并上限按球员去重。

## 权限矩阵

“负责人/队长”是某支球队的关系权限，不能靠登录 JWT 中自报角色获得。管理员权限沿用现有全部管理员，不另分管理等级。

| 能力 | 访客 | 普通球员 | 本队负责人/场上队长 | 管理员 |
| --- | --- | --- | --- | --- |
| 账号资料、密码、学号 | 注册/登录 | 仅本人 | 仅本人 | 账号维护与核实处理 |
| 个人当季提交/撤回/补正 | 否 | 仅本人 | 仅本人 | 审核/退回/撤销资格 |
| 学籍截图 | 否 | 仅本人 | 仅本人，不能看队友 | 可看审核材料 |
| 球队草稿与名单提交 | 否 | 可创建自己负责的球队 | 仅本队，两者都能操作 | 整队审核；新版导入已接入 |
| 未公开学号 | 否 | 仅本人 | 本队 | 可查询 |
| 公开名单与正式比分 | 可看 | 可看 | 可看 | 可看 |
| 注册/报名/名单变更窗口 | 否 | 否 | 否 | 可设置 |
| 确认结束赛季及清理 | 否 | 否 | 否 | 可执行 |
| 原裁判报告内部接口 | 否 | 否 | 否 | 沿用原管理员权限 |

公开名单只输出姓名、学院、号码、场上队长、守门员、外援和运训。负责人不必是参赛球员，不要求其本人先通过学籍审核；进入参赛名单的人必须当季审核通过。

## 路径与状态转换

下列资源已按批次接入；排行榜和赛程赛制扩展明确返回未启用状态。

| 后续资源前缀 | 操作约定 | 批次 |
| --- | --- | --- |
| `/api/player/teams/:id/roster-changes` | 已实现，见下方第四批接口 | 第4批 |
| 原管理员球队导入 API | 预览确认；支持先录入后关联账号，颜色选填，不受球队报名及名单修改窗口限制 | 第4批及2026-09-23调整 |
| `/api/player/my-teams`、`/api/public/teams` | 我的队伍/管理队伍、公开名单、已有赛程比分与本人进球 | 第5批 |
| 排行榜、管理员赛程赛制扩展 | 第5批制定并落地预留接口，不实现排名/排赛引擎 | 第5批 |

管理员目前已开放球员账号管理、学籍审核、赛季赛事与窗口设置、整队审核及角色变更审核；人员名单变更已在第4批接入；结束赛季已在第5批加入。

个人注册：无记录 → pending；pending → approved/returned/withdrawn；returned/withdrawn/revoked → pending；approved → revoked。每次提交一张截图，以新 revision 保存材料及资料快照；撤回后再提交需正常窗口，管理员退回及撤销资格后的补正均可在截止后提交。

球队申请：draft → pending → approved/returned；pending 可撤回；returned 可补正后再 pending；withdrawn 在正常窗口内再编辑。提交后冻结审核版本；整队通过后写入同一正式 `team` 库并创建名单批次。重复审批同版本必须返回既有成功结果或明确已处理，不再生成新批次/通知。

审批使用记录锁、If-Match 和唯一事件版本，原子更新申请、正式名单、事件及通知。前端禁止重复点击只是体验措施，不能代替服务端约束。审核前重新检查当季资格、号码唯一、角色及跨季关系；总人数、外援/运训数量、逐球员同赛季同类型已通过队伍数仅展示，管理员人工判断。统计按正式 team_id 去重，不能把名单批次算成多支队伍。

截止后退回：管理员填写理由，并选择允许替换的原申请成员 ID。`team_return_replacements` 保存明确范围；不能解析退回文字推断权限。未指定成员锁定，不可自由增删；补正应在重新提交和审批时都复核范围及版本。

## 数据基础及时间

迁移 `0013_player_foundation` 新建15张表：账号/事件，赛季设置/赛事/多轮窗口，个人注册/材料/事件，球队申请/成员/事件/退回替换范围/角色申请，站内通知，正式结果快照。正式 `team`、`team_roster_batches`、`team_player` 增加可空身份、来源、颜色、角色和生效日期字段，继续承接原报告引用。

迁移 `0014_player_registration_workflow` 新增配置事件和提交幂等记录两张表；增加审核账号快照、窗口取消状态和通知赛季关联。不改写已发布的0013或已有业务行。数据审计包含学籍申请事件/当前状态、退回原因、提交图片引用和全部尚未清理的材料历史文件。

- 旧名单的 `player_account_id` 和未确认标签保持 NULL，来源为 legacy；不自动按同名或旧学号关联。2026-09-23 起管理员新导入保存学号、姓名及稳定的导入身份；一致且当季审核通过才关联永久账号 ID，原 legacy 行不推测关联。
- 名单读取统一使用：`playerRosterService.roster(batch,{currentProfile})` 选择实时资料或历史快照；`effectiveBatch(team,date)` 按业务日期读取生效批次，旧批次提供兜底。正式审批/导入才创建带生效日期的批次。
- 2026-09-09更新：名单审核通过立即生效，`effective_from` 保存中国业务日期，`approved_at` 保存实际审核时间。同日版本按版本号取最新；已有当天及过去赛程在发布前保存明确选择，报告开始也保存选择。未来未开始报告的赛程按比赛日期动态解析。`nextEffectiveDate` 旧工具保留兼容测试，但不参与新发布流程。
- 后续窗口入参采用带 `+08:00` 的 ISO 时间；窗口 DATETIME 存中国墙上时间，服务端显式转换、比较，不依赖操作系统时区。业务比赛 DATE 保持 YYYY-MM-DD，禁止转换为少一天的 UTC 日期。
- `match_publications` 保存最新正式结果与报告历史引用。第5批在正式提交/正式修订事务中同步更新；退回保留该快照并展示修订中，草稿不发布。
- 结束赛季记录确认人和时间，在线材料逐项清理并可失败重试，保留审核事件、图片哈希及清理标记。已有备份暂不清理。

旧迁移 0001—0016 不修改。全新库结构同步更新，但现有库仅执行增量迁移，不重新导入 final_schema.sql。DDL 不能整体事务回滚；升级前配套备份，失败后检查结构、排除问题再重试。业务写接口遵守对应阶段的资格与窗口校验；建表不等于已启用审批或公开展示功能。

## 第四批：正式名单、变更和管理员导入（已实现）

| 方法与地址 | 权限及约定 |
| --- | --- |
| GET /api/player/teams | 球员本人：当前赛季参赛或管理的正式球队 |
| GET /api/player/teams/:id | 当前成员、负责人或队长；返回有效名单、版本、窗口、管理权限和变更申请 |
| POST /api/player/teams/:id/roster-changes | 当前负责人或队长；空JSON；If-Match为正式team.revision，Idempotency-Key为UUID；201返回变更草稿 |
| GET/PUT /api/player/team-applications/:id | 初次报名和名单变更共用详情、完整保存、submit和withdraw接口 |
| GET/POST /api/player-admin/team-applications/... | 同一审核入口处理initial和roster_change，成员资格/参队数核对及review_token均复用 |
| GET /api/team/import-template | 管理员下载根目录新版名单导入模板.xlsx |
| POST /api/team/import-preview | 管理员，multipart/form-data：roster_file、season_id、可选team_id、team_name、league_type、manager_student_id、manager_name；shirt_color、shorts_color、socks_color选填 |
| POST /api/team/import-confirm | 管理员，JSON为预览返回的preview和preview_token；Idempotency-Key为UUID；返回team_id/application_id/batch_id，重复成功请求返回replayed |
| GET /api/report/admin/schedule/:id/rosters | 管理员读取本场选择、候选批次、历史与review_token；items附带各队can_edit、edit_mode及edit_block_reason |
| PUT /api/report/admin/schedule/:id/rosters | 管理员，team_id、roster_batch_id、reason、review_token；当天或过去比赛，报告未开始可选择；报告开始后仅可补齐原名单为空且无该队进球/红黄牌引用的一方 |

2026-09-23补录调整：管理员可以明确选择比赛日期之后才生效、截至当前业务日已生效且非空的本队名单；不会自动回填其他历史比赛。未来比赛仍按比赛日期解析。选择理由、管理员与前后版本写入选择历史；review_token覆盖赛程、名单候选和主裁/监督报告修订，写入时锁定赛程并重新核验，陈旧页面返回409。补齐只改变本场该队名单选择，不修改已有报告、进球、红黄牌或报告修订历史。报告页刷新后使用新选择。

新版模板首个工作表第1行为学号、姓名、号码、场上队长、守门员、外援、运训、备注；逐实际行号解析，不限制31人，不静默忽略无效行。学号、姓名必填；学号用文本，号码规范化为非负整数字符串（最多20位），是/否或1/0，空标记视为否。错误逐行返回；can_confirm=false时不能发布。预览用服务端签名保护，30分钟有效，账号/资格/参队数/球队或赛事修订变化须重新预览。

管理员导入可在球队报名和名单修改窗口外确认，赛事暂停线上报名也可导入；仍须当前启用、未结束赛季与已添加赛事。未注册、未审核人员以 `imported_player_identities` 保存，不生成登录账号；名字不一致或账号停用不立即关联。学号和姓名与账号及审核快照一致、当季资格通过后，审核事务自动填写关联 ID 并授予球队角色。`0021` 增加导入身份与关联审核依据，申请/成员账号 ID 可空；历史报告、发布快照不重写，进球和纪律在读取时解析稳定身份。已有身份发生关联冲突需管理员核实，不静默换绑。

原POST /api/team及POST /api/team/:id/roster返回400并提示使用预览确认，防止旧客户端绕过审核。页面上的新建及重新导入入口保留。已有正式身份名单的PUT /api/team/:id不能绕开变更审核；负责人调整仍走独立角色审核。历史未关联球队导入的新批次关联永久ID，旧team_player行保持。

0016新增比赛名单选择与选择事件表，并增加申请来源、管理员导入幂等键、基线修订号、基线快照、导入文件名、成员备注、正式批次资料快照及进行中变更唯一约束。发布、比赛名单保留、成员复制、事件和通知在同一事务；名单变更只追加team_player，不改旧比赛引用。截止外返回补正按最近一次退回的稳定成员行校验。

正式队伍负责人／队长的权限在发布时立即更新；变更草稿指定的新队长在通过前不取得管理权。当前正式名单显示实时姓名学院，申请历史和比赛名单保留当时姓名。当前已通过同类球队数按有效名单去重，变更待审不增加计数，退出后保留历史进球。

报告详情附加match_rosters，两队球员选择与后端校验均使用本场所选批次；已有记录可保留原球员引用。改期或调整对阵时解除之前选择、追加重置历史，按新赛程重新解析；不能修改已经开始报告的赛程。

## 第五批：公开结果、本人进球与材料清理（已实现）

所有API返回`{success:true,data:...}`且`Cache-Control:no-store`。公开接口不需要JWT，不读取完整报告快照作为响应。球员详情只在本人请求中附加进球统计。

| 方法与地址 | 权限 / 返回 |
| --- | --- |
| GET /api/public/seasons | 访客可读：id、season_name、is_active |
| GET /api/public/teams?season_id=&league_type= | 访客可读：正式球队；省略赛季默认启用赛季，赛事可选 |
| GET /api/public/teams/:id | 访客可读：球队资料、当前或历史名单、该队赛程和正式结果 |
| GET /api/public/matches/:id | 访客可读：本场两队按选定批次的名单，只返回公开字段 |
| GET /api/player/my-teams?season_id= | 球员本人：is_member、was_member、can_manage；展示分组由前端按赛事拆分 |
| GET /api/player/team-results/:id | 球员：公开队伍结果加本人my_goals、各场my_goals；不能指定其他player_id |
| GET /api/player/season-registration/history | 球员本人：历次赛季申请ID及赛季名；详情仍按本人权限读取 |
| GET /api/player-admin/season-settings/:seasonId/cleanup | 管理员：预览赛季、配置revision、total、remaining、材料ID及清理事件，不删除 |
| POST /api/player-admin/season-settings/:seasonId/cleanup | 管理员：If-Match=配置revision，JSON含confirm_season_name完整名称；确认结束并清理，也用于失败重试 |
| GET /api/public/scorers?season_id=&league_type= | 预留射手榜，enabled:false、status:not_implemented，无排名数组 |
| GET /api/public/standings?season_id=&league_type= | 预留积分榜，同上 |
| GET /api/player-admin/competition-format?season_id=&league_type= | 管理员专用赛程/赛制扩展预留，同上 |

公开名单仅含姓名、学院、号码、队长、守门员、外援/运训及名单行ID，不含学号、球员账号ID、备注、资料快照、材料地址。进球公开字段为球队ID、计分球队ID、当时姓名/号码、类型和分钟标签；内部永久球员ID仅用于本人统计，不在公开进球响应中返回。

每场返回status=`unpublished | published | revising`。unpublished时result=null；不把默认0:0解释成完赛。result包含home_score、away_score、home_penalty_score、away_penalty_score及goals；点球大战与个人进球分开。my_goals仅累计同team_id及永久player_id的normal/penalty，不计own_goal，不跨赛事合并。

主裁submit_main或管理员主裁区正式revise在同一个报告写事务中更新match_publications，关联新生成的主裁历史ID和版本。管理员首次正式修订也发布；报告本身status不自动变submitted。保存草稿、普通图片操作、监督区操作不修改公开结果。退回通过当前报告状态标记revising，结果快照保持；重新正式提交以替换方式更新，不累加历史版本。

0017只增加player_material_cleanup_events，并从每份主裁报告最后一条符合条件的submit/revise/已提交baseline快照回填尚无发布的比赛；不从退回草稿当前表回填。旧记录中未关联的球员身份保持空，不按姓名补造身份。

清理先锁赛季并记录ended_at、ended_by_admin_id、cleanup_status，再对该季player_registration_files逐项核验和处理；确认后的球员工作流永久拒绝新提交。文件必须在受管player-academic目录、为普通文件且不被其他记录引用，拒绝越界路径、符号链接等异常。成功置file_path=null、cleaned_at；文件已缺失按幂等成功处理。失败记录材料ID及原因，保留其未清理状态，管理员刷新后可重试。已有备份不属于此任务。历史详情available=false，私有文件接口410，不再生成可用图片入口。开启/停用赛季或日期到期均不会触发清理。

扩展契约仅描述未启用能力，不引入另一套赛季、球队、比赛或球员基础库；现有赛程录入仍正常可用，未来赛制扩展接入相同ID。首版没有积分排名算法、同分规则、自动排赛或新的赛制编辑器。
