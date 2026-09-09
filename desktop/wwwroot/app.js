"use strict";

/* ================= 基础工具 ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

const pad = (n) => String(n).padStart(2, "0");
const ymdFrom = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y, m) => new Date(y, m, 0).getDate();
const clampDay = (y, m, day) => Math.min(Math.max(1, Number(day) || 1), daysIn(y, m));
const ymOf = (d) => d.slice(0, 7);
const todayYmd = () => { const d = new Date(); return ymdFrom(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
const currentMonth = () => ymOf(todayYmd());

function monthsBetween(start, end) {
  if (!start || !end) return [];
  let [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  const out = [];
  while (sy < ey || (sy === ey && sm <= em)) {
    out.push(`${sy}-${pad(sm)}`);
    sm++; if (sm > 12) { sm = 1; sy++; }
  }
  return out;
}

/* 把 "YYYY-MM" 或空值规范成 "YYYY-MM-DD" 的起止日期 */
function normalizePeriod(p) {
  const def = { start: "2026-01-01", end: "2026-12-31" };
  if (!p) return { start: def.start, end: def.end };
  const norm = (v, isEnd) => {
    if (!v) return isEnd ? def.end : def.start;
    if (String(v).length === 7) {
      const [y, m] = v.split("-").map(Number);
      return isEnd ? ymdFrom(y, m, daysIn(y, m)) : ymdFrom(y, m, 1);
    }
    return v;
  };
  return { start: norm(p.start, false), end: norm(p.end, true) };
}

/* 颜色 */
const PALETTE = ["#D0BCFF", "#CCC2DC", "#EFB8C8", "#8FD9A8", "#FFB77C", "#9FC9FF", "#F6BD16", "#B0A7C9", "#80CBC4", "#F2B8B5"];
const colorMap = new Map();
let colorIdx = 0;
function colorFor(key) {
  if (!colorMap.has(key)) colorMap.set(key, PALETTE[colorIdx % PALETTE.length]);
  colorIdx++;
  return colorMap.get(key);
}

/* 金额显示 */
const fmtMoney = (n) => "¥" + Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const fmtShort = (n) => Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });

/* 分类 / 类型 */
const KIND_LABEL = { income: "收入", expense: "支出", loan: "借贷/分期" };
const CATEGORY_DEFAULTS = ["工资", "兼职", "补贴", "借入", "固定开销", "分期还款", "房贷/车贷", "日常消费", "数码产品"];
const TYPE_COLOR = { income: "#8FD9A8", expense: "#FFB77C", loan: "#F2B8B5" };
const FONT_STACK = '"Roboto","Noto Sans SC","Microsoft YaHei UI",system-ui,sans-serif';

/* ================= 存储层（桌面版走原生 SQLite，浏览器回退 localStorage） ================= */
const HAS_NATIVE = !!(window.chrome && window.chrome.webview && typeof window.chrome.webview.postMessage === "function");
window.__HAS_NATIVE = HAS_NATIVE;
if (HAS_NATIVE) document.documentElement.classList.add("native");

let _msgSeq = 0;
const _pending = new Map();
function nativeCall(method, ...args) {
  return new Promise((resolve, reject) => {
    const mid = ++_msgSeq;
    _pending.set(mid, { resolve, reject });
    try { window.chrome.webview.postMessage({ id: mid, method, args }); }
    catch (e) { _pending.delete(mid); reject(e); return; }
    setTimeout(() => {
      if (_pending.has(mid)) { _pending.delete(mid); reject(new Error("native call timeout: " + method)); }
    }, 15000);
  });
}
if (HAS_NATIVE) {
  window.__nativeCall = nativeCall;
  window.chrome.webview.addEventListener("message", (ev) => {
    let msg;
    try { msg = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data; } catch (e) { return; }
    const p = _pending.get(msg.id);
    if (!p) return;
    _pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || "native error"));
  });
}

const LS_KEY = "sankey-money-ledgers-v2";
const LS_ACTIVE = "sankey-money-active";

