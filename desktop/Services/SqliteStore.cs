using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace SankeyMoney;

/// <summary>Owns the on-disk SQLite database: schema, seeding, ledger/item CRUD, CSV export.</summary>
public sealed class SqliteStore
{
    public string DbPath { get; }
    private readonly string _connString;

    public string Serialize(object o) => JsonSerializer.Serialize(o, JsonOpts);

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    public SqliteStore()
    {
        var dir = Path.Combine(AppPaths.ExeDir, "data");
        if (!TryEnsureWritable(dir))
        {
            dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SankeyMoney");
            Directory.CreateDirectory(dir);
        }
        DbPath = Path.Combine(dir, "finance.db");
        _connString = new SqliteConnectionStringBuilder { DataSource = DbPath }.ToString();
        Init();
    }

    private static bool TryEnsureWritable(string dir)
    {
        try
        {
            Directory.CreateDirectory(dir);
            var probe = Path.Combine(dir, ".write_probe");
            File.WriteAllText(probe, "ok");
            File.Delete(probe);
            return true;
        }
        catch { return false; }
    }

    private SqliteConnection Open()
    {
        var conn = new SqliteConnection(_connString);
        conn.Open();
        using var pragma = conn.CreateCommand();
        pragma.CommandText = "PRAGMA foreign_keys = ON;";
        pragma.ExecuteNonQuery();
        return conn;
    }

    private void Init()
    {
        using var conn = Open();
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
CREATE TABLE IF NOT EXISTS ledgers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  ledger_id INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  category TEXT,
  amount REAL NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  sched_type TEXT NOT NULL,
  sched_start TEXT,
  sched_end TEXT,
  sched_day INTEGER,
  sched_date TEXT,
  sched_month TEXT,
  sort_order INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_ledger ON items(ledger_id);";
            cmd.ExecuteNonQuery();
        }

