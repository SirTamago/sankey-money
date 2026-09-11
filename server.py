#!/usr/bin/env python3
"""收支 / 分期 桑基图看板 —— 本地后端

仅用 Python 标准库：静态文件托管 + SQLite REST API。
    python server.py            # 默认 http://127.0.0.1:8123
    PORT=9000 python server.py  # 自定义端口
数据文件：./data/finance.db
"""
import json
import os
import re
import sqlite3
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, "data", "finance.db")
PORT = int(os.environ.get("PORT", "8123"))
HOST = os.environ.get("HOST", "127.0.0.1")

SCHEMA = """
CREATE TABLE IF NOT EXISTS ledgers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  ledger_id   INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  category    TEXT,
  amount      REAL NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  note        TEXT,
  sched_type  TEXT NOT NULL,
  sched_start TEXT, sched_end TEXT, sched_day INTEGER,
  sched_date  TEXT, sched_month TEXT,
  sort_order  INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_ledger ON items(ledger_id);
"""

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".json": "application/json; charset=utf-8",
}


def connect(path=DB_PATH):
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def demo_items():
    def it(name, kind, cat, amount, stype, start=None, end=None, day=None):
        return (name, kind, cat, amount, stype, start, end, day)
    return [
        it("预计工资收入", "income", "工资", 15000, "recurring", "2026-01-01", None, 10),
        it("兼职/其他收入", "income", "兼职", 2500, "recurring", "2026-01-01", None, 20),
        it("数码产品分期", "loan", "分期还款", 2300, "recurring", "2026-01-01", "2026-12-31", 5),
        it("房贷/车贷/大件分期", "loan", "分期还款", 3500, "recurring", "2026-01-01", None, 15),
        it("基础开销(房租/水电气/网费)", "expense", "固定开销", 3000, "recurring", "2026-01-01", None, 1),
        it("计划日常消费(餐饮/购物)", "expense", "日常消费", 4000, "recurring", "2026-01-01", None, 25),
    ]


