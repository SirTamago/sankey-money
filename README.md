# 收支 / 分期 桑基图看板（web 版 · `web` 分支）

浏览器的完整版本：前端是原生 HTML/CSS/JS，后端是一个**本地 Python 服务器**（标准库，零依赖）负责静态托管与 SQLite 数据存取。界面与桌面版一致（Material Design 3 深色主题、自绘 SVG 桑基图、日历、表格视图）。

## 运行

```bash
python server.py            # 默认 http://127.0.0.1:8123
PORT=9000 python server.py  # 自定义端口
```

浏览器打开 **http://127.0.0.1:8123** 即可。数据文件为 `./data/finance.db`（首次运行自动建表并写入示例数据）。

> 不需要安装任何第三方包：只用 Python 标准库的 `http.server` 与 `sqlite3`。

## 架构

```
浏览器（网页 UI：桑基图 / 日历 / 表格）
        │  fetch  →  REST API
本地 Python 服务器（server.py）
        ├─ 静态文件托管（index.html / app.js / styles.css）
        └─ SQLite 数据（./data/finance.db）
```

前端存储层做了三种后端自动选择：**桌面桥接 → 本地 API → localStorage**。
页面启动时会探测 `GET /api/health`；探测到就打 API，否则回退到浏览器 localStorage（此时仍是纯静态可用）。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（前端据此判断是否走 API） |
| GET | `/api/ledgers` | 账单列表（含项目数） |
| POST | `/api/ledgers` | 新建账单 `{name}` |
| GET | `/api/ledgers/{id}` | 单个账单 + 全部项目 |
| PATCH | `/api/ledgers/{id}` | 重命名 `{name}` |
| DELETE | `/api/ledgers/{id}` | 删除账单（级联删项目） |
| PUT | `/api/ledgers/{id}/items` | 覆盖写入项目与区间 `{period_start, period_end, items}` |
| GET | `/api/ledgers/{id}/export.csv` | 导出 CSV（UTF-8 BOM） |
| GET | `/api/ledgers/{id}/export.sqlite` | 导出只含该账单的真实 `.sqlite` |

## 数据模型（SQLite）

```sql
CREATE TABLE ledgers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  period_start TEXT NOT NULL, period_end TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE items (
  id TEXT PRIMARY KEY, ledger_id INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  name TEXT NOT NULL, kind TEXT NOT NULL, category TEXT, amount REAL NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1, note TEXT,
  sched_type TEXT NOT NULL, sched_start TEXT, sched_end TEXT, sched_day INTEGER,
  sched_date TEXT, sched_month TEXT, sort_order INTEGER DEFAULT 0
);
```

排期类型：`recurring`（重复 · 固定日期，可自定起止，结束留空 = 永不结束）、`oneoff`（一次性确定日期）、`monthly`（按月手动）。桑基图按**起止日期区间**统计每个项目在该区间内的发生次数。

## 功能

- 多账单切换 / 新建 / 重命名 / 删除（数据存在 SQLite）
- 桑基图：`收入来源 → 总收入来源 → 总计划支出 → 各支出分类 + 结余/自由支配`，顶部常驻起止日期选择器（+ 本月 / 今年 快捷），悬停高亮与占比
- 日历：按天展示固定日期项目，点某天查看 / 编辑 / 新增
- 表格视图：直接编辑数据行，改动即时写库
- 导出 CSV / .sqlite
- Material Design 3 深色主题：自实现的 MD3 下拉选单、日期选择器、对话弹窗

## 目录

```
server.py                 # 后端（静态托管 + REST API + SQLite）
index.html / app.js / styles.css   # 前端源码
data/finance.db           # 运行时生成
README.md
```

## 分支

| 分支 | 说明 |
| --- | --- |
| **web**（当前） | 网页版 + 本地 Python 后端（SQLite） |
| md3 | Windows 桌面版（WinUI 3 + WebView2 + SQLite，MD3 主题） |
| winui | 早期桌面版（WinUI 3 + Fluent/Mica） |
| webui | 纯静态网页版（无后端，localStorage） |
