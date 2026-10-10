# System Analysis Program--Campus Football Website

系统分析与设计课程小组项目：校园足球赛事、球队与裁判管理网站。

本项目基于个人校园足球项目 [TJ-RefWeb](https://github.com/Limgelir/TJ-RefWeb) 的网站代码建立独立课程副本，单独维护文件、Git 历史和数据库。包含管理员/裁判端、球员端及共用后端，支持赛季与赛事配置、球员学籍审核、球队报名和名单管理、裁判报名与选派、比赛报告和比分查询。

## 环境要求

- Node.js **22.12.0 或以上**，以及随附的 npm。
- MySQL **8.0 或以上**；创建数据库的账号需要建库、建表及触发器权限。
- Git。

以下命令以 Windows PowerShell 为例。安装 MySQL 时建议将其 `bin` 目录加入 PATH，使 `mysql` 命令可用。

## 本地启动

### 1. 获取代码并安装依赖

```powershell
git clone https://github.com/Limgelir/System-Analysis-Program--Campus-Football-Website.git
cd System-Analysis-Program--Campus-Football-Website

npm --prefix backend ci
npm --prefix frontend ci
npm --prefix player-frontend ci
```

本机已有副本时，直接进入 `D:\Limgelir\Files\System Analysis`，再执行三条安装命令即可。仓库根目录没有 `package.json`，三个子项目分别安装依赖。

### 2. 配置课程专用环境

首次配置时执行（已有 `.env` 时直接编辑，不要覆盖）：

```powershell
Copy-Item backend/.env.example backend/.env
```

编辑 `backend/.env`：

| 配置项 | 本地设置 |
| --- | --- |
| `DB_HOST`、`DB_PORT` | 本机 MySQL 地址和端口，默认 `127.0.0.1:3306` |
| `DB_USER`、`DB_PASSWORD` | 本机 MySQL 账号和密码 |
| `DB_NAME` | `campus_football_course`，课程专用数据库 |
| `TEST_DB_NAME` | `campus_football_course_test`，自动化测试专用数据库 |
| `JWT_SECRET` | 自行生成的随机密钥 |
| `ADMIN_BOOTSTRAP_USERNAME`、`ADMIN_BOOTSTRAP_PASSWORD` | 首次初始化管理员时临时填写，完成后清空 |

生成随机密钥并将输出粘贴到 `JWT_SECRET`：

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

两个前端默认通过 Vite 代理访问后端，无需额外配置。如果需要调整 API 地址，再分别复制前端的 `.env.example` 为 `.env`，设置 `VITE_API_BASE_URL`。

真实 `.env`、账号凭据、上传材料和备份均由 `.gitignore` 排除。

### 3. 创建并初始化空数据库

先启动本机 MySQL 服务。Windows 服务名若为 `MySQL80`，可在管理员 PowerShell 执行 `Start-Service MySQL80`。

创建一个全新的课程数据库（提示时输入本机 MySQL 密码）：

```powershell
mysql -u root -p -e "CREATE DATABASE campus_football_course CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

$env:INIT_CONFIRM='INIT_EMPTY_campus_football_course'
npm --prefix backend run db:init-empty
Remove-Item Env:INIT_CONFIRM
```

`db:init-empty` 只接受已创建且没有表的数据库，并自动完成初始化和全部增量迁移。如果数据库已存在且有数据，只需执行：

```powershell
npm --prefix backend run migrate
```

不要直接导入 `db/final_schema.sql`：该历史基础脚本包含固定的 `referee_system` 库名和删表语句。课程启动使用上面的空库初始化命令，由程序将结构导入 `.env` 指定的课程数据库，避免影响原项目。

### 4. 创建管理员

在 `backend/.env` 临时填写 `ADMIN_BOOTSTRAP_USERNAME` 和 `ADMIN_BOOTSTRAP_PASSWORD`。密码至少 12 位，包含大写字母、小写字母、数字、符号中的至少三类。

```powershell
npm --prefix backend run admin:bootstrap
```

成功后立即清空 `.env` 中这两个临时变量。系统没有预设的通用管理员账号；同名管理员再次执行此命令会重置密码。

### 5. 启动三个服务

在仓库根目录分别打开三个 PowerShell 终端，依次执行：

```powershell
# 终端 1：后端 API
npm --prefix backend run dev
```

```powershell
# 终端 2：管理员 / 裁判端
npm --prefix frontend run dev
```

```powershell
# 终端 3：球员端
npm --prefix player-frontend run dev
```

| 入口 | 地址 |
| --- | --- |
| 管理员登录 | http://localhost:5174/admin-login |
| 裁判端 | http://localhost:5174/ |
| 球员登录 / 注册 | http://127.0.0.1:5175/ |
| 公开球队与赛程 | http://127.0.0.1:5175/public |
| 后端健康检查 | http://127.0.0.1:3000/health |

首次登录后，管理员需要创建并启用赛季、添加赛事并配置报名窗口，之后再进行球员/裁判注册审核、球队报名及赛程安排。新数据库初始没有业务数据。

两个前端固定使用 5174、5175 端口，后端使用 3000。若原项目正在使用这些端口，先停止原项目的本地服务；前端不会自动切换到其它端口。

## 测试与构建

无需数据库的单元测试和前端构建：

```powershell
npm --prefix backend run test:unit
npm --prefix frontend test
npm --prefix player-frontend test
npm --prefix frontend run build
npm --prefix player-frontend run build
```

完整后端测试需要运行 MySQL，并正确配置 `backend/.env`；也可复制 `backend/.env.test.example` 为 `backend/.env.test` 单独配置测试连接：

```powershell
npm --prefix backend test
```

API 测试会创建、重建并删除 `TEST_DB_NAME` 指定的数据库。该库名必须以 `_test` 结尾，并且不能等于开发数据库名。不要把测试配置指向已有业务数据库。

## 目录结构

```text
backend/          Express API、业务逻辑、初始化/迁移脚本与测试
frontend/         Vue 管理员及裁判端
player-frontend/  Vue 球员端与公开查询页面
shared-ui/        共用界面组件和样式
shared-data/      共用业务选项
db/               基础数据库结构与连续版本迁移
docs/             业务规则和 API 参考
deploy/           原项目的部署工具及测试依赖；本地启动无需执行
.github/          自动化验证工作流
名单导入模板.xlsx  管理员批量导入名单的空白模板
```

业务与接口资料见 [球员需求](docs/player-system-requirements.md)、[球员 API](docs/player-api-contract.md)、[裁判报名](docs/phase2-signup-contract.md) 和 [赛事与停赛规则](docs/competitions-discipline-contract.md)。课程的提案、SRS、建模与小组分工由团队在此基础上另行整理。

## 常见问题

- **`mysql` 命令找不到**：将 MySQL `bin` 目录加入 PATH，或使用 MySQL 客户端执行建库语句。
- **数据库连接被拒绝 / 密码错误**：检查 MySQL 服务以及 `backend/.env` 的地址、端口和凭据。
- **提示数据库迁移未完成**：执行 `npm --prefix backend run migrate`，再启动服务。
- **端口被占用**：停止占用 3000、5174、5175 的旧进程，再启动本项目。
- **页面没有赛事或报名入口**：先由管理员创建启用赛季、添加赛事并设置相应窗口。