function id() { return "it_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7); }

function mkItem(name, kind, category, amount, schedule, note = "") {
  return { id: id(), name, kind, category, amount: Number(amount) || 0, enabled: true, note, schedule };
}

function demoItems() {
  return [
    mkItem("预计工资收入", "income", "工资", 15000, { type: "recurring", start: "2026-01-01", end: null, dayOfMonth: 10 }),
    mkItem("兼职/其他收入", "income", "兼职", 2500, { type: "recurring", start: "2026-01-01", end: null, dayOfMonth: 20 }),
    mkItem("数码产品分期", "loan", "分期还款", 2300, { type: "recurring", start: "2026-01-01", end: "2026-12-31", dayOfMonth: 5 }),
    mkItem("房贷/车贷/大件分期", "loan", "分期还款", 3500, { type: "recurring", start: "2026-01-01", end: null, dayOfMonth: 15 }),
    mkItem("基础开销(房租/水电气/网费)", "expense", "固定开销", 3000, { type: "recurring", start: "2026-01-01", end: null, dayOfMonth: 1 }),
    mkItem("计划日常消费(餐饮/购物)", "expense", "日常消费", 4000, { type: "recurring", start: "2026-01-01", end: null, dayOfMonth: 25 }),
  ];
}

function lsRead() { try { const r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
function lsWrite(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch (e) { console.warn(e); } }
function lsSeed() {
  return {
    activeId: 1,
    ledgers: [
      { id: 1, name: "示例数据", periodStart: "2026-01-01", periodEnd: "2026-12-31", items: demoItems() },
      { id: 2, name: "我的账单", periodStart: "2026-01-01", periodEnd: "2026-12-31", items: [] },
    ]
  };
}
function lsData() { let d = lsRead(); if (!d) { d = lsSeed(); lsWrite(d); } return d; }

const store = {
  async list() {
    if (HAS_NATIVE) return JSON.parse(await nativeCall("ListLedgers"));
    return lsData().ledgers.map(l => ({ id: l.id, name: l.name, periodStart: l.periodStart, periodEnd: l.periodEnd, itemCount: (l.items || []).length }));
  },
  async get(idVal) {
    if (HAS_NATIVE) return JSON.parse(await nativeCall("GetLedger", idVal));
    const d = lsData();
    const l = d.ledgers.find(x => String(x.id) === String(idVal));
    if (!l) throw new Error("账单不存在");
    return { id: l.id, name: l.name, periodStart: l.periodStart, periodEnd: l.periodEnd, items: l.items || [] };
  },
  async create(name) {
    if (HAS_NATIVE) return JSON.parse(await nativeCall("CreateLedger", name));
    const d = lsData();
    const nid = Math.max(0, ...d.ledgers.map(l => l.id)) + 1;
    const l = { id: nid, name, periodStart: "2026-01-01", periodEnd: "2026-12-31", items: [] };
    d.ledgers.push(l); d.activeId = nid; lsWrite(d);
    return { id: nid, name, periodStart: l.periodStart, periodEnd: l.periodEnd };
  },
  async rename(idVal, name) {
    if (HAS_NATIVE) { await nativeCall("RenameLedger", idVal, name); return; }
    const d = lsData();
    const l = d.ledgers.find(x => String(x.id) === String(idVal));
    if (l) { l.name = name; lsWrite(d); }
  },
  async remove(idVal) {
    if (HAS_NATIVE) { await nativeCall("DeleteLedger", idVal); return; }
    const d = lsData();
    d.ledgers = d.ledgers.filter(x => String(x.id) !== String(idVal)); lsWrite(d);
  },
  async save(idVal, ps, pe, items) {
    if (HAS_NATIVE) { await nativeCall("SaveLedger", idVal, ps, pe, JSON.stringify(items)); return; }
    const d = lsData();
    const l = d.ledgers.find(x => String(x.id) === String(idVal));
    if (l) { l.periodStart = ps; l.periodEnd = pe; l.items = items; lsWrite(d); }
  },
  async exportCsv(idVal) {
    if (HAS_NATIVE) return await nativeCall("ExportCsv", idVal);
    const l = await store.get(idVal);
    downloadText(buildCsv(l), l.name + ".csv");
    return "saved:browser";
  },
  async exportSqlite(idVal) {
    if (HAS_NATIVE) return await nativeCall("ExportSqlite", idVal);
    return "unsupported";
  }
};

function buildCsv(ledger) {
  const rows = [["账单", "名称", "类型", "分类", "金额", "启用", "排期方式", "开始日期", "结束日期", "每月几号", "日期", "归属月份", "备注"]];
  (ledger.items || []).forEach(it => {
    const s = it.schedule || {};
    rows.push([ledger.name, it.name, it.kind, it.category || "", it.amount, it.enabled ? 1 : 0,
      s.type || "", s.start || "", s.end || "", s.dayOfMonth == null ? "" : s.dayOfMonth, s.date || "", s.month || "", it.note || ""]);
  });
  return rows.map(r => r.map(csvCell).join(",")).join("\r\n");
}
function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadText(text, filename) {
  const blob = new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}

/* ================= MD3 下拉选单 ================= */
class MdSelect {
  constructor(host, onChange) {
    this.host = host;
    this.onChange = onChange;
    this.options = [];
    this.value = null;
    this.host.classList.add("md-select");
    this.host.innerHTML =
      '<button type="button" class="md-select-trigger">' +
      '<span class="md-select-label"></span>' +
      '<span class="md-select-arrow"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">' +
      '<path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
      '</button>' +
      '<div class="md-menu" hidden></div>';
    this.trigger = this.host.querySelector(".md-select-trigger");
    this.labelEl = this.host.querySelector(".md-select-label");
    this.menu = this.host.querySelector(".md-menu");
    this.trigger.addEventListener("click", (e) => { e.stopPropagation(); this.toggle(); });
    this._onDocClick = () => this.close();
    this._onKey = (e) => { if (e.key === "Escape") this.close(); };
    this._onMove = () => this.close();
    document.addEventListener("click", this._onDocClick);
    document.addEventListener("keydown", this._onKey);
    window.addEventListener("resize", this._onMove);
    window.addEventListener("scroll", this._onMove, true);
  }
  setOptions(opts) {
    this.options = opts.slice();
    if (this.value == null && opts.length) this.value = opts[0].value;
    this.updateLabel();
  }
  setValue(v) { this.value = v; this.updateLabel(); }
  updateLabel() {
    const o = this.options.find(x => String(x.value) === String(this.value));
    this.labelEl.textContent = o ? o.label : "";
  }
  toggle() { this.menu.hidden ? this.open() : this.close(); }
  open() {
    this.renderMenu();
    const r = this.trigger.getBoundingClientRect();
    const menuH = Math.min(300, this.options.length * 44 + 16);
    const below = window.innerHeight - r.bottom - 8;
    const openUp = below < menuH && r.top > below;
    this.menu.style.left = r.left + "px";
    this.menu.style.minWidth = r.width + "px";
    if (openUp) { this.menu.style.top = "auto"; this.menu.style.bottom = (window.innerHeight - r.top + 4) + "px"; this.menu.style.transformOrigin = "bottom left"; }
    else { this.menu.style.bottom = "auto"; this.menu.style.top = (r.bottom + 4) + "px"; this.menu.style.transformOrigin = "top left"; }
    this.menu.hidden = false;
    this.trigger.classList.add("open");
    requestAnimationFrame(() => this.menu.classList.add("open"));
  }
  close() {
    if (this.menu.hidden) return;
    this.menu.classList.remove("open");
    this.trigger.classList.remove("open");
    clearTimeout(this._closeTimer);
    this._closeTimer = setTimeout(() => { if (!this.menu.classList.contains("open")) this.menu.hidden = true; }, 150);
  }
  renderMenu() {
    this.menu.innerHTML = this.options.map(o =>
      `<button type="button" class="md-menu-item ${String(o.value) === String(this.value) ? "selected" : ""}" data-value="${svgEsc(String(o.value))}">${svgEsc(o.label)}</button>`
    ).join("");
    this.menu.querySelectorAll(".md-menu-item").forEach(el => {
      el.addEventListener("click", (e) => { e.stopPropagation(); this.select(el.dataset.value); });
    });
  }
  select(v) {
    this.value = v;
    this.updateLabel();
    this.close();
    if (this.onChange) this.onChange(v);
  }
}

/* ================= MD3 日期 / 月份选择器 ================= */
class MdDatePicker {
  constructor(host, mode, onChange) {
    this.host = host;
    this.mode = mode === "month" ? "month" : "date";
    this.onChange = onChange;
    this.value = null;
    this.view = new Date();
    this.host.classList.add("md-datepicker");
    this.host.innerHTML =
      '<button type="button" class="md-select-trigger">' +
      '<span class="md-select-label"></span>' +
      '<span class="md-dp-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg></span>' +
      '</button>' +
      '<div class="md-dp-popup" hidden></div>';
    this.trigger = this.host.querySelector(".md-select-trigger");
    this.labelEl = this.host.querySelector(".md-select-label");
    this.popup = this.host.querySelector(".md-dp-popup");
    this.trigger.addEventListener("click", (e) => { e.stopPropagation(); this.toggle(); });
    this.popup.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => this.close());
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.close(); });
    window.addEventListener("resize", () => this.close());
    window.addEventListener("scroll", () => this.close(), true);
  }
  setValue(v) {
    this.value = v || null;
    if (this.value) this.view = new Date(this.mode === "month" ? this.value + "-01" : this.value);
    this.updateLabel();
  }
  updateLabel() { this.labelEl.textContent = this.value || ""; }
  toggle() { this.popup.hidden ? this.open() : this.close(); }
  open() {
    if (this.value) this.view = new Date(this.mode === "month" ? this.value + "-01" : this.value);
    this.render();
    const r = this.trigger.getBoundingClientRect();
    const popW = 300, popH = this.mode === "month" ? 300 : 340;
    const below = window.innerHeight - r.bottom - 8;
    const openUp = below < popH && r.top > below;
    this.popup.style.left = Math.max(8, Math.min(r.left, window.innerWidth - popW - 8)) + "px";
    this.popup.style.width = popW + "px";
    if (openUp) { this.popup.style.top = "auto"; this.popup.style.bottom = (window.innerHeight - r.top + 4) + "px"; this.popup.style.transformOrigin = "bottom center"; }
    else { this.popup.style.bottom = "auto"; this.popup.style.top = (r.bottom + 4) + "px"; this.popup.style.transformOrigin = "top center"; }
    this.popup.hidden = false;
    this.trigger.classList.add("open");
    requestAnimationFrame(() => this.popup.classList.add("open"));
  }
  close() {
    if (this.popup.hidden) return;
    this.popup.classList.remove("open");
    this.trigger.classList.remove("open");
    clearTimeout(this._t);
    this._t = setTimeout(() => { if (!this.popup.classList.contains("open")) this.popup.hidden = true; }, 150);
  }
  render() {
    const y = this.view.getFullYear(), m = this.view.getMonth();
    let html = '<div class="md-dp-head">' +
      '<button type="button" class="md-dp-nav" data-nav="-1">‹</button>' +
      '<span class="md-dp-title">' + y + ' 年 ' + (m + 1) + ' 月</span>' +
      '<button type="button" class="md-dp-nav" data-nav="1">›</button></div>';
    if (this.mode === "month") {
      html += '<div class="md-dp-months">' + Array.from({ length: 12 }, (_, i) => i + 1).map(mm =>
        `<button type="button" class="md-dp-month ${mm - 1 === m ? "sel" : ""}" data-month="${mm}">${mm} 月</button>`).join("") + '</div>';
    } else {
      html += '<div class="md-dp-week">' + ["一", "二", "三", "四", "五", "六", "日"].map(d => `<span>${d}</span>`).join("") + '</div>';
      const first = (new Date(y, m, 1).getDay() + 6) % 7;
      const dim = daysIn(y, m + 1);
      const today = todayYmd();
      let cells = "";
      for (let i = 0; i < first; i++) cells += '<span class="md-dp-day empty"></span>';
      for (let d = 1; d <= dim; d++) {
        const date = ymdFrom(y, m + 1, d);
        cells += `<button type="button" class="md-dp-day ${date === this.value ? "sel" : ""} ${date === today ? "today" : ""}" data-date="${date}">${d}</button>`;
      }
      html += '<div class="md-dp-days">' + cells + '</div>';
    }
    this.popup.innerHTML = html;
    this.popup.querySelectorAll("[data-nav]").forEach(b => b.addEventListener("click", () => {
      this.view = new Date(y, m + Number(b.dataset.nav), 1);
      this.render();
    }));
    this.popup.querySelectorAll("[data-date]").forEach(b => b.addEventListener("click", () => this.select(b.dataset.date)));
    this.popup.querySelectorAll("[data-month]").forEach(b => b.addEventListener("click", () => this.select(ymdFrom(y, Number(b.dataset.month), 1).slice(0, 7))));
  }
  select(v) {
    this.value = v;
    this.updateLabel();
    this.close();
    if (this.onChange) this.onChange(v);
  }
}

