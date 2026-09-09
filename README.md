# 收支 / 分期 桑基图看板（Windows 11 桌面应用）

> **当前分支 `md3`**：网页内容使用 **Material Design 3** 深色主题重设计。
> 其他分支：`winui`（WinUI 3 + Fluent/Mica 原版）、`webui`（纯网页版）。

一个 Windows 11 原生风格的桌面程序：录入每月的收入、支出、借贷（分期/贷款）项目，自动生成**单月桑基图**与**整体（自选区间）桑基图**，并用**日历**展示所有固定日期项目。数据用 **SQLite** 管理，支持**多账单**切换与 **CSV / .sqlite** 导出。

- **外壳**：WinUI 3（Windows App SDK）—— Mica 云母材质、原生标题栏与圆角、Fluent 观感。
- **内容**：WebView2 承载桑基图 / 日历界面；桑基图为自绘 SVG（节点与流条两端均为圆角）。
- **数据**：C# + `Microsoft.Data.Sqlite`，真实 SQLite 文件。
- **打包**：自包含便携版，无需安装 .NET 或任何运行时（WebView2 Runtime 已随 Windows 11 内置）。

## 运行（便携版）

直接双击：

```
dist\SankeyMoney.exe
```

- 数据保存在 **exe 同目录** 的 `data\finance.db`（便携，整个 `dist` 文件夹可整体拷走）。
- 若该目录不可写，会自动回退到 `%LOCALAPPDATA%\SankeyMoney\finance.db`。

## 功能

- **多账单**：顶部下拉切换，可新建 / 重命名 / 删除；首次运行自动创建「示例数据」和「我的账单」。
- **项目**：名称、类型（收入 / 支出 / 借贷分期）、分类、金额、启用开关、备注。
- **排期**：重复（自定开始 / 结束日期，结束留空 = 永不结束，每月几号）、一次性（确定日期）、按月手动。
- **日历**：所有带确定日期的项目按天显示；点某天可查看 / 编辑 / 当天新增一次性项目。
- **桑基图**：单月 / 整体两种口径；结构为 `收入来源 → 总收入来源 → 总计划支出 → 各支出分类 + 结余/自由支配`；悬停高亮并显示占比。
- **精确日期区间**：整体视图按**起止日期**（非月份）统计，可用 MD3 日期选择器精确到某一天。
- **表格视图**：第三个标签页，直接编辑该账单的 SQLite 数据行（全部字段可改，可增删行），改动即时写库。
- **期间总额**：定期项目显示「月额 × 期数」的期间总消费；编辑弹窗实时预览。
- **导出**：
  - **CSV**：写到桌面，Excel / 表格工具可直接打开。
  - **.sqlite**：只含当前账单的真实 SQLite 文件，DB Browser / Python pandas 等工具可直接分析。

## 从源码构建

前置：.NET 8 SDK（可用用户级安装，无需管理员）：

```bash
# 安装用户级 .NET 8 SDK
curl -sSL -o dotnet-install.ps1 https://dot.net/v1/dotnet-install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File dotnet-install.ps1 -Channel 8.0 -InstallDir "$env:USERPROFILE\.dotnet"
```

构建 / 发布：

```bash
cd desktop
"$USERPROFILE/.dotnet/dotnet" build -c Release
"$USERPROFILE/.dotnet/dotnet" publish -c Release -r win-x64 --self-contained true -o ../dist
```

> 修改前端资源（`index.html` / `app.js` / `styles.css`）后，需同步到 `desktop\wwwroot\` 再重新构建：
> ```bash
> cp index.html styles.css app.js desktop/wwwroot/
> ```
> 修改后请把 `index.html` 里的 `?v=` 版本号 +1，避免 WebView2 缓存旧文件。

## 项目结构

```
sankey-money/
  desktop/                     # WinUI 3 桌面应用
    SankeyMoney.csproj
    App.xaml(.cs)
    MainWindow.xaml(.cs)       # 窗口 + Mica + WebView2 + postMessage 桥接
    Models.cs                  # 数据 DTO
    Services/SqliteStore.cs    # SQLite 建表 / 种子 / CRUD / CSV / 导出
    Bridge/NativeBridge.cs     # 前端调用的方法分发
    wwwroot/                   # 前端资源（桑基图 / 日历）
  dist/                        # 便携版发布产物（SankeyMoney.exe + data/）
  index.html / app.js / styles.css   # 前端源码
  README.md
```

## 浏览器版（可选）

前端资源同时兼容浏览器（数据回退到 localStorage，无多账单 SQLite）：

```bash
python -m http.server 8123
# 打开 http://127.0.0.1:8123
```

## 说明

- 桌面版不再需要 Python 服务器或浏览器；数据落在本机 SQLite 文件。
- 首次构建需联网下载 .NET SDK 与 NuGet 包（Windows App SDK、WebView2、Sqlite 等）。
- 应用日志：exe 同目录的 `app.log`（便于排查启动问题）。
