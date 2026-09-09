using Microsoft.UI.Xaml;

namespace SankeyMoney;

public partial class App : Application
{
    private Window? _window;

    public App()
    {
        RequestedTheme = ApplicationTheme.Dark;
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        _window.Activate();
    }
}