/* ================= MD3 对话框（替换原生 alert/confirm/prompt） ================= */
function mdDialog(opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const host = $("#mdDialogHost");
    const msgHtml = escapeHtml(opts.message || "").replace(/\n/g, "<br>");
    host.innerHTML =
      '<div class="md-scrim"></div>' +
      '<div class="md-dialog">' +
      (opts.title ? `<h2 class="md-dialog-title">${escapeHtml(opts.title)}</h2>` : "") +
      `<div class="md-dialog-body">${msgHtml}</div>` +
      (opts.input ? `<input class="md-dialog-input" value="${escapeHtml(opts.defaultValue || "")}">` : "") +
      '<div class="md-dialog-actions">' +
      (opts.input || opts.cancelText ? `<button type="button" class="btn md-dialog-cancel">${escapeHtml(opts.cancelText || "取消")}</button>` : "") +
      `<button type="button" class="btn btn-primary md-dialog-ok ${opts.danger ? "danger" : ""}">${escapeHtml(opts.confirmText || "确定")}</button>` +
      "</div></div>";
    host.hidden = false;
    requestAnimationFrame(() => host.classList.add("open"));
    let done = false;
    const cancelVal = opts.input ? null : false;
    const close = (val) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      host.classList.remove("open");
      setTimeout(() => { host.hidden = true; host.innerHTML = ""; }, 160);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(cancelVal);
      else if (e.key === "Enter" && opts.input) {
        const inp = host.querySelector(".md-dialog-input");
        close(inp ? inp.value : "");
      }
    };
    document.addEventListener("keydown", onKey);
    host.querySelector(".md-dialog-ok").addEventListener("click", () => {
      if (opts.input) { const inp = host.querySelector(".md-dialog-input"); close(inp ? inp.value : ""); }
      else close(true);
    });
    const cancelBtn = host.querySelector(".md-dialog-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", () => close(cancelVal));
    host.querySelector(".md-scrim").addEventListener("click", () => close(cancelVal));
    const inp = host.querySelector(".md-dialog-input");
    if (inp) { inp.focus(); inp.select(); }
  });
}
function mdAlert(message, title) { return mdDialog({ title: title || "提示", message, confirmText: "知道了" }); }
function mdConfirm(message, opts) {
  opts = opts || {};
  return mdDialog({ title: opts.title || "确认", message, confirmText: opts.confirmText || "确定", cancelText: "取消", danger: opts.danger });
}
function mdPrompt(message, defaultValue, title) {
  return mdDialog({ title: title || "输入", message, input: true, defaultValue, confirmText: "确定", cancelText: "取消" });
}

/* ================= 应用状态 ================= */
let ledgers = [];
let activeLedgerId = null;
let state = { ledgerId: null, period: { start: "2026-01-01", end: "2026-12-31" }, items: [] };
let editingId = null;
let selectedDate = todayYmd();
let fadeTimer = null;
let resizeRaf = null;
let ledgerSel = null, kindSel = null, schedSel = null;
let calMonthPick = null, periodStartPick = null, periodEndPick = null;
let fStartPick = null, fEndPick = null, fDatePick = null, fMonthPick = null;

/* ================= 排期展开引擎 ================= */
/* 统计项目在 [startDate, endDate] 区间内的发生次数 */
function occurrencesInRange(item, startDate, endDate) {
  const s = item.schedule;
  if (s.type === "oneoff") return (s.date >= startDate && s.date <= endDate) ? 1 : 0;
  if (s.type === "monthly") return (s.month >= ymOf(startDate) && s.month <= ymOf(endDate)) ? 1 : 0;
  let count = 0;
  const months = monthsBetween(ymOf(startDate), ymOf(endDate));
  for (const month of months) {
    const [y, m] = month.split("-").map(Number);
    const occ = ymdFrom(y, m, clampDay(y, m, s.dayOfMonth));
    if (occ < s.start) continue;
    if (s.end && occ > s.end) continue;
    if (occ < startDate || occ > endDate) continue;
    count++;
  }
  return count;
}

function itemsOnDate(dateStr) {
  const out = [];
  for (const it of state.items) {
    if (!it.enabled) continue;
    const s = it.schedule;
    if (s.type === "oneoff") { if (s.date === dateStr) out.push(it); }
    else if (s.type === "recurring") {
      const y = Number(dateStr.slice(0, 4)), m = Number(dateStr.slice(5, 7));
      const occ = ymdFrom(y, m, clampDay(y, m, s.dayOfMonth));
      if (occ === dateStr && occ >= s.start && (!s.end || occ <= s.end)) out.push(it);
    }
  }
  return out;
}

/* ================= 桑基图构建 ================= */
function pruneZero(nodes, links) {
  const keep = new Set();
  nodes.forEach(n => { if (n.value > 0) keep.add(n.name); });
  const keptLinks = links.filter(l => keep.has(l.source) && keep.has(l.target) && l.value > 0);
  const connected = new Set();
  keptLinks.forEach(l => { connected.add(l.source); connected.add(l.target); });
  return { nodes: nodes.filter(n => keep.has(n.name) && connected.has(n.name)), links: keptLinks };
}

function buildSankeyRange(startDate, endDate) {
  const income = {}, expense = {}, inCnt = {}, exCnt = {};
  let totalIncome = 0, totalExpense = 0;
  for (const it of state.items) {
    if (!it.enabled) continue;
    const cnt = occurrencesInRange(it, startDate, endDate);
    if (cnt === 0) continue;
    const amt = cnt * it.amount;
    const label = it.category || it.name;
    if (it.kind === "income") {
      income[label] = (income[label] || 0) + amt;
      inCnt[label] = (inCnt[label] || 0) + cnt;
      totalIncome += amt;
    } else {
      expense[label] = (expense[label] || 0) + amt;
      exCnt[label] = (exCnt[label] || 0) + cnt;
      totalExpense += amt;
    }
  }
  const surplus = totalIncome - totalExpense;
  const nodes = [], links = [];
  const inLabels = Object.keys(income);
  const exLabels = Object.keys(expense);

  if (inLabels.length === 0 && exLabels.length === 0) {
    return { empty: true, nodes, links, totalIncome, totalExpense, surplus, savingsRate: 0 };
  }

  inLabels.forEach(l => nodes.push({
    name: "IN_" + l, value: income[l], depth: 0,
    itemStyle: { color: colorFor("in:" + l), opacity: 0.92 }, usrLabel: l, usrCount: inCnt[l],
    label: { position: "left" }
  }));
  nodes.push({ name: "总收入来源", value: totalIncome, depth: 1, itemStyle: { color: "#D0BCFF", opacity: 0.92 }, usrLabel: "总收入来源", label: { position: "top" } });
  inLabels.forEach(l => links.push({ source: "IN_" + l, target: "总收入来源", value: income[l] }));

  nodes.push({ name: "总计划支出", value: totalExpense, depth: 2, itemStyle: { color: "#EFB8C8", opacity: 0.92 }, usrLabel: "总计划支出", label: { position: "top" } });
  links.push({ source: "总收入来源", target: "总计划支出", value: totalExpense });

  exLabels.forEach(l => nodes.push({
    name: "EX_" + l, value: expense[l], depth: 3,
    itemStyle: { color: colorFor("ex:" + l), opacity: 0.92 }, usrLabel: l, usrCount: exCnt[l],
    label: { position: "right" }
  }));
  exLabels.forEach(l => links.push({ source: "总计划支出", target: "EX_" + l, value: expense[l] }));

  if (surplus >= 0) {
    nodes.push({ name: "结余/自由支配", value: surplus, depth: 2, itemStyle: { color: "#8FD9A8", opacity: 0.92 }, usrLabel: "结余 / 自由支配", label: { position: "bottom" } });
    links.push({ source: "总收入来源", target: "结余/自由支配", value: surplus });
  } else {
    nodes.push({ name: "超支", value: -surplus, depth: 2, itemStyle: { color: "#F2B8B5", opacity: 0.92 }, usrLabel: "超支", label: { position: "bottom" } });
    links.push({ source: "总收入来源", target: "超支", value: -surplus });
  }

  const cleaned = pruneZero(nodes, links);
  return {
    empty: false,
    nodes: cleaned.nodes, links: cleaned.links, totalIncome, totalExpense, surplus,
    savingsRate: totalIncome > 0 ? surplus / totalIncome : 0
  };
}