        // Seed on first run
        using (var count = conn.CreateCommand())
        {
            count.CommandText = "SELECT COUNT(*) FROM ledgers;";
            if (Convert.ToInt64(count.ExecuteScalar()) == 0) Seed(conn);
        }
    }

    private void Seed(SqliteConnection conn)
    {
        var demo = new LedgerDto { Name = "示例数据", PeriodStart = "2026-01-01", PeriodEnd = "2026-12-31" };
        var mine = new LedgerDto { Name = "我的账单", PeriodStart = "2026-01-01", PeriodEnd = "2026-12-31" };
        var demoId = InsertLedger(conn, demo);
        InsertLedger(conn, mine);

        var items = new List<ItemDto>
        {
            NewItem("预计工资收入", "income", "工资", 15000, "recurring", start: "2026-01-01", end: null, day: 10),
            NewItem("兼职/其他收入", "income", "兼职", 2500, "recurring", start: "2026-01-01", end: null, day: 20),
            NewItem("数码产品分期", "loan", "分期还款", 2300, "recurring", start: "2026-01-01", end: "2026-12-31", day: 5),
            NewItem("房贷/车贷/大件分期", "loan", "分期还款", 3500, "recurring", start: "2026-01-01", end: null, day: 15),
            NewItem("基础开销(房租/水电气/网费)", "expense", "固定开销", 3000, "recurring", start: "2026-01-01", end: null, day: 1),
            NewItem("计划日常消费(餐饮/购物)", "expense", "日常消费", 4000, "recurring", start: "2026-01-01", end: null, day: 25),
        };
        ReplaceItems(conn, demoId, items);
    }

    private static ItemDto NewItem(string name, string kind, string category, double amount,
        string type, string? start = null, string? end = null, int? day = null,
        string? date = null, string? month = null)
        => new()
        {
            Id = "it_" + Guid.NewGuid().ToString("N").Substring(0, 12),
            Name = name, Kind = kind, Category = category, Amount = amount, Enabled = true,
            Schedule = new ScheduleDto { Type = type, Start = start, End = end, DayOfMonth = day, Date = date, Month = month }
        };

    private static long InsertLedger(SqliteConnection conn, LedgerDto l)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"INSERT INTO ledgers(name, period_start, period_end, created_at)
                            VALUES ($n, $ps, $pe, $c); SELECT last_insert_rowid();";
        cmd.Parameters.AddWithValue("$n", l.Name);
        cmd.Parameters.AddWithValue("$ps", l.PeriodStart);
        cmd.Parameters.AddWithValue("$pe", l.PeriodEnd);
        cmd.Parameters.AddWithValue("$c", DateTime.UtcNow.ToString("o"));
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    public List<LedgerDto> ListLedgers()
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT l.id, l.name, l.period_start, l.period_end,
                            (SELECT COUNT(*) FROM items i WHERE i.ledger_id = l.id)
                            FROM ledgers l ORDER BY l.id;";
        using var r = cmd.ExecuteReader();
        var list = new List<LedgerDto>();
        while (r.Read())
        {
            list.Add(new LedgerDto
            {
                Id = r.GetInt64(0), Name = r.GetString(1),
                PeriodStart = r.GetString(2), PeriodEnd = r.GetString(3),
                ItemCount = r.GetInt32(4)
            });
        }
        return list;
    }

    public LedgerDto GetLedger(long id)
    {
        using var conn = Open();
        LedgerDto ledger;
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT id, name, period_start, period_end FROM ledgers WHERE id=$id;";
            cmd.Parameters.AddWithValue("$id", id);
            using var r = cmd.ExecuteReader();
            if (!r.Read()) throw new InvalidOperationException("账单不存在: " + id);
            ledger = new LedgerDto
            {
                Id = r.GetInt64(0), Name = r.GetString(1),
                PeriodStart = r.GetString(2), PeriodEnd = r.GetString(3)
            };
        }
        ledger.Items = ReadItems(conn, id);
        ledger.ItemCount = ledger.Items.Count;
        return ledger;
    }

    private static List<ItemDto> ReadItems(SqliteConnection conn, long ledgerId)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT id,name,kind,category,amount,enabled,note,
                            sched_type,sched_start,sched_end,sched_day,sched_date,sched_month
                            FROM items WHERE ledger_id=$id ORDER BY sort_order, rowid;";
        cmd.Parameters.AddWithValue("$id", ledgerId);
        using var r = cmd.ExecuteReader();
        var list = new List<ItemDto>();
        while (r.Read())
        {
            list.Add(new ItemDto
            {
                Id = r.GetString(0),
                Name = r.GetString(1),
                Kind = r.GetString(2),
                Category = r.IsDBNull(3) ? null : r.GetString(3),
                Amount = r.GetDouble(4),
                Enabled = r.GetInt32(5) != 0,
                Note = r.IsDBNull(6) ? null : r.GetString(6),
                Schedule = new ScheduleDto
                {
                    Type = r.GetString(7),
                    Start = r.IsDBNull(8) ? null : r.GetString(8),
                    End = r.IsDBNull(9) ? null : r.GetString(9),
                    DayOfMonth = r.IsDBNull(10) ? null : r.GetInt32(10),
                    Date = r.IsDBNull(11) ? null : r.GetString(11),
                    Month = r.IsDBNull(12) ? null : r.GetString(12)
                }
            });
        }
        return list;
    }

    public LedgerDto CreateLedger(string name)
    {
        var l = new LedgerDto { Name = name, PeriodStart = "2026-01-01", PeriodEnd = "2026-12-31" };
        using var conn = Open();
        l.Id = InsertLedger(conn, l);
        return l;
    }

    public void RenameLedger(long id, string name)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE ledgers SET name=$n WHERE id=$id;";
        cmd.Parameters.AddWithValue("$n", name);
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    public void DeleteLedger(long id)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM ledgers WHERE id=$id;";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    public void SaveLedger(long id, string periodStart, string periodEnd, string itemsJson)
    {
        var items = JsonSerializer.Deserialize<List<ItemDto>>(itemsJson, JsonOpts) ?? new List<ItemDto>();
        using var conn = Open();
        using var tx = conn.BeginTransaction();
        using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "UPDATE ledgers SET period_start=$ps, period_end=$pe WHERE id=$id;";
            cmd.Parameters.AddWithValue("$ps", periodStart);
            cmd.Parameters.AddWithValue("$pe", periodEnd);
            cmd.Parameters.AddWithValue("$id", id);
            cmd.ExecuteNonQuery();
        }
        ReplaceItems(conn, id, items, tx);
        tx.Commit();
    }

    private static void ReplaceItems(SqliteConnection conn, long ledgerId, List<ItemDto> items, SqliteTransaction? tx = null)
    {
        using (var del = conn.CreateCommand())
        {
            del.Transaction = tx;
            del.CommandText = "DELETE FROM items WHERE ledger_id=$id;";
            del.Parameters.AddWithValue("$id", ledgerId);
            del.ExecuteNonQuery();
        }
        var order = 0;
        foreach (var it in items)
        {
            using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = @"INSERT INTO items
                (id,ledger_id,name,kind,category,amount,enabled,note,
                 sched_type,sched_start,sched_end,sched_day,sched_date,sched_month,sort_order)
                VALUES ($id,$lid,$name,$kind,$cat,$amt,$en,$note,$st,$ss,$se,$sd,$sdate,$sm,$ord);";
            cmd.Parameters.AddWithValue("$id", string.IsNullOrEmpty(it.Id) ? "it_" + Guid.NewGuid().ToString("N").Substring(0, 12) : it.Id);
            cmd.Parameters.AddWithValue("$lid", ledgerId);
            cmd.Parameters.AddWithValue("$name", it.Name ?? "");
            cmd.Parameters.AddWithValue("$kind", it.Kind ?? "expense");
            cmd.Parameters.AddWithValue("$cat", (object?)it.Category ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$amt", it.Amount);
            cmd.Parameters.AddWithValue("$en", it.Enabled ? 1 : 0);
            cmd.Parameters.AddWithValue("$note", (object?)it.Note ?? DBNull.Value);
            var s = it.Schedule ?? new ScheduleDto();
            cmd.Parameters.AddWithValue("$st", s.Type ?? "recurring");
            cmd.Parameters.AddWithValue("$ss", (object?)s.Start ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$se", (object?)s.End ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$sd", (object?)s.DayOfMonth ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$sdate", (object?)s.Date ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$sm", (object?)s.Month ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$ord", order++);
            cmd.ExecuteNonQuery();
        }
    }

    public string BuildCsv(long id)
    {
        var ledger = GetLedger(id);
        var sb = new StringBuilder();
        sb.AppendLine("账单,名称,类型,分类,金额,启用,排期方式,开始日期,结束日期,每月几号,日期,归属月份,备注");
        foreach (var it in ledger.Items ?? new List<ItemDto>())
        {
            var s = it.Schedule ?? new ScheduleDto();
            sb.AppendLine(string.Join(",",
                Csv(ledger.Name), Csv(it.Name), Csv(it.Kind), Csv(it.Category ?? ""),
                it.Amount.ToString(CultureInfo.InvariantCulture), it.Enabled ? "1" : "0",
                Csv(s.Type), Csv(s.Start ?? ""), Csv(s.End ?? ""),
                s.DayOfMonth?.ToString() ?? "", Csv(s.Date ?? ""), Csv(s.Month ?? ""), Csv(it.Note ?? "")));
        }
        return sb.ToString();
    }

    private static string Csv(string v)
    {
        if (v.Contains(',') || v.Contains('"') || v.Contains('\n'))
            return "\"" + v.Replace("\"", "\"\"") + "\"";
        return v;
    }

    /// <summary>Write a standalone .sqlite file containing only the given ledger and its items.</summary>
    public void ExportScopedDb(long id, string destPath)
    {
        var ledger = GetLedger(id);
        if (File.Exists(destPath)) File.Delete(destPath);
        var destConn = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = destPath }.ToString());
        destConn.Open();
        try
        {
            using (var cmd = destConn.CreateCommand())
            {
                cmd.CommandText = @"
CREATE TABLE ledgers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  period_start TEXT NOT NULL, period_end TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE items (
  id TEXT PRIMARY KEY, ledger_id INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  category TEXT, amount REAL NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1, note TEXT,
  sched_type TEXT NOT NULL, sched_start TEXT, sched_end TEXT, sched_day INTEGER,
  sched_date TEXT, sched_month TEXT, sort_order INTEGER DEFAULT 0);";
                cmd.ExecuteNonQuery();
            }
            var newId = InsertLedger(destConn, ledger);
            ReplaceItems(destConn, newId, ledger.Items ?? new List<ItemDto>());
        }
        finally { destConn.Close(); }
    }
}
