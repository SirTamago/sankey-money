using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;

namespace SankeyMoney;

/// <summary>Request/response bridge between the WebView2 page and the SQLite store.
/// Called via postMessage (no COM host object needed).</summary>
public class NativeBridge
{
    private readonly SqliteStore _store;
    private readonly Window _window;

    public NativeBridge(SqliteStore store, Window window)
    {
        _store = store;
        _window = window;
    }

    public string Invoke(string method, JsonElement[] args)
    {
        switch (method)
        {
            case "ListLedgers": return _store.Serialize(_store.ListLedgers());
            case "GetLedger": return _store.Serialize(_store.GetLedger(GetLong(args, 0)));
            case "CreateLedger": return _store.Serialize(_store.CreateLedger(GetStr(args, 0)));
            case "RenameLedger": _store.RenameLedger(GetLong(args, 0), GetStr(args, 1)); return "{}";
            case "DeleteLedger": _store.DeleteLedger(GetLong(args, 0)); return "{}";
            case "SaveLedger": _store.SaveLedger(GetLong(args, 0), GetStr(args, 1), GetStr(args, 2), GetStr(args, 3)); return "{}";
            case "ExportCsv": return ExportCsv(GetLong(args, 0));
            case "ExportSqlite": return ExportSqlite(GetLong(args, 0));
            case "DbPath": return _store.DbPath;
            case "Log": MainWindow.Log("[web] " + GetStr(args, 0)); return "{}";
            case "WindowDrag": return WindowDrag();
            case "WindowMinimize": return WindowMinimize();
            case "WindowMaximizeToggle": return WindowMaximizeToggle();
            case "WindowClose": _window.Close(); return "{}";
            default: throw new InvalidOperationException("unknown method: " + method);
        }
    }

    private AppWindow AppWin()
    {
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(_window);
        return AppWindow.GetFromWindowId(Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd));
    }

    private const int WM_NCLBUTTONDOWN = 0xA1;
    private const int HTCAPTION = 0x2;
    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    private string WindowDrag()
    {
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(_window);
        ReleaseCapture();
        SendMessage(hwnd, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
        return "{}";
    }

    private string WindowMinimize()
    {
        (AppWin().Presenter as OverlappedPresenter)?.Minimize();
        return "{}";
    }

    private string WindowMaximizeToggle()
    {
        if (AppWin().Presenter is OverlappedPresenter p)
        {
            if (p.State == OverlappedPresenterState.Maximized) p.Restore();
            else p.Maximize();
        }
        return "{}";
    }


    private string ExportCsv(long id)
    {
        var ledger = _store.GetLedger(id);
        var path = BuildExportPath(ledger.Name, ".csv");
        File.WriteAllText(path, _store.BuildCsv(id), new UTF8Encoding(true));
        return "saved:" + path;
    }

    private string ExportSqlite(long id)
    {
        var ledger = _store.GetLedger(id);
        var path = BuildExportPath(ledger.Name, ".sqlite");
        _store.ExportScopedDb(id, path);
        return "saved:" + path;
    }

    private static string BuildExportPath(string ledgerName, string ext)
    {
        var dir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir))
            dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "SankeyMoney");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, Sanitize(ledgerName) + "-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ext);
    }

    private static string Sanitize(string name)
    {
        foreach (var c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
        return string.IsNullOrWhiteSpace(name) ? "ledger" : name;
    }

    private static long GetLong(JsonElement[] args, int i)
    {
        if (args.Length <= i) return 0;
        var e = args[i];
        if (e.ValueKind == JsonValueKind.Number) return e.GetInt64();
        if (e.ValueKind == JsonValueKind.String && long.TryParse(e.GetString(), out var v)) return v;
        return 0;
    }
    private static string GetStr(JsonElement[] args, int i)
        => args.Length > i && args[i].ValueKind == JsonValueKind.String ? args[i].GetString() ?? "" : "";
}