/* ================= 渲染：桑基图（自绘 SVG：流条两端圆角） ================= */
const SK_NODE_W = 20;
const SK_NODE_GAP = 20;
let lastSankeyData = null;

function pctOf(v, total) { return total > 0 ? (v / total * 100).toFixed(1) + "%" : "0%"; }
function svgEsc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function renderSankeySvg(data, opts) {
  opts = opts || {};
  lastSankeyData = data;
  const container = $("#sankeyChart");
  if (!container) return;
  if (!data || data.empty) { container.innerHTML = ""; return; }

  const W = Math.max(320, container.clientWidth || 900);
  const H = Math.max(240, container.clientHeight || 520);

  const nodes = data.nodes.map(n => Object.assign({}, n));
  const byName = new Map(nodes.map(n => [n.name, n]));
  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth || 0), 0);
  const groups = [];
  for (let d = 0; d <= maxDepth; d++) groups.push(nodes.filter(n => (n.depth || 0) === d));

  // 边距随宽度自适应，窄窗口时给列留出足够间距
  const padL = Math.max(72, Math.min(150, W * 0.15));
  const padR = Math.max(96, Math.min(200, W * 0.2));
  const padT = 68, padB = 68;
  const availH = H - padT - padB;
  let scale = Infinity;
  for (const g of groups) {
    const sumV = g.reduce((a, n) => a + n.value, 0);
    if (sumV <= 0) continue;
    const gaps = SK_NODE_GAP * Math.max(0, g.length - 1);
    scale = Math.min(scale, (availH - gaps) / sumV);
  }
  if (!isFinite(scale) || scale <= 0) { container.innerHTML = ""; return; }

  const colCount = groups.length;
  const availW = Math.max(120, W - padL - padR);
  const colX = d => padL + (colCount <= 1 ? 0 : availW * d / (colCount - 1));

  for (let d = 0; d < colCount; d++) {
    const g = groups[d];
    const totalH = g.reduce((a, n) => a + n.value * scale, 0) + SK_NODE_GAP * Math.max(0, g.length - 1);
    let y = padT + Math.max(0, (availH - totalH) / 2);
    for (const n of g) {
      n.x = colX(d);
      n.y = y;
      n.w = SK_NODE_W;
      n.h = Math.max(2, n.value * scale);
      n.color = (n.itemStyle && n.itemStyle.color) || "#5b8ff9";
      n.text = n.usrLabel || displayName(n.name);
      n.pos = (n.label && n.label.position) || "right";
      y += n.h + SK_NODE_GAP;
    }
  }

  const links = data.links
    .map(l => ({ source: l.source, target: l.target, value: l.value, s: byName.get(l.source), t: byName.get(l.target) }))
    .filter(l => l.s && l.t && l.value > 0);

  const outBy = new Map(), inBy = new Map();
  links.forEach(l => {
    if (!outBy.has(l.source)) outBy.set(l.source, []);
    outBy.get(l.source).push(l);
    if (!inBy.has(l.target)) inBy.set(l.target, []);
    inBy.get(l.target).push(l);
  });
  outBy.forEach(arr => arr.sort((a, b) => (a.t.y + a.t.h / 2) - (b.t.y + b.t.h / 2)));
  inBy.forEach(arr => arr.sort((a, b) => (a.s.y + a.s.h / 2) - (b.s.y + b.s.h / 2)));
  outBy.forEach(arr => { let o = 0; arr.forEach(l => { l.sy = l.s.y + o + (l.value * scale) / 2; o += l.value * scale; }); });
  inBy.forEach(arr => { let o = 0; arr.forEach(l => { l.ty = l.t.y + o + (l.value * scale) / 2; o += l.value * scale; }); });

  let svg = `<svg class="sankey-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

  svg += `<defs>`;
  links.forEach((l, i) => {
    svg += `<linearGradient id="skg${i}" x1="0" y1="0" x2="1" y2="0">`
      + `<stop offset="0" stop-color="${l.s.color}"/><stop offset="1" stop-color="${l.t.color}"/></linearGradient>`;
  });
  svg += `</defs>`;

  svg += `<g class="sk-links">`;
  links.forEach((l, i) => {
    const w = Math.max(1.5, l.value * scale);
    const x0 = l.s.x + l.s.w, x1 = l.t.x;
    const sy0 = l.sy - w / 2, sy1 = l.sy + w / 2;
    const ty0 = l.ty - w / 2, ty1 = l.ty + w / 2;
    const cx = (x1 - x0) * 0.5;
    const r = Math.min(w / 2, 10);
    const d =
      `M ${x0.toFixed(1)} ${(sy0 + r).toFixed(1)}` +
      ` Q ${x0.toFixed(1)} ${sy0.toFixed(1)} ${(x0 + r).toFixed(1)} ${sy0.toFixed(1)}` +
      ` C ${(x0 + cx).toFixed(1)} ${sy0.toFixed(1)}, ${(x1 - cx).toFixed(1)} ${ty0.toFixed(1)}, ${(x1 - r).toFixed(1)} ${ty0.toFixed(1)}` +
      ` Q ${x1.toFixed(1)} ${ty0.toFixed(1)} ${x1.toFixed(1)} ${(ty0 + r).toFixed(1)}` +
      ` L ${x1.toFixed(1)} ${(ty1 - r).toFixed(1)}` +
      ` Q ${x1.toFixed(1)} ${ty1.toFixed(1)} ${(x1 - r).toFixed(1)} ${ty1.toFixed(1)}` +
      ` C ${(x1 - cx).toFixed(1)} ${ty1.toFixed(1)}, ${(x0 + cx).toFixed(1)} ${sy1.toFixed(1)}, ${(x0 + r).toFixed(1)} ${sy1.toFixed(1)}` +
      ` Q ${x0.toFixed(1)} ${sy1.toFixed(1)} ${x0.toFixed(1)} ${(sy1 - r).toFixed(1)} Z`;
    svg += `<path class="sk-link" d="${d}" fill="url(#skg${i})" `
      + `data-src="${svgEsc(displayName(l.source))}" data-tgt="${svgEsc(displayName(l.target))}" `
      + `data-x0="${x0.toFixed(1)}" data-x1="${x1.toFixed(1)}" data-sy="${l.sy.toFixed(1)}" data-ty="${l.ty.toFixed(1)}" data-val="${l.value}" data-pct="${pctOf(l.value, data.totalIncome)}"/>`;
  });
  svg += `</g>`;

  svg += `<g class="sk-nodes">`;
  nodes.forEach(n => {
    svg += `<rect class="sk-node" x="${n.x.toFixed(1)}" y="${n.y.toFixed(1)}" width="${n.w}" height="${n.h.toFixed(1)}" rx="6" ry="6" fill="${n.color}" `
      + `data-name="${svgEsc(n.text)}" data-val="${n.value}" data-cnt="${n.usrCount == null ? "" : n.usrCount}" data-pct="${pctOf(n.value, data.totalIncome)}"/>`;
  });
  svg += `</g>`;

  svg += `<g class="sk-labels">`;
  nodes.forEach(n => {
    const cy = n.y + n.h / 2;
    let tx, ty, anchor;
    if (n.pos === "left") { tx = n.x - 12; ty = cy + 4; anchor = "end"; }
    else if (n.pos === "right") { tx = n.x + n.w + 12; ty = cy + 4; anchor = "start"; }
    else if (n.pos === "top") { tx = n.x + n.w / 2; ty = n.y - 10; anchor = "middle"; }
    else { tx = n.x + n.w / 2; ty = n.y + n.h + 20; anchor = "middle"; }
    svg += `<text class="sk-label" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}" fill="#e6edf5" font-size="13" font-family="${FONT_STACK.replace(/"/g, "'")}">${svgEsc(n.text)}</text>`;
  });
  svg += `</g></svg>`;

  container.innerHTML = svg;
  const svgEl = container.querySelector("svg");
  if (opts.fade !== false) {
    svgEl.classList.add("fade-in");
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => svgEl.classList.remove("fade-in"), 420);
  }
  bindSankeyHover(svgEl, container);
}

