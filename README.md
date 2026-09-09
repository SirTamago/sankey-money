# 收支 / 分期 桑基图看板（网页版 · webui 分支）

纯静态网页：录入每月的收入、支出、借贷（分期 / 贷款）项目，自动生成**单月桑基图**与**整体（自选区间）桑基图**，并用**日历**展示所有固定日期项目。

- 数据存在浏览器 **localStorage**，支持多账单切换。
- 桑基图为自绘 SVG（节点与流条两端圆角）。
- 导出 CSV。

## 运行

```bash
python -m http.server 8123
# 浏览器打开 http://127.0.0.1:8123
```

## 分支说明

- **webui**（当前分支）：纯网页版，浏览器 localStorage。
- **winui**：Windows 11 桌面版（WinUI 3 + WebView2 + SQLite，便携 exe）。
- **md3**：基于 Material Design 3 的网页重设计。

## 文件

```
index.html / app.js / styles.css   # 前端源码
README.md
```
