# 收支 / 分期 桑基图看板（纯静态网页版 · `webui` 分支）

纯静态网页：数据存在浏览器 **localStorage**，无需后端。此分支已连接到 **Cloudflare Pages** 自动部署。

- 线上地址：**https://sankey-money.pages.dev**
- Cloudflare Pages 项目：`sankey-money`，生产分支 `webui`
- 无构建步骤：构建命令留空，输出目录为仓库根目录

## 本地运行

```bash
python -m http.server 8123
# 浏览器打开 http://127.0.0.1:8123
```

## 说明

- 本分支是**纯静态**版本（localStorage），适合直接托管到 Pages / 任意静态托管。
- 带本地 Python 后端（SQLite）的网页版在 **`web`** 分支。
- Windows 桌面版（WinUI 3 + SQLite）在 **`md3`** 分支。

## 功能

- 多账单切换 / 新建 / 重命名 / 删除
- 桑基图：按起止日期区间统计，`收入来源 → 总收入来源 → 总计划支出 → 各支出分类 + 结余/自由支配`
- 日历视图、表格视图（直接编辑数据行）
- Material Design 3 深色主题；自实现的 MD3 下拉选单 / 日期选择器 / 对话弹窗