function bindSankeyHover(svgEl, container) {
  const tip = $("#sankeyTip");
  const wrap = container.parentElement;
  const clear = () => {
    svgEl.classList.remove("has-hover");
    svgEl.querySelectorAll(".hi").forEach(e => e.classList.remove("hi"));
    if (tip) tip.hidden = true;
  };
  const showTip = (html, ev) => {
    if (!tip) return;
    tip.innerHTML = html;
    tip.hidden = false;
    const r = wrap.getBoundingClientRect();
    let x = ev.clientX - r.left + 14;
    let y = ev.clientY - r.top + 14;
    if (x + tip.offsetWidth > r.width) x = r.width - tip.offsetWidth - 8;
    if (y + tip.offsetHeight > r.height) y = ev.clientY - r.top - tip.offsetHeight - 10;
    tip.style.left = Math.max(4, x) + "px";
    tip.style.top = Math.max(4, y) + "px";
  };
  svgEl.querySelectorAll(".sk-node").forEach(el => {
    el.addEventListener("mouseenter", () => {
      svgEl.classList.add("has-hover");
      el.classList.add("hi");
      const name = el.getAttribute("data-name");
      svgEl.querySelectorAll(".sk-link").forEach(lk => {
        if (lk.getAttribute("data-src") === name || lk.getAttribute("data-tgt") === name) lk.classList.add("hi");
      });
      const cnt = el.getAttribute("data-cnt");
      el._tip = `<b>${svgEsc(name)}</b><br/>${fmtMoney(+el.getAttribute("data-val"))} · 占收入 ${el.getAttribute("data-pct")}`
        + (cnt ? `<br/><span style="color:#8aa0bd">共 ${cnt} 次</span>` : "");
    });
    el.addEventListener("mousemove", ev => showTip(el._tip || "", ev));
    el.addEventListener("mouseleave", clear);
  });
  svgEl.querySelectorAll(".sk-link").forEach(el => {
    el.addEventListener("mouseenter", () => {
      svgEl.classList.add("has-hover");
      el.classList.add("hi");
      el._tip = `<b>${el.getAttribute("data-src")} → ${el.getAttribute("data-tgt")}</b><br/>${fmtMoney(+el.getAttribute("data-val"))} · ${el.getAttribute("data-pct")} 占收入`;
    });
    el.addEventListener("mousemove", ev => showTip(el._tip || "", ev));
    el.addEventListener("mouseleave", clear);
  });
}

function currentRangeForSankey() {
  const s = state.period.start, e = state.period.end;
  return { label: `${s} ~ ${e}`, start: s, end: e };
}

function renderSankey() {
  const { label, start, end } = currentRangeForSankey();
  const data = buildSankeyRange(start, end);
  $("#sankeyTitle").textContent = label;
  renderMetrics(data);
  if (data.empty) {
    $("#sankeyChart").innerHTML = "";
    $("#sankeyEmpty").hidden = false;
  } else {
    $("#sankeyEmpty").hidden = true;
    renderSankeySvg(data, { fade: true });
  }
}

function renderMetrics(d) {
  const rate = (Math.abs(d.savingsRate) * 100).toFixed(1);
  const surplusHtml = `<div class="metric-value ${d.surplus >= 0 ? "green" : "red"}">${fmtMoney(d.surplus)}</div>`
    + (d.surplus >= 0 ? `<div class="metric-sub">每月结余 / 储蓄</div>` : `<div class="metric-sub">本月超支，注意控制</div>`);
  $("#metricRow").innerHTML = `
    <div class="metric-card"><div class="metric-label">总收入</div><div class="metric-value blue">${fmtMoney(d.totalIncome)}</div></div>
    <div class="metric-card"><div class="metric-label">总计划支出</div><div class="metric-value">${fmtMoney(d.totalExpense)}</div></div>
    <div class="metric-card"><div class="metric-label">${d.surplus >= 0 ? "结余 / 自由支配" : "超支"}</div>${surplusHtml}</div>
    <div class="metric-card"><div class="metric-label">储蓄率</div><div class="metric-value ${d.savingsRate >= 0 ? "green" : "red"}">${d.savingsRate >= 0 ? rate : "-" + rate}%</div><div class="metric-sub">结余 / 总收入</div></div>`;
}

/* ================= 渲染：日历 ================= */
function renderCalendar() { renderCalendarGrid(); renderDayDetail(); }

function renderCalendarGrid() {
  const month = (calMonthPick && calMonthPick.value) || currentMonth();
  let [y, m] = month.split("-").map(Number);
  if (!selectedDate || ymOf(selectedDate) !== month) selectedDate = ymdFrom(y, m, 1);
  const weekDays = ["一", "二", "三", "四", "五", "六", "日"];
  $("#calWeekHeader").innerHTML = weekDays.map(d => `<div class="cal-wd">${d}</div>`).join("");

  const firstWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const dim = daysIn(y, m);
  const today = todayYmd();
  let cells = "";
  for (let i = 0; i < firstWeekday; i++) cells += `<div class="cal-cell empty"></div>`;
  for (let d = 1; d <= dim; d++) {
    const date = ymdFrom(y, m, d);
    const items = itemsOnDate(date);
    const isToday = date === today;
    const isSel = date === selectedDate;
    const chips = items.slice(0, 3).map(it => {
      const t = it.kind === "income" ? "in:" : "ex:";
      const typeColor = TYPE_COLOR[it.kind] || "#8aa0bd";
      const catColor = colorFor(t + (it.category || it.name));
      return `<span class="chip"><span class="chip-type" style="background:${typeColor}"></span><span class="chip-cat" style="background:${catColor}"></span><span class="chip-txt">${escapeHtml(it.name)} ${fmtShort(it.amount)}</span></span>`;
    }).join("");
    const more = items.length > 3 ? `<span class="chip more">+${items.length - 3}</span>` : "";
    cells += `<div class="cal-cell ${isToday ? "today" : ""} ${isSel ? "selected" : ""}" data-date="${date}">
      <div class="cal-num">${d}</div>
      <div class="cal-chips">${chips}${more}</div></div>`;
  }
  const total = firstWeekday + dim;
  for (let i = Math.ceil(total / 7) * 7 - total; i > 0; i--) cells += `<div class="cal-cell empty"></div>`;
  $("#calGrid").innerHTML = cells;

  $$("#calGrid .cal-cell[data-date]").forEach(el => el.addEventListener("click", () => {
    selectedDate = el.dataset.date;
    renderCalendarGrid();
    renderDayDetail();
  }));
}

function displayName(name) {
  if (typeof name !== "string") return name;
  if (name.startsWith("IN_")) return name.slice(3);
  if (name.startsWith("EX_")) return name.slice(3);
  return name;
}

function scheduleSummary(it) {
  const s = it.schedule;
  if (s.type === "recurring") return `每月 ${s.dayOfMonth} 号 · ${s.start} 起${s.end ? ` · 至 ${s.end}` : "（不结束）"}`;
  if (s.type === "oneoff") return `一次性 · ${s.date}`;
  return `按月手动 · ${s.month}`;
}

