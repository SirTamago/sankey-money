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

/* 颜色 */
const PALETTE = ["#61ddaa", "#5b8ff9", "#f6903d", "#ea7baa", "#6dc8ec", "#9f7bff", "#f6bd16", "#f08bb4", "#34c6b8", "#00b3ff"];
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
const TYPE_COLOR = { income: "#36cfc9", expense: "#f6903d", loan: "#ff4d4f" };
const FONT_STACK = '"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI","Noto Sans SC","PingFang SC",system-ui,sans-serif';

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
      { id: 1, name: "示例数据", periodStart: "2026-01", periodEnd: "2026-12", items: demoItems() },
      { id: 2, name: "我的账单", periodStart: "2026-01", periodEnd: "2026-12", items: [] },
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
    const l = { id: nid, name, periodStart: "2026-01", periodEnd: "2026-12", items: [] };
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

/* ================= 应用状态 ================= */
let ledgers = [];
let activeLedgerId = null;
let state = { ledgerId: null, period: { start: "2026-01", end: "2026-12" }, items: [] };
let editingId = null;
let selectedDate = todayYmd();
let fadeTimer = null;
let resizeTimer = null;

/* ================= 排期展开引擎 ================= */
function monthlyOccurrence(item, month) {
  const s = item.schedule;
  if (s.type === "monthly") return s.month === month;
  if (s.type === "oneoff") return ymOf(s.date) === month;
  if (s.type === "recurring") {
    const [y, m] = month.split("-").map(Number);
    const occ = ymdFrom(y, m, clampDay(y, m, s.dayOfMonth));
    if (occ < s.start) return false;
    if (s.end && occ > s.end) return false;
    return true;
  }
  return false;
}

function itemAmountInMonth(item, month) {
  return monthlyOccurrence(item, month) ? item.amount : 0;
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

function buildSankeyMonths(months) {
  const income = {}, expense = {}, inCnt = {}, exCnt = {};
  let totalIncome = 0, totalExpense = 0;
  for (const it of state.items) {
    if (!it.enabled) continue;
    let amt = 0, cnt = 0;
    for (const month of months) {
      const a = itemAmountInMonth(it, month);
      if (a > 0) { amt += a; cnt++; }
    }
    if (cnt === 0) continue;
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
  nodes.push({ name: "总收入来源", value: totalIncome, depth: 1, itemStyle: { color: "#5b8ff9", opacity: 0.92 }, usrLabel: "总收入来源", label: { position: "top" } });
  inLabels.forEach(l => links.push({ source: "IN_" + l, target: "总收入来源", value: income[l] }));

  nodes.push({ name: "总计划支出", value: totalExpense, depth: 2, itemStyle: { color: "#f26d6d", opacity: 0.92 }, usrLabel: "总计划支出", label: { position: "top" } });
  links.push({ source: "总收入来源", target: "总计划支出", value: totalExpense });

  exLabels.forEach(l => nodes.push({
    name: "EX_" + l, value: expense[l], depth: 3,
    itemStyle: { color: colorFor("ex:" + l), opacity: 0.92 }, usrLabel: l, usrCount: exCnt[l],
    label: { position: "right" }
  }));
  exLabels.forEach(l => links.push({ source: "总计划支出", target: "EX_" + l, value: expense[l] }));

  if (surplus >= 0) {
    nodes.push({ name: "结余/自由支配", value: surplus, depth: 2, itemStyle: { color: "#36cfc9", opacity: 0.92 }, usrLabel: "结余 / 自由支配", label: { position: "bottom" } });
    links.push({ source: "总收入来源", target: "结余/自由支配", value: surplus });
  } else {
    nodes.push({ name: "超支", value: -surplus, depth: 2, itemStyle: { color: "#ff4d4f", opacity: 0.92 }, usrLabel: "超支", label: { position: "bottom" } });
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

function currentMonthsForSankey() {
  const mode = $(".seg#sankeyMode .active").dataset.mode;
  if (mode === "overall") {
    const s = $("#periodStart").value, e = $("#periodEnd").value;
    return { label: `整体 · ${s} ~ ${e}`, months: monthsBetween(s, e) };
  }
  const m = $("#modeMonth").value || currentMonth();
  return { label: `单月 · ${m}`, months: [m] };
}

function renderSankey() {
  const { label, months } = currentMonthsForSankey();
  const data = buildSankeyMonths(months);
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
function renderCalendar() {
  const month = $("#calMonth").value || currentMonth();
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
    renderCalendar();
  }));
  renderDayDetail();
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
  const winLabel = s.end ? `${s.start} ~ ${s.end}` : `${s.start} ~ ${winEnd}（当前整体区间）`;
  let count = 0;
  const months = monthsBetween(ymOf(s.start), winEnd);
  for (const month of months) {
    const [y, m] = month.split("-").map(Number);
    const occ = ymdFrom(y, m, clampDay(y, m, s.dayOfMonth));
    if (occ >= s.start && occ <= (s.end || `${winEnd}-31`)) count++;
  }
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
    $("[data-role=toggle]", row).addEventListener("change", (e) => { item.enabled = e.target.checked; afterMutate(); });
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
    $("[data-role=toggle]", row).addEventListener("change", (e) => { item.enabled = e.target.checked; afterMutate(); });
    $("[data-role=edit]", row).addEventListener("click", () => openForm(item));
    $("[data-role=delete]", row).addEventListener("click", () => deleteItem(idv));
    const adddate = $("[data-role=adddate]", row);
    if (adddate) adddate.addEventListener("click", () => openForm(null, { type: "oneoff", date: selectedDate }));
  });
  $("#dayAdd").addEventListener("click", () => openForm(null, { type: "oneoff", date: selectedDate }));
}

