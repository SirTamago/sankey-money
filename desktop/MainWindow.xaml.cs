using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Microsoft.Web.WebView2.Core;

namespace SankeyMoney;

public sealed partial class MainWindow : Window
{
    private static readonly string LogPath = Path.Combine(AppContext.BaseDirectory, "app.log");
    private readonly SqliteStore _store;
    private readonly NativeBridge _bridge;

    internal static void Log(string msg)
    {
        try { File.AppendAllText(LogPath, DateTime.Now.ToString("HH:mm:ss.fff") + "  " + msg + Environment.NewLine); }
        catch { /* ignore */ }
    }

    public MainWindow()
    {
        InitializeComponent();
        Title = "收支桑基图";
        try { SystemBackdrop = new MicaBackdrop(); } catch { /* ignore */ }

        try
        {
            var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
            var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd);
            var appWindow = AppWindow.GetFromWindowId(windowId);
            appWindow.Resize(new Windows.Graphics.SizeInt32(1600, 1000));

            var tb = appWindow.TitleBar;
            var surf = Windows.UI.Color.FromArgb(255, 0x21, 0x1F, 0x26);
            var fg = Windows.UI.Color.FromArgb(255, 0xE6, 0xE0, 0xE9);
            tb.BackgroundColor = surf;
            tb.InactiveBackgroundColor = surf;
            tb.ForegroundColor = fg;
            tb.InactiveForegroundColor = fg;
            tb.ButtonBackgroundColor = Microsoft.UI.Colors.Transparent;
            tb.ButtonInactiveBackgroundColor = Microsoft.UI.Colors.Transparent;
            tb.ButtonForegroundColor = fg;
            tb.ButtonHoverBackgroundColor = Windows.UI.Color.FromArgb(40, 255, 255, 255);
            Log("window sized + titlebar themed");
        }
        catch (Exception ex) { Log("window setup failed: " + ex.Message); }

        _store = new SqliteStore();
        _bridge = new NativeBridge(_store, this);
        Log("SQLite DB = " + _store.DbPath);

        Web.Loaded += Web_Loaded;
        Log("MainWindow constructed");
    }

    private async void Web_Loaded(object sender, RoutedEventArgs e)
    {
        try
        {
            await Web.EnsureCoreWebView2Async();
            Log("CoreWebView2 ready, version=" + Web.CoreWebView2.Environment.BrowserVersionString);

            Web.CoreWebView2.WebMessageReceived += OnWebMessage;

            var wwwroot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
            Log("wwwroot=" + wwwroot + " exists=" + Directory.Exists(wwwroot));
            Web.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "app.local", wwwroot, CoreWebView2HostResourceAccessKind.Allow);

            Web.CoreWebView2.NavigationCompleted += (sender2, args) =>
            {
                Log("NavigationCompleted success=" + args.IsSuccess + " webError=" + args.WebErrorStatus);
                if (args.IsSuccess) _ = VerifyAsync();
            };

            Web.CoreWebView2.Navigate("https://app.local/index.html");
        }
        catch (Exception ex)
        {
            Log("WebView2 init FAILED: " + ex);
        }
    }

    private void OnWebMessage(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        int id = 0;
        try
        {
            using var doc = JsonDocument.Parse(args.WebMessageAsJson);
            var root = doc.RootElement;
            if (root.TryGetProperty("id", out var idEl)) id = idEl.GetInt32();
            var method = root.TryGetProperty("method", out var mEl) ? (mEl.GetString() ?? "") : "";
            var argEls = Array.Empty<JsonElement>();
            if (root.TryGetProperty("args", out var a) && a.ValueKind == JsonValueKind.Array)
                argEls = a.EnumerateArray().Select(x => x.Clone()).ToArray();

            var result = _bridge.Invoke(method, argEls);
            PostResponse(id, true, result, null);
        }
        catch (Exception ex)
        {
            Log("bridge error (id=" + id + "): " + ex.Message);
            PostResponse(id, false, null, ex.Message);
        }
    }

    private static readonly JsonSerializerOptions RespOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private void PostResponse(int id, bool ok, string? result, string? error)
    {
        var json = JsonSerializer.Serialize(new BridgeResponse { Id = id, Ok = ok, Result = result, Error = error }, RespOpts);
        Web.CoreWebView2.PostWebMessageAsString(json);
    }

    private async Task VerifyAsync()
    {
        try
        {
            await Task.Delay(1800);
            var r = await Web.CoreWebView2.ExecuteScriptAsync(
                "JSON.stringify({items:document.querySelectorAll('#itemList .item-row').length," +
                "svg:document.querySelectorAll('#sankeyChart svg').length," +
                "mdSelects:document.querySelectorAll('.md-select').length," +
                "initError:window.__initError})");
            Log("startup check: " + r);
        }
        catch (Exception ex) { Log("VerifyAsync failed: " + ex.Message); }
    }
}

public class BridgeResponse
{
    public int Id { get; set; }
    public bool Ok { get; set; }
    public string? Result { get; set; }
    public string? Error { get; set; }
}