function itemPeriodTotal(it) {
  const s = it.schedule;
  if (s.type === "oneoff") return { label: s.date, count: 1, total: it.amount };
  if (s.type === "monthly") return { label: `按月手动 ${s.month}`, count: 1, total: it.amount };
  const winEnd = s.end || state.period.end;
  const winLabel = s.end ? `${s.start} ~ ${s.end}` : `${s.start} ~ ${winEnd}（当前区间）`;
  const count = occurrencesInRange(it, s.start, winEnd);
  return { label: winLabel, count, total: count * it.amount };
}

function itemRowHtml(it, extraActions = "") {
  const kindClass = it.kind === "income" ? "kind-income" : it.kind === "loan" ? "kind-loan" : "kind-expense";
  const deltaClass = it.kind === "income" ? "in" : "out";
  const s = it.schedule;
  const lines = [`<span class="tag">${escapeHtml(it.category || "未分类")}</span>`];
  if (s.type === "recurring") {
    lines.push(`每月 ${s.dayOfMonth} 号`);
    lines.push(s.end ? `${s.start} ~ ${s.end}` : `${s.start} 起 · 不结束`);
    const per = itemPeriodTotal(it);
    if (per.count > 0 || per.total > 0) lines.push(`期间总额 <b>${fmtMoney(per.total)}</b> · ${per.count} 期`);
  } else if (s.type === "oneoff") {
    lines.push(`一次性 · ${s.date}`);
  } else {
    lines.push(`按月手动 · ${s.month}`);
  }
  const metaHtml = lines.map(l => `<div class="item-line">${l}</div>`).join("");
  return `<div class="item-row ${it.enabled ? "" : "disabled"}" data-id="${it.id}">
    <div class="item-row-head">
      <span class="kind-badge ${kindClass}">${KIND_LABEL[it.kind]}</span>
      <span class="item-name">${escapeHtml(it.name)}</span>
      <span class="delta ${deltaClass}">${it.kind === "income" ? "+" : "-"}${fmtMoney(it.amount)}</span>
    </div>
    <div class="item-meta">${metaHtml}</div>
    <div class="item-actions">
      <label class="switch"><input type="checkbox" ${it.enabled ? "checked" : ""} data-role="toggle"><span class="slider"></span></label>
      <button class="btn" data-role="edit">编辑</button>
      <button class="btn" data-role="delete">删除</button>
      ${extraActions}
    </div>
  </div>`;
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderItemList() {
  const list = $("#itemList");
  const items = state.items.slice().sort((a, b) => a.name.localeCompare(b.name, "zh"));
  $("#itemCount").textContent = items.length;
  $("#itemEmpty").hidden = items.length > 0;
  list.innerHTML = items.map(it => itemRowHtml(it)).join("");
  $$("#itemList .item-row").forEach(row => {
    const idv = row.dataset.id;
    const item = state.items.find(i => i.id === idv);
    if (!item) return;
    $("[data-role=toggle]", row).addEventListener("change", (e) => onToggle(item, row, e.target.checked, "list"));
    $("[data-role=edit]", row).addEventListener("click", () => openForm(item));
    $("[data-role=delete]", row).addEventListener("click", () => deleteItem(idv));
  });
}

function renderCatDatalist() {
  const cats = new Set(CATEGORY_DEFAULTS);
  state.items.forEach(i => i.category && cats.add(i.category));
  $("#catList").innerHTML = Array.from(cats).map(c => `<option value="${escapeHtml(c)}"></option>`).join("");
}

function renderDayDetail() {
  const items = itemsOnDate(selectedDate);
  let html = `<div class="day-title">${selectedDate} 的项目${items.length ? `（${items.length} 项）` : " · 暂无"}</div>`;
  if (items.length) html += items.map(it => itemRowHtml(it, `<button class="btn btn-ghost on" data-role="adddate">＋同一天</button>`)).join("");
  else html += `<div class="muted pad">当天没有项目。点击下方按钮新增一个一次性项目。</div>`;
  html += `<button class="btn btn-ghost on" id="dayAdd">＋ 在该日期添加一次性项目</button>`;
  $("#dayDetail").innerHTML = html;

  $$("#dayDetail .item-row").forEach(row => {
    const idv = row.dataset.id;
    const item = state.items.find(i => i.id === idv);
    if (!item) return;
    $("[data-role=toggle]", row).addEventListener("change", (e) => onToggle(item, row, e.target.checked, "day"));
    $("[data-role=edit]", row).addEventListener("click", () => openForm(item));
    $("[data-role=delete]", row).addEventListener("click", () => deleteItem(idv));
    const adddate = $("[data-role=adddate]", row);
    if (adddate) adddate.addEventListener("click", () => openForm(null, { type: "oneoff", date: selectedDate }));
  });
  $("#dayAdd").addEventListener("click", () => openForm(null, { type: "oneoff", date: selectedDate }));
}

function renderAll() { renderCatDatalist(); renderItemList(); renderCalendar(); renderSankey(); renderLedgerSelect(); renderTable(); }

/* ================= 表格视图（直接编辑 SQLite 行） ================= */
function renderTable() {
  const wrap = $("#tableWrap");
  if (!wrap) return;
  const kindOpts = ["income", "expense", "loan"];
  const schedOpts = [["recurring", "重复"], ["oneoff", "一次性"], ["monthly", "按月"]];
  let html = '<table class="md-table"><thead><tr>' +
    '<th>名称</th><th>类型</th><th>分类</th><th>金额</th><th>启用</th><th>排期</th>' +
    '<th>开始日期</th><th>结束日期</th><th>每月几号</th><th>日期</th><th>归属月份</th><th>备注</th><th></th>' +
    '</tr></thead><tbody>';
  state.items.forEach((it, idx) => {
    const s = it.schedule || {};
    html += `<tr data-idx="${idx}">` +
      `<td><input class="t-input" data-f="name" value="${escapeHtml(it.name)}"></td>` +
      `<td><select class="t-input" data-f="kind">${kindOpts.map(k => `<option value="${k}" ${it.kind === k ? "selected" : ""}>${KIND_LABEL[k]}</option>`).join("")}</select></td>` +
      `<td><input class="t-input" data-f="category" value="${escapeHtml(it.category || "")}"></td>` +
      `<td><input class="t-input" type="number" step="0.01" data-f="amount" value="${it.amount}"></td>` +
      `<td class="center"><input type="checkbox" data-f="enabled" ${it.enabled ? "checked" : ""}></td>` +
      `<td><select class="t-input" data-f="sched_type">${schedOpts.map(([v, l]) => `<option value="${v}" ${s.type === v ? "selected" : ""}>${l}</option>`).join("")}</select></td>` +
      `<td><input class="t-input" type="date" data-f="start" value="${s.start || ""}"></td>` +
      `<td><input class="t-input" type="date" data-f="end" value="${s.end || ""}"></td>` +
      `<td><input class="t-input" type="number" min="1" max="31" data-f="day" value="${s.dayOfMonth == null ? "" : s.dayOfMonth}"></td>` +
      `<td><input class="t-input" type="date" data-f="date" value="${s.date || ""}"></td>` +
      `<td><input class="t-input" type="month" data-f="month" value="${s.month || ""}"></td>` +
      `<td><input class="t-input" data-f="note" value="${escapeHtml(it.note || "")}"></td>` +
      `<td><button class="btn t-del" data-del="${idx}">删除</button></td>` +
      '</tr>';
  });
  html += '</tbody></table>';
  html += '<button class="btn btn-primary t-add" id="tableAdd">＋ 新增行</button>';
  wrap.innerHTML = html;

  wrap.querySelectorAll("tr[data-idx]").forEach(tr => {
    const idx = Number(tr.dataset.idx);
    tr.querySelectorAll("[data-f]").forEach(el => {
      el.addEventListener("change", () => applyTableCell(idx, el.dataset.f, el));
    });
  });
  wrap.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
    state.items.splice(Number(b.dataset.del), 1);
    afterMutate();
  }));
  $("#tableAdd").addEventListener("click", () => {
    state.items.push(mkItem("新项目", "expense", "其他支出", 0, { type: "recurring", start: todayYmd(), end: null, dayOfMonth: 1 }));
    afterMutate();
  });
}