function renderAll() { renderCatDatalist(); renderItemList(); renderCalendar(); renderSankey(); renderLedgerSelect(); }

function afterMutate() { persist(); renderAll(); }

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
  const sel = $("#ledgerSelect");
  if (!sel) return;
  sel.innerHTML = ledgers.map(l =>
    `<option value="${l.id}" ${String(l.id) === String(activeLedgerId) ? "selected" : ""}>${escapeHtml(l.name)}（${l.itemCount}）</option>`
  ).join("");
}

async function loadActiveLedger() {
  const l = await store.get(activeLedgerId);
  state = { ledgerId: l.id, period: { start: l.periodStart, end: l.periodEnd }, items: l.items || [] };
  try { localStorage.setItem(LS_ACTIVE, String(l.id)); } catch (e) { /* ignore */ }
  syncPeriodInputs();
  renderAll();
}

async function refreshLedgers() { ledgers = await store.list(); renderLedgerSelect(); }

async function newLedger() {
  const name = prompt("新账单名称：", "新账单");
  if (!name) return;
  const l = await store.create(name.trim());
  activeLedgerId = l.id;
  await refreshLedgers();
  await loadActiveLedger();
}

async function renameLedger() {
  const cur = ledgers.find(l => String(l.id) === String(activeLedgerId));
  if (!cur) return;
  const name = prompt("重命名账单：", cur.name);
  if (!name) return;
  await store.rename(activeLedgerId, name.trim());
  await refreshLedgers();
}

