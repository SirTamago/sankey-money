# 收支 / 分期 桑基图看板

一个 Windows 11 桌面应用：录入每月的收入、支出、借贷（分期 / 贷款）项目，自动生成**按日期区间**的资金流向桑基图，并用日历与表格两种视图管理数据。界面为 **Material Design 3** 深色主题，数据存在本机 **SQLite** 文件。

- 便携版：`dist-md3\SankeyMoney.exe`（双击即用，无需安装 .NET）
- 桌面快捷方式：已创建 `收支桑基图.lnk`

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────────┐
│  WinUI 3 外壳（Windows App SDK）                          │
│  · 无边框窗口 + 网页内的 MD3 标题栏（拖动/最小化/最大化/关闭） │
│  ┌───────────────────────────────────────────────────┐  │
│  │  WebView2（承载网页 UI）                            │  │
│  │  index.html / styles.css / app.js                  │  │
│  │  · 桑基图（自绘 SVG）· 日历 · 表格 · MD3 组件        │  │
│  └───────────────────────────────────────────────────┘  │
└───────────────┬─────────────────────────────────────────┘
                │ postMessage 请求/响应桥接
┌───────────────▼─────────────────────────────────────────┐
│  C# 主进程                                               │
│  · SqliteStore：SQLite 建表 / 种子 / CRUD / CSV / 导出    │
│  · NativeBridge：方法分发（含窗口控制）                    │
│  · 数据文件：exe 同目录 data\finance.db                   │
└─────────────────────────────────────────────────────────┘
```

- **外壳**：WinUI 3（`Microsoft.WindowsAppSDK`）。窗口去掉了系统标题栏，改用网页里画的 **MD3 顶栏**；拖动、最大化、最小化、关闭都通过桥接调用原生。
- **内容**：WebView2 通过虚拟主机映射加载 `wwwroot/`（`https://app.local/index.html`），网页 UI 全部是原生 HTML/CSS/JS，无框架、无构建步骤。
- **数据**：C# 用 `Microsoft.Data.Sqlite` 管理真实 `.db` 文件；网页层不再用 localStorage（浏览器版才回退到 localStorage）。
- **通信**：**postMessage 桥接**（不是 COM host object）。网页发 `{id, method, args}`，C# 回 `{id, ok, result, error}`；`result` 是 JSON 字符串。

---

## 二、功能

- **多账单**：顶部下拉切换，可新建 / 重命名 / 删除；首次运行自动建「示例数据」（6 个演示项目）与「我的账单」。
- **项目**：名称、类型（收入 / 支出 / 借贷分期）、分类、金额、启用开关、备注。
- **排期**：`recurring`（重复，自定开始 / 结束日期，结束留空 = 永不结束，每月几号）、`oneoff`（一次性确定日期）、`monthly`（按月手动）。
- **桑基图**：顶部常驻**起 / 止日期选择器**（精确到年月日），另有「本月 / 今年」快捷。区间内按日期统计，结构为
  `收入来源 → 总收入来源 → 总计划支出 → 各支出分类 + 结余/自由支配`，超支时显示红色「超支」节点。悬停高亮相邻流并显示占比。
- **日历**：按天展示所有带确定日期的项目；点某天查看 / 编辑 / 当天新增一次性项目。
- **表格视图**：第三个标签页，直接把该账单的 SQLite 数据行当表格编辑（全部字段可改、可增删行），改动即时写库。
- **期间总额**：定期项目显示「月额 × 期数」的总消费；编辑弹窗实时预览。
- **导出**：**CSV**（含 UTF-8 BOM，Excel 可直接打开）与 **.sqlite**（只含当前账单的真实数据库文件，可被 DB Browser / Python 等外部工具读取）。

---

## 三、数据模型（SQLite）

```sql
CREATE TABLE ledgers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  period_start TEXT NOT NULL,       -- YYYY-MM-DD
  period_end   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE items (
  id          TEXT PRIMARY KEY,
  ledger_id   INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,        -- income | expense | loan
  category    TEXT,
  amount      REAL NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  note        TEXT,
  sched_type  TEXT NOT NULL,        -- recurring | oneoff | monthly
  sched_start TEXT, sched_end TEXT, sched_day INTEGER,   -- recurring
  sched_date  TEXT,                                      -- oneoff
  sched_month TEXT,                                      -- monthly
  sort_order  INTEGER DEFAULT 0
);
```

排期展开逻辑（前后端一致的心智模型）：给定日期区间 `[start, end]`，统计每个项目在区间内的**发生次数**，`recurring` 按每月 `sched_day`（自动按当月天数取整）逐月生成、`oneoff` / `monthly` 各计一次，再汇总成桑基图与指标。

---

## 四、前端实现要点