function applyTableCell(idx, field, el) {
  const it = state.items[idx];
  if (!it) return;
  if (field === "name") it.name = el.value;
  else if (field === "kind") it.kind = el.value;
  else if (field === "category") it.category = el.value;
  else if (field === "amount") it.amount = Number(el.value) || 0;
  else if (field === "enabled") it.enabled = el.checked;
  else if (field === "note") it.note = el.value;
  else {
    const s = it.schedule;
    if (field === "sched_type") s.type = el.value;
    else if (field === "start") s.start = el.value || null;
    else if (field === "end") s.end = el.value || null;
    else if (field === "day") s.dayOfMonth = el.value ? Number(el.value) : null;
    else if (field === "date") s.date = el.value || null;
    else if (field === "month") s.month = el.value || null;
  }
  persist();
  renderSankey();
  renderCalendarGrid();
  renderItemList();
  renderCatDatalist();
}

function afterMutate() { persist(); renderAll(); }

/* 开关：不重建列表（保留 DOM 以便播放开关动画） */
function onToggle(item, row, checked, source) {
  item.enabled = checked;
  if (row) row.classList.toggle("disabled", !checked);
  persist();
  renderSankey();
  renderCalendarGrid();
  if (source !== "day") renderDayDetail();
}

/* ================= 持久化 ================= */
let savedTimer = null;
async function persist() {
  try {
    await store.save(state.ledgerId, state.period.start, state.period.end, state.items);
    flashSaved("已保存");
  } catch (e) {
    console.error(e);
    flashSaved("保存失败", true);
  }
}
function flashSaved(text, isError) {
  const el = $("#saveState");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("err", !!isError);
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { el.textContent = ""; }, 1600);
}

/* ================= 账单（数据集） ================= */
function renderLedgerSelect() {
  if (!ledgerSel) return;
  ledgerSel.setOptions(ledgers.map(l => ({ value: l.id, label: `${l.name}（${l.itemCount}）` })));
  ledgerSel.setValue(activeLedgerId);
}

async function loadActiveLedger() {
  const l = await store.get(activeLedgerId);
  state = { ledgerId: l.id, period: normalizePeriod({ start: l.periodStart, end: l.periodEnd }), items: l.items || [] };
  try { localStorage.setItem(LS_ACTIVE, String(l.id)); } catch (e) { /* ignore */ }
  syncPeriodInputs();
  renderAll();
}

async function refreshLedgers() { ledgers = await store.list(); renderLedgerSelect(); }

async function newLedger() {
  const name = await mdPrompt("新账单名称：", "新账单", "新建账单");
  if (!name) return;
  const l = await store.create(name.trim());
  activeLedgerId = l.id;
  await refreshLedgers();
  await loadActiveLedger();
}

async function renameLedger() {
  const cur = ledgers.find(l => String(l.id) === String(activeLedgerId));
  if (!cur) return;
  const name = await mdPrompt("重命名账单：", cur.name, "重命名");
  if (!name) return;
  await store.rename(activeLedgerId, name.trim());
  await refreshLedgers();
}

async function deleteLedger() {
  if (ledgers.length <= 1) { mdAlert("至少保留一个账单"); return; }
  if (!(await mdConfirm("确定删除该账单及其全部项目？此操作不可撤销。", { title: "删除账单", confirmText: "删除", danger: true }))) return;
  await store.remove(activeLedgerId);
  ledgers = await store.list();
  activeLedgerId = ledgers[0].id;
  await loadActiveLedger();
}

/* ================= 表单 ================= */
function showSchedFields(type) {
  $("#schedRecurring").hidden = type !== "recurring";
  $("#schedOneoff").hidden = type !== "oneoff";
  $("#schedMonthly").hidden = type !== "monthly";
}

function updatePeriodHint() {
  const hint = $("#fPeriodHint");
  const type = schedSel ? schedSel.value : "recurring";
  if (type !== "recurring") { hint.hidden = true; return; }
  const amount = Number($("#fAmount").value) || 0;
  const start = fStartPick ? fStartPick.value : null;
  const day = Number($("#fDay").value) || 1;
  const end = (fEndPick && fEndPick.value) || null;
  if (!start) { hint.hidden = true; return; }
  const winEnd = end || state.period.end;
  let count = 0;
  const months = monthsBetween(ymOf(start), ymOf(winEnd));
  for (const month of months) {
    const [y, m] = month.split("-").map(Number);
    const occ = ymdFrom(y, m, clampDay(y, m, day));
    if (occ >= start && occ <= winEnd) count++;
  }
  const total = count * amount;
  hint.hidden = false;
  hint.innerHTML = `期间总额 <b>${fmtMoney(total)}</b> · ${count} 期 · 每月 ${fmtMoney(amount)}`;
}

function openForm(item, prefill) {
  editingId = item ? item.id : null;
  $("#modalTitle").textContent = item ? "编辑项目" : "新增项目";
  $("#fName").value = item ? item.name : "";
  $("#fAmount").value = item ? item.amount : "";
  kindSel.setValue(item ? item.kind : (prefill && prefill.kind) || "expense");
  $("#fCategory").value = item ? (item.category || "") : "";
  const s = item ? item.schedule : (prefill || { type: "recurring" });
  schedSel.setValue(s.type);
  fStartPick.setValue(s.type === "recurring" ? (s.start || "") : "");
  fEndPick.setValue(s.type === "recurring" ? (s.end || "") : "");
  $("#fDay").value = s.type === "recurring" ? (s.dayOfMonth || 1) : "";
  fDatePick.setValue(s.type === "oneoff" ? (s.date || (prefill && prefill.date) || "") : "");
  fMonthPick.setValue(s.type === "monthly" ? (s.month || currentMonth()) : "");
  $("#fNote").value = item ? (item.note || "") : "";
  $("#fEnabled").checked = item ? item.enabled : true;
  showSchedFields(s.type);
  updatePeriodHint();
  $("#modal").hidden = false;
  $("#fName").focus();
}

function closeForm() { $("#modal").hidden = true; editingId = null; }

function submitForm(e) {
  e.preventDefault();
  const name = $("#fName").value.trim();
  const amount = Number($("#fAmount").value);
  if (!name || isNaN(amount) || amount < 0) return mdAlert("请填写名称和有效金额");
  const kind = kindSel.value;
  const category = $("#fCategory").value.trim() || (kind === "income" ? "其他收入" : "其他支出");
  const type = schedSel.value;
  let schedule;
  if (type === "recurring") {
    const start = fStartPick.value;
    const end = fEndPick.value || null;
    const day = $("#fDay").value ? Number($("#fDay").value) : 1;
    if (!start || !day) return mdAlert("请选择开始日期并填写「每月几号」");
    if (end && end < start) return mdAlert("结束日期不能早于开始日期");
    schedule = { type: "recurring", start, end, dayOfMonth: day };
  } else if (type === "oneoff") {
    const date = fDatePick.value;
    if (!date) return mdAlert("请选择日期");
    schedule = { type: "oneoff", date };
  } else {
    const month = fMonthPick.value;
    if (!month) return mdAlert("请选择归属月份");
    schedule = { type: "monthly", month };
  }
  const base = { name, kind, category, amount, enabled: $("#fEnabled").checked, note: $("#fNote").value.trim(), schedule };
  if (editingId) {
    const it = state.items.find(i => i.id === editingId);
    if (it) Object.assign(it, base);
  } else {
    state.items.push(Object.assign({ id: id() }, base));
  }
  closeForm();
  afterMutate();
}

async function deleteItem(idv) {
  const it = state.items.find(i => i.id === idv);
  if (!it) return;
  if (!(await mdConfirm(`确定删除「${it.name}」？`, { title: "删除项目", confirmText: "删除", danger: true }))) return;
  state.items = state.items.filter(i => i.id !== idv);
  afterMutate();
}