def insert_items(con, ledger_id, items):
    for order, item in enumerate(items):
        s = item.get("schedule") or {}
        con.execute(
            """INSERT INTO items (id, ledger_id, name, kind, category, amount, enabled, note,
                                  sched_type, sched_start, sched_end, sched_day, sched_date, sched_month, sort_order)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (item.get("id") or ("it_%d_%d" % (ledger_id, order)), ledger_id, item.get("name") or "",
             item.get("kind") or "expense", item.get("category"), float(item.get("amount") or 0),
             1 if item.get("enabled", True) else 0, item.get("note"),
             s.get("type") or "recurring", s.get("start"), s.get("end"), s.get("dayOfMonth"),
             s.get("date"), s.get("month"), order))


def seed(con):
    con.execute("INSERT INTO ledgers (name, period_start, period_end, created_at) VALUES (?,?,?,datetime('now'))",
                ("示例数据", "2026-01-01", "2026-12-31"))
    demo_id = con.execute("SELECT last_insert_rowid()").fetchone()[0]
    con.execute("INSERT INTO ledgers (name, period_start, period_end, created_at) VALUES (?,?,?,datetime('now'))",
                ("我的账单", "2026-01-01", "2026-12-31"))
    rows = demo_items()
    for i, (name, kind, cat, amount, stype, start, end, day) in enumerate(rows):
        con.execute(
            """INSERT INTO items (id, ledger_id, name, kind, category, amount, enabled, note,
                                  sched_type, sched_start, sched_end, sched_day, sort_order)
               VALUES (?,?,?,?,?,?,1,NULL,?,?,?,?,?)""",
            ("it_demo_%d" % i, demo_id, name, kind, cat, amount, stype, start, end, day, i))


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = connect()
    con.executescript(SCHEMA)
    if con.execute("SELECT COUNT(*) FROM ledgers").fetchone()[0] == 0:
        seed(con)
        print("[db] 初始化并写入示例数据")
    con.commit()
    con.close()


def item_dict(r):
    return {
        "id": r["id"], "name": r["name"], "kind": r["kind"], "category": r["category"],
        "amount": r["amount"], "enabled": bool(r["enabled"]), "note": r["note"],
        "schedule": {"type": r["sched_type"], "start": r["sched_start"], "end": r["sched_end"],
                     "dayOfMonth": r["sched_day"], "date": r["sched_date"], "month": r["sched_month"]},
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "SankeyMoney/1.0"

    def log_message(self, fmt, *args):
        pass  # 保持安静，只用下面的 log()

    # ---------- 响应助手 ----------
    def log(self, msg):
        print("[api] " + msg, flush=True)

    def send_bytes(self, data, ctype, filename=None, status=200):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if filename:
            from urllib.parse import quote
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(filename))
        self.end_headers()
        self.wfile.write(data)

    def json(self, obj, status=200):
        self.send_bytes(json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                        "application/json; charset=utf-8", status=status)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        try:
            return json.loads(raw or b"{}")
        except Exception:
            return {}

    # ---------- 路由 ----------
    def do_GET(self):
        p = urlparse(self.path).path
        try:
            if p == "/api/health":
                return self.json({"ok": True, "db": DB_PATH})
            if p == "/api/ledgers":
                return self.list_ledgers()
            m = re.fullmatch(r"/api/ledgers/(\d+)", p)
            if m:
                return self.get_ledger(int(m.group(1)))
            m = re.fullmatch(r"/api/ledgers/(\d+)/export\.csv", p)
            if m:
                return self.export_csv(int(m.group(1)))
            m = re.fullmatch(r"/api/ledgers/(\d+)/export\.sqlite", p)
            if m:
                return self.export_sqlite(int(m.group(1)))
            return self.serve_static(p)
        except Exception as ex:  # noqa
            self.log("ERROR %s %s -> %s" % (self.command, p, ex))
            self.json({"error": str(ex)}, 500)

    def do_POST(self):
        try:
            if urlparse(self.path).path == "/api/ledgers":
                b = self.body()
                name = (b.get("name") or "新账单").strip()
                con = connect()
                with con:
                    con.execute("INSERT INTO ledgers (name, period_start, period_end, created_at) VALUES (?,?,?,datetime('now'))",
                                (name, "2026-01-01", "2026-12-31"))
                    lid = con.execute("SELECT last_insert_rowid()").fetchone()[0]
                con.close()
                return self.json({"id": lid, "name": name, "periodStart": "2026-01-01", "periodEnd": "2026-12-31"})
            self.json({"error": "not found"}, 404)
        except Exception as ex:
            self.json({"error": str(ex)}, 500)

    def do_PATCH(self):
        m = re.fullmatch(r"/api/ledgers/(\d+)", urlparse(self.path).path)
        if not m:
            return self.json({"error": "not found"}, 404)
        lid = int(m.group(1))
        b = self.body()
        con = connect()
        with con:
            if b.get("name") is not None:
                con.execute("UPDATE ledgers SET name=? WHERE id=?", (b["name"], lid))
        con.close()
        self.json({})

    def do_DELETE(self):
        m = re.fullmatch(r"/api/ledgers/(\d+)", urlparse(self.path).path)
        if not m:
            return self.json({"error": "not found"}, 404)
        con = connect()
        with con:
            con.execute("DELETE FROM ledgers WHERE id=?", (int(m.group(1)),))
        con.close()
        self.json({})

    def do_PUT(self):
        m = re.fullmatch(r"/api/ledgers/(\d+)/items", urlparse(self.path).path)
        if not m:
            return self.json({"error": "not found"}, 404)
        lid = int(m.group(1))
        b = self.body()
        con = connect()
        with con:
            con.execute("UPDATE ledgers SET period_start=?, period_end=? WHERE id=?",
                        (b.get("period_start"), b.get("period_end"), lid))
            con.execute("DELETE FROM items WHERE ledger_id=?", (lid,))
            insert_items(con, lid, b.get("items") or [])
        con.close()
        self.json({})

    # ---------- 业务 ----------
    def list_ledgers(self):
        con = connect()
        rows = con.execute(
            """SELECT l.*, (SELECT COUNT(*) FROM items i WHERE i.ledger_id=l.id) AS c
               FROM ledgers l ORDER BY l.id""").fetchall()
        con.close()
        self.json([{"id": r["id"], "name": r["name"], "periodStart": r["period_start"],
                    "periodEnd": r["period_end"], "itemCount": r["c"]} for r in rows])

    def get_ledger(self, lid):
        con = connect()
        r = con.execute("SELECT * FROM ledgers WHERE id=?", (lid,)).fetchone()
        if not r:
            con.close()
            return self.json({"error": "ledger not found"}, 404)
        items = [item_dict(x) for x in con.execute(
            "SELECT * FROM items WHERE ledger_id=? ORDER BY sort_order, rowid", (lid,)).fetchall()]
        con.close()
        self.json({"id": r["id"], "name": r["name"], "periodStart": r["period_start"],
                   "periodEnd": r["period_end"], "items": items, "itemCount": len(items)})

    def export_csv(self, lid):
        con = connect()
        r = con.execute("SELECT * FROM ledgers WHERE id=?", (lid,)).fetchone()
        if not r:
            con.close()
            return self.json({"error": "ledger not found"}, 404)
        items = [item_dict(x) for x in con.execute(
            "SELECT * FROM items WHERE ledger_id=? ORDER BY sort_order, rowid", (lid,)).fetchall()]
        con.close()
        import csv as _csv
        import io as _io
        buf = _io.StringIO()
        w = _csv.writer(buf)
        w.writerow(["账单", "名称", "类型", "分类", "金额", "启用", "排期方式",
                    "开始日期", "结束日期", "每月几号", "日期", "归属月份", "备注"])
        for x in items:
            s = x["schedule"]
            w.writerow([r["name"], x["name"], x["kind"], x["category"] or "", x["amount"],
                        1 if x["enabled"] else 0, s["type"], s["start"] or "", s["end"] or "",
                        s["dayOfMonth"] if s["dayOfMonth"] is not None else "", s["date"] or "",
                        s["month"] or "", x["note"] or ""])
        data = ("\ufeff" + buf.getvalue()).encode("utf-8")
        self.send_bytes(data, "text/csv; charset=utf-8", filename=r["name"] + ".csv")

    def export_sqlite(self, lid):
        con = connect()
        r = con.execute("SELECT * FROM ledgers WHERE id=?", (lid,)).fetchone()
        if not r:
            con.close()
            return self.json({"error": "ledger not found"}, 404)
        items = [item_dict(x) for x in con.execute(
            "SELECT * FROM items WHERE ledger_id=? ORDER BY sort_order, rowid", (lid,)).fetchall()]
        con.close()

        fd, tmp = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        try:
            out = connect(tmp)
            out.executescript(SCHEMA)
            with out:
                out.execute("INSERT INTO ledgers (name, period_start, period_end, created_at) VALUES (?,?,?,datetime('now'))",
                            (r["name"], r["period_start"], r["period_end"]))
                new_id = out.execute("SELECT last_insert_rowid()").fetchone()[0]
                insert_items(out, new_id, items)
            out.close()
            with open(tmp, "rb") as f:
                data = f.read()
        finally:
            os.remove(tmp)
        self.send_bytes(data, "application/octet-stream", filename=r["name"] + ".sqlite")

    # ---------- 静态文件 ----------
    def serve_static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        rel = unquote(path).lstrip("/")
        full = os.path.normpath(os.path.join(ROOT, rel))
        if not full.startswith(ROOT) or not os.path.isfile(full):
            return self.send_bytes(b"404 not found", "text/plain; charset=utf-8", status=404)
        ext = os.path.splitext(full)[1].lower()
        with open(full, "rb") as f:
            data = f.read()
        self.send_bytes(data, MIME.get(ext, "application/octet-stream"))


def main():
    init_db()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print("收支桑基图看板（web 版）")
    print("  数据库：%s" % DB_PATH)
    print("  访问：  http://%s:%d" % (HOST, PORT))
    print("  Ctrl+C 停止")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