| 模块 | 实现 |
| --- | --- |
| 桑基图 | **自绘 SVG**（不依赖图表库）。JS 里计算列位置、按比例的高度与间隙；流条是**带圆角的填充贝塞尔带**，节点是圆角矩形；悬停高亮 + 浮动 tooltip。数据变化时淡入，窗口缩放时按动画帧重绘且**不播入场动画**。 |
| MD3 设计 | 用设计令牌实现：颜色角色（primary / surface 等）、形状阶梯（4/8/12/16/28px）、字号、层级阴影。 |
| 下拉选单 | 自实现 `MdSelect`：MD3 描边触发器 + 自定义动画菜单（原生 `<select>` 的弹层样式无法定制）。 |
| 日期选择 | 自实现 `MdDatePicker`（date / month 两种模式）：MD3 面板 + 月历网格 + 月导航 + 展开动画。 |
| 对话框 | 自实现 `mdAlert / mdConfirm / mdPrompt` 替换原生 `alert/confirm/prompt`：遮罩 + 圆角 surface + 缩放动画，删除类操作为红色 danger 按钮。 |
| 字体 | Roboto + Noto Sans SC。 |

---

## 五、窗口与桥接

**窗口**：`OverlappedPresenter.SetBorderAndTitleBar(true, false)` 去掉系统标题栏、保留可缩放边框。

**拖动**：网页顶栏 `mousedown` → 桥接 `WindowDragStart` → C# 起后台线程轮询光标（`GetCursorPos`）并用 `SetWindowPos` 移动窗口，松开左键自动结束。
> 为什么不用 `app-region: drag`：它的事件挂在 `CoreWebView2CompositionController` 上，WinUI 3 的 XAML WebView2 控件没有接管，实测无效。

**桥接方法**（`NativeBridge.Invoke` 分发）：

```
ListLedgers / GetLedger / CreateLedger / RenameLedger / DeleteLedger / SaveLedger
ExportCsv / ExportSqlite / DbPath / Log
WindowDragStart / WindowMinimize / WindowMaximizeToggle / WindowClose
```

---

## 六、目录结构

```
sankey-money/
├─ index.html / styles.css / app.js   # 前端源码（网页版与桌面版共用）
├─ desktop/                           # WinUI 3 桌面应用
│  ├─ SankeyMoney.csproj
│  ├─ App.xaml(.cs)                   # 应用入口（强制深色主题）
│  ├─ MainWindow.xaml(.cs)            # 无边框窗口 + WebView2 + 消息桥接
│  ├─ Models.cs                       # DTO
│  ├─ Services/SqliteStore.cs         # SQLite 建表/种子/CRUD/CSV/导出
│  ├─ Bridge/NativeBridge.cs          # 桥接方法 + 窗口控制 + 拖动
│  ├─ Assets/app.ico                  # 应用图标
│  └─ wwwroot/                        # 前端资源的副本（构建时打包）
├─ dist-md3/                          # 便携版发布产物（SankeyMoney.exe + data/）
└─ README.md
```

> 注意：桌面版加载的是 `desktop/wwwroot/` 里的副本。改完根目录的前端文件后需要同步：
> ```bash
> cp index.html styles.css app.js desktop/wwwroot/
> ```
> 并把 `index.html` 里的 `?v=` 版本号 +1，避免 WebView2 缓存旧文件。

---

## 七、构建与运行

前置：.NET 8 SDK（可用用户级安装，无需管理员）：

```bash
curl -sSL -o dotnet-install.ps1 https://dot.net/v1/dotnet-install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File dotnet-install.ps1 -Channel 8.0 -InstallDir "$env:USERPROFILE\.dotnet"
```

发布便携版：

```bash
cd desktop
"$USERPROFILE/.dotnet/dotnet" publish -c Release -r win-x64 --self-contained true -o ../dist-md3
```

- 自包含（.NET 运行时 + Windows App SDK 都打进目录），成品约 200MB，换台没装 .NET 的 Win11 也能直接跑（WebView2 运行时是系统自带的）。
- 应用日志：exe 同目录的 `app.log`。

浏览器版（可选，数据回退 localStorage）：

```bash
python -m http.server 8123     # 打开 http://127.0.0.1:8123
```

---

## 八、Git 分支

| 分支 | 说明 |
| --- | --- |
| **md3**（当前） | Material Design 3 深色主题（本 README 描述的就是它） |
| **winui** | 早期的 WinUI 3 + Fluent/Mica 版本 |
| **webui** | 纯网页版（无桌面外壳） |

仓库为本地仓库，未配置远端。

---

## 九、已知说明

- **窗口拖动**用轮询方案实现；如果某些环境下不跟手，可以改回系统原生标题栏（去掉 `SetBorderAndTitleBar` 即可）。
- 应用图标：桑基图字形（浅色）置于 MD3 紫色圆角渐变底上，多尺寸 ICO。
- 首次构建需联网下载 .NET SDK 与 NuGet 包。