async function deleteLedger() {
  if (ledgers.length <= 1) { alert("至少保留一个账单"); return; }
  if (!confirm("确定删除该账单及其全部项目？此操作不可撤销。")) return;
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
  const type = $("#fSched").value;
  if (type !== "recurring") { hint.hidden = true; return; }
  const amount = Number($("#fAmount").value) || 0;
  const start = $("#fStart").value;
  const day = Number($("#fDay").value) || 1;
  const end = $("#fEnd").value || null;
  if (!start) { hint.hidden = true; return; }
  const winEnd = end ? ymOf(end) : state.period.end;
  let count = 0;
  const months = monthsBetween(ymOf(start), winEnd);
  for (const month of months) {
    const [y, m] = month.split("-").map(Number);
    const occ = ymdFrom(y, m, clampDay(y, m, day));
    if (occ >= start && occ <= (end || `${winEnd}-31`)) count++;
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
  $("#fKind").value = item ? item.kind : (prefill && prefill.kind) || "expense";
  $("#fCategory").value = item ? (item.category || "") : "";
  const s = item ? item.schedule : (prefill || { type: "recurring" });
  $("#fSched").value = s.type;
  $("#fStart").value = s.type === "recurring" ? (s.start || "") : "";
  $("#fEnd").value = s.type === "recurring" ? (s.end || "") : "";
  $("#fDay").value = s.type === "recurring" ? (s.dayOfMonth || 1) : "";
  $("#fDate").value = s.type === "oneoff" ? (s.date || (prefill && prefill.date) || "") : "";
  $("#fMonth").value = s.type === "monthly" ? (s.month || currentMonth()) : "";
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
  if (!name || isNaN(amount) || amount < 0) return alert("请填写名称和有效金额");
  const kind = $("#fKind").value;
  const category = $("#fCategory").value.trim() || (kind === "income" ? "其他收入" : "其他支出");
  const type = $("#fSched").value;
  let schedule;
  if (type === "recurring") {
    const start = $("#fStart").value;
    const end = $("#fEnd").value || null;
    const day = $("#fDay").value ? Number($("#fDay").value) : 1;
    if (!start || !day) return alert("请选择开始日期并填写「每月几号」");
    if (end && end < start) return alert("结束日期不能早于开始日期");
    schedule = { type: "recurring", start, end, dayOfMonth: day };
  } else if (type === "oneoff") {
    const date = $("#fDate").value;
    if (!date) return alert("请选择日期");
    schedule = { type: "oneoff", date };
  } else {
    const month = $("#fMonth").value;
    if (!month) return alert("请选择归属月份");
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

function deleteItem(idv) {
  state.items = state.items.filter(i => i.id !== idv);
  afterMutate();
}

/* ================= 导出图 PNG（从自绘 SVG 转位图） ================= */
function exportPng() {
  const svgEl = document.querySelector("#sankeyChart svg");
  if (!svgEl) { alert("当前没有可导出的图表"); return; }
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
  img.onerror = () => { URL.revokeObjectURL(url); alert("导出图片失败"); };
  img.src = url;
}

function syncPeriodInputs() {
  $("#periodStart").value = state.period.start;
  $("#periodEnd").value = state.period.end;
}

/* ================= 视图切换 / 事件绑定 ================= */
function switchTab(tab) {
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  $("#view-sankey").hidden = tab !== "sankey";
  $("#view-calendar").hidden = tab !== "calendar";
  if (tab === "sankey" && lastSankeyData) setTimeout(() => renderSankeySvg(lastSankeyData, { fade: false }), 0);
}

function bindEvents() {
  $("#btnAdd").addEventListener("click", () => openForm(null));
  $("#btnSeed").addEventListener("click", () => {
    if (!confirm("用示例数据替换当前账单的全部项目？")) return;
    state.items = demoItems();
    state.period = { start: "2026-01", end: "2026-12" };
    syncPeriodInputs();
    afterMutate();
  });
  $("#btnExportCsv").addEventListener("click", async () => {
    try {
      const r = await store.exportCsv(state.ledgerId);
      if (typeof r === "string" && r.startsWith("saved:")) alert("已导出 CSV：\n" + r.slice(6));
    } catch (e) { alert("导出失败：" + e.message); }
  });
  $("#btnExportSqlite").addEventListener("click", async () => {
    try {
      const r = await store.exportSqlite(state.ledgerId);
      if (r === "unsupported") alert("导出 .sqlite 仅桌面版支持（浏览器版请用 CSV）");
      else if (typeof r === "string" && r.startsWith("saved:")) alert("已导出 .sqlite：\n" + r.slice(6));
    } catch (e) { alert("导出失败：" + e.message); }
  });
  $("#btnExportPng").addEventListener("click", exportPng);
  $("#modalClose").addEventListener("click", closeForm);
  $("#btnCancel").addEventListener("click", closeForm);
  $("#itemForm").addEventListener("submit", submitForm);
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeForm(); });
  $("#fSched").addEventListener("change", () => { showSchedFields($("#fSched").value); updatePeriodHint(); });
  ["fAmount", "fDay", "fStart", "fEnd"].forEach(fid => $("#" + fid).addEventListener("input", updatePeriodHint));

  // 账单切换
  $("#ledgerSelect").addEventListener("change", async (e) => {
    activeLedgerId = e.target.value;
    await loadActiveLedger();
  });
  $("#btnNewLedger").addEventListener("click", newLedger);
  $("#btnRenameLedger").addEventListener("click", renameLedger);
  $("#btnDeleteLedger").addEventListener("click", deleteLedger);

  // 视图 Tab
  $$(".tab").forEach(t => t.addEventListener("click", () => switchTab(t.dataset.tab)));

  // 桑基模式
  $$("#sankeyMode button").forEach(b => b.addEventListener("click", () => {
    $$("#sankeyMode button").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    $("#periodFields").hidden = b.dataset.mode !== "overall";
    $("#modeMonth").parentElement.hidden = b.dataset.mode === "overall";
    renderSankey();
  }));

  $("#modeMonth").addEventListener("change", renderSankey);
  $("#periodStart").addEventListener("change", () => { state.period.start = $("#periodStart").value; persist(); renderSankey(); });
  $("#periodEnd").addEventListener("change", () => { state.period.end = $("#periodEnd").value; persist(); renderSankey(); });

  const shift = (n) => {
    let [y, m] = ($("#calMonth").value || currentMonth()).split("-").map(Number);
    m += n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; }
    $("#calMonth").value = `${y}-${pad(m)}`;
    selectedDate = ymdFrom(y, m, 1);
    renderCalendar();
  };
  $("#calPrev").addEventListener("click", () => shift(-1));
  $("#calNext").addEventListener("click", () => shift(1));
  $("#calToday").addEventListener("click", () => { $("#calMonth").value = currentMonth(); selectedDate = todayYmd(); renderCalendar(); });
  $("#calMonth").addEventListener("change", () => { selectedDate = null; renderCalendar(); });

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (lastSankeyData) renderSankeySvg(lastSankeyData, { fade: false }); }, 140);
  });
}

async function init() {
  $("#modeMonth").value = currentMonth();
  $("#calMonth").value = currentMonth();
  bindEvents();
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
    alert("初始化失败：" + e.message);
  }
}

document.addEventListener("DOMContentLoaded", init);
