# 收支 / 分期 桑基图看板（移动端 · `mobile` 分支）

在纯静态网页版基础上做了**移动端竖屏适配**：把菜单、账单选择、各项操作全部收进**侧滑抽屉**，内容改为单列布局。纯静态（localStorage），已连接到 **Cloudflare Pages**。

- 线上地址：**https://sankey-money-mobile.pages.dev**
- Cloudflare Pages 项目：`sankey-money-mobile`，生产分支 `mobile`

## 移动端适配（≤820px）

- **顶栏**：`☰` 菜单按钮 + 标题 + `＋` 新增项目按钮
- **侧滑抽屉**（从左侧滑出，带遮罩，点遮罩/按 Esc/点任一操作后自动收起）：
  - 账单选择与 新建 / 重命名 / 删除
  - 载入示例 / 导出 CSV / 导出 .sqlite
  - 项目列表（含每项的编辑 / 删除）
- **单列布局**：指标卡两列、日历与表格自适应、弹窗近全宽
- 桌面（≥820px）自动恢复为「左侧栏 + 顶栏」布局，同一份代码

## 本地运行

```bash
python -m http.server 8123
# 浏览器打开 http://127.0.0.1:8123（可用 DevTools 切到手机视图）
```

## 分支

| 分支 | 说明 |
| --- | --- |
| **mobile**（当前） | 移动端适配版（静态，Cloudflare Pages） |
| webui | 桌面网页版（静态，Cloudflare Pages: sankey-money.pages.dev） |
| web | 网页版 + 本地 Python 后端（SQLite） |
| md3 | Windows 桌面版（WinUI 3 + SQLite） |

## 功能

- 多账单切换 / 新建 / 重命名 / 删除
- 桑基图：按起止日期区间统计，`收入来源 → 总收入来源 → 总计划支出 → 各支出分类 + 结余/自由支配`
- 日历视图、表格视图（直接编辑数据行）
- Material Design 3 深色主题；自实现的 MD3 下拉选单 / 日期选择器 / 对话弹窗