/* ================= 导出图 PNG（从自绘 SVG 转位图） ================= */
function exportPng() {
  const svgEl = document.querySelector("#sankeyChart svg");
  if (!svgEl) { mdAlert("当前没有可导出的图表"); return; }
  const clone = svgEl.cloneNode(true);
  clone.classList.remove("has-hover", "fade-in");
  clone.querySelectorAll(".hi").forEach(e => e.classList.remove("hi"));
  const vb = svgEl.viewBox.baseVal;
  const w = (vb && vb.width) || svgEl.clientWidth || 900;
  const h = (vb && vb.height) || svgEl.clientHeight || 520;
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = w * 2; canvas.height = h * 2;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0b0f17";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(b => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `sankey-${todayYmd()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  };
  img.onerror = () => { URL.revokeObjectURL(url); mdAlert("导出图片失败"); };
  img.src = url;
}

function syncPeriodInputs() {
  periodStartPick.setValue(state.period.start);
  periodEndPick.setValue(state.period.end);
}

/* ================= 视图切换 / 事件绑定 ================= */
function switchTab(tab) {
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  $("#view-sankey").hidden = tab !== "sankey";
  $("#view-calendar").hidden = tab !== "calendar";
  $("#view-table").hidden = tab !== "table";
  if (tab === "sankey" && lastSankeyData) setTimeout(() => renderSankeySvg(lastSankeyData, { fade: false }), 0);
  if (tab === "table") renderTable();
}

function bindEvents() {
  $("#btnAdd").addEventListener("click", () => openForm(null));
  $("#btnSeed").addEventListener("click", async () => {
    if (!(await mdConfirm("用示例数据替换当前账单的全部项目？", { title: "载入示例", confirmText: "替换" }))) return;
    state.items = demoItems();
    state.period = { start: "2026-01-01", end: "2026-12-31" };
    syncPeriodInputs();
    afterMutate();
  });
  $("#btnExportCsv").addEventListener("click", async () => {
    try {
      const r = await store.exportCsv(state.ledgerId);
      if (typeof r === "string" && r.startsWith("saved:")) mdAlert("已导出 CSV：\n" + r.slice(6));
    } catch (e) { mdAlert("导出失败：" + e.message); }
  });
  $("#btnExportSqlite").addEventListener("click", async () => {
    try {
      const r = await store.exportSqlite(state.ledgerId);
      if (r === "unsupported") mdAlert("导出 .sqlite 仅桌面版支持（浏览器版请用 CSV）");
      else if (typeof r === "string" && r.startsWith("saved:")) mdAlert("已导出 .sqlite：\n" + r.slice(6));
    } catch (e) { mdAlert("导出失败：" + e.message); }
  });
  $("#btnExportPng").addEventListener("click", exportPng);
  $("#modalClose").addEventListener("click", closeForm);
  $("#btnCancel").addEventListener("click", closeForm);
  $("#itemForm").addEventListener("submit", submitForm);
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeForm(); });
  ["fAmount", "fDay"].forEach(fid => $("#" + fid).addEventListener("input", updatePeriodHint));

  $("#btnNewLedger").addEventListener("click", newLedger);
  $("#btnRenameLedger").addEventListener("click", renameLedger);
  $("#btnDeleteLedger").addEventListener("click", deleteLedger);

  // 视图 Tab
  $$(".tab").forEach(t => t.addEventListener("click", () => switchTab(t.dataset.tab)));

  // 快捷区间
  $("#btnThisMonth").addEventListener("click", () => {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth() + 1;
    state.period = { start: ymdFrom(y, m, 1), end: ymdFrom(y, m, daysIn(y, m)) };
    periodStartPick.setValue(state.period.start);
    periodEndPick.setValue(state.period.end);
    persist(); renderSankey();
  });
  $("#btnThisYear").addEventListener("click", () => {
    const y = new Date().getFullYear();
    state.period = { start: ymdFrom(y, 1, 1), end: ymdFrom(y, 12, 31) };
    periodStartPick.setValue(state.period.start);
    periodEndPick.setValue(state.period.end);
    persist(); renderSankey();
  });

  const shift = (n) => {
    let [y, m] = ((calMonthPick && calMonthPick.value) || currentMonth()).split("-").map(Number);
    m += n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; }
    calMonthPick.setValue(`${y}-${pad(m)}`);
    selectedDate = ymdFrom(y, m, 1);
    renderCalendar();
  };
  $("#calPrev").addEventListener("click", () => shift(-1));
  $("#calNext").addEventListener("click", () => shift(1));
  $("#calToday").addEventListener("click", () => { calMonthPick.setValue(currentMonth()); selectedDate = todayYmd(); renderCalendar(); });

  window.addEventListener("resize", () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      if (lastSankeyData) renderSankeySvg(lastSankeyData, { fade: false });
    });
  });
}

function initWindowControls() {
  if (!HAS_NATIVE) return;
  $("#winControls").hidden = false;
  $("#winMin").addEventListener("click", () => nativeCall("WindowMinimize").catch(() => {}));
  $("#winMax").addEventListener("click", () => nativeCall("WindowMaximizeToggle").catch(() => {}));
  $("#winClose").addEventListener("click", () => nativeCall("WindowClose").catch(() => {}));

  const topbar = $(".topbar");
  const isInteractive = (t) => !!(t && t.closest && t.closest("button, input, select, .md-select, .md-datepicker, .win-controls, .ledger-bar, .topbar-actions"));
  topbar.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || isInteractive(e.target)) return;
    e.preventDefault();
    nativeCall("WindowDragStart").catch(() => {});
  });
  topbar.addEventListener("dblclick", (e) => {
    if (isInteractive(e.target)) return;
    nativeCall("WindowMaximizeToggle").catch(() => {});
  });
}

async function init() {
  bindEvents();
  initWindowControls();

  calMonthPick = new MdDatePicker($("#calMonth"), "month", () => { selectedDate = null; renderCalendar(); });
  periodStartPick = new MdDatePicker($("#periodStart"), "date", (v) => { state.period.start = v; persist(); renderSankey(); });
  periodEndPick = new MdDatePicker($("#periodEnd"), "date", (v) => { state.period.end = v; persist(); renderSankey(); });
  fStartPick = new MdDatePicker($("#fStart"), "date", () => updatePeriodHint());
  fEndPick = new MdDatePicker($("#fEnd"), "date", () => updatePeriodHint());
  fDatePick = new MdDatePicker($("#fDate"), "date");
  fMonthPick = new MdDatePicker($("#fMonth"), "month");
  calMonthPick.setValue(currentMonth());

  ledgerSel = new MdSelect($("#ledgerSelect"), async (v) => {
    activeLedgerId = /^\d+$/.test(String(v)) ? Number(v) : v;
    try { await loadActiveLedger(); } catch (e) { mdAlert("切换账单失败：" + e.message); }
  });
  kindSel = new MdSelect($("#fKind"));
  kindSel.setOptions([
    { value: "income", label: "收入" },
    { value: "expense", label: "支出" },
    { value: "loan", label: "支出 · 借贷/分期" },
  ]);
  kindSel.setValue("expense");
  schedSel = new MdSelect($("#fSched"), (v) => { showSchedFields(v); updatePeriodHint(); });
  schedSel.setOptions([
    { value: "recurring", label: "重复 · 固定日期（自定开始/结束）" },
    { value: "oneoff", label: "一次性 · 确定日期" },
    { value: "monthly", label: "按月手动（非固定日期）" },
  ]);
  schedSel.setValue("recurring");

  try {
    ledgers = await store.list();
    window.__ledgersLoaded = ledgers.length;
    let savedActive = null;
    try { savedActive = localStorage.getItem(LS_ACTIVE); } catch (e) { /* ignore */ }
    const pick = ledgers.find(l => String(l.id) === savedActive) || ledgers[0];
    activeLedgerId = pick ? pick.id : null;
    if (HAS_NATIVE) nativeCall("Log", "bridge ready; ledgers=" + ledgers.length + "; active=" + activeLedgerId).catch(() => {});
    await loadActiveLedger();
  } catch (e) {
    console.error(e);
    window.__initError = e.message;
    if (HAS_NATIVE) nativeCall("Log", "init FAILED: " + e.message).catch(() => {});
    mdAlert("初始化失败：" + e.message);
  }
}

document.addEventListener("DOMContentLoaded", init);
