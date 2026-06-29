# 校园轻集市

根据最新版 `campus-light-market-prd copy.md` v3.0 改造的校园综合集市网站。当前项目已升级为 Vue + Express + MySQL 架构，包含响应式用户端、Web 管理后台、REST API 和数据库脚本。

## 运行方式

首次运行先安装依赖：

```bash
npm install
```

开发模式：

```bash
npm run dev
```

访问：

```text
统一入口：http://127.0.0.1:3003
API 地址：http://127.0.0.1:3003/api
```

开发模式下，Express 会在同一个端口托管前端页面和后端 API。普通用户和管理员都从 `http://127.0.0.1:3003` 登录。

关闭本项目端口：

```bash
for port in 3003 3004 5173 5174 5175 5176 5177; do
  pids=$(lsof -ti tcp:$port)
  if [ -n "$pids" ]; then
    kill $pids
    echo "已关闭端口 $port：$pids"
  fi
done
```

如果普通关闭后仍被占用，可把 `kill $pids` 改成 `kill -9 $pids` 后再执行一次。

生产模式：

```bash
npm start
```

## MySQL 配置

本项目默认使用独立数据库：

```text
campus_light_market_03
```

不要改成已有的 `campus_light_market`，避免和其他项目数据混淆。连接参数写在本地 `.env` 中，示例见 `.env.example`。

后端启动时会自动创建 `campus_light_market_03` 和运行态表 `app_state`。如果 MySQL 无法连接，会退回 `data/database.json` 本地降级模式，并在启动日志中提示 `Storage mode: json`。

## 演示账号

项目内置基础演示数据和账号，但不提供一键切换入口，需要在登录页按正常账号密码登录。

| 角色 | 账号 | 密码 |
| --- | --- | --- |
| 认证用户 | linxia | LinXia@2026 |
| 认证接单者 | runner | Runner@2026 |
| 未认证用户 | newbie | Newbie@2026 |
| 管理员 | admin | Admin@2026 |

## 项目结构

| 文件/目录 | 说明 |
| --- | --- |
| `index.html` | Vite HTML 入口 |
| `src/App.vue` | Vue 根组件 |
| `src/main.js` | Vue 启动入口 |
| `src/components/layout/` | 页面布局组件 |
| `src/styles/main.css` | 响应式样式 |
| `src/assets/` | 前端图片等静态资源 |
| `src/legacy/campusMarketController.js` | 原用户端、管理端交互控制器 |
| `src/legacy/constants.js` | 前端业务常量 |
| `src/legacy/seedData.js` | 前端默认结构和演示数据种子 |
| `src/legacy/domUtils.js` | DOM 与格式化工具函数 |
| `server/index.js` | Express 服务入口 |
| `server/routes/api.js` | REST API 路由 |
| `server/data/store.js` | MySQL 优先、JSON 降级的数据存储层 |
| `server/config/env.js` | 环境变量和 MySQL 库名校验 |
| `data/database.json` | JSON 降级模式和 MySQL 首次初始化种子数据 |
| `db/schema.sql` | MySQL 8 建表脚本，默认库名 `campus_light_market_03` |
| `src/assets/campus-market-hero.png` | 首页主视觉 |

## 已实现功能

- 用户端：首页、频道、搜索筛选、详情、发布、消息、个人中心。
- 管理端：数据看板、用户管理、认证审核、帖子管理、任务管理、举报处理、分类管理、公告管理、操作日志。
- 后端 API：Express 提供登录注册、当前用户、校园认证、帖子、任务、消息、举报、评价、后台管理。
- 数据持久化：前端读取 `/api/bootstrap`，操作后同步到 MySQL `campus_light_market_03.app_state`。
- 数据库交付：提供 MySQL 8 核心表、索引、外键、评分约束和运行态 `app_state` 表。

## 核心 API

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/users/me`
- `POST /api/verifications`
- `GET /api/listings`
- `POST /api/listings`
- `GET /api/tasks`
- `POST /api/tasks`
- `POST /api/tasks/:id/accept`
- `POST /api/messages`
- `POST /api/reports`
- `GET /api/admin/dashboard`
- `GET /api/admin/users`
- `GET /api/admin/listings`
- `GET /api/admin/reports`
- `GET /api/admin/categories`

## 验证命令

```bash
npm run check
curl http://127.0.0.1:3003/api/health
```
