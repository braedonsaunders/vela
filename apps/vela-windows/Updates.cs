using System.Net.Http.Headers;
using System.Reflection;
using System.Text.Json;

namespace Vela.Windows;

/// <summary>
/// Vela updates itself from its own GitHub releases, independent of any server. At most twice a day
/// it reads the latest release; when that is newer and carries a Windows installer, the viewer is
/// asked, the installer is downloaded over HTTPS and run quietly, and Vela closes so it can be replaced.
/// </summary>
internal static class Updates
{
    private const string Latest = "https://api.github.com/repos/braedonsaunders/vela/releases/latest";
    private static readonly TimeSpan Interval = TimeSpan.FromHours(12);

    internal static async Task CheckAsync(Form owner)
    {
        if (Environment.GetEnvironmentVariable("VELA_NO_UPDATE_CHECK") == "1") return;
        try
        {
            var current = CurrentVersion();
            if (current == null) return;
            string stamp = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Vela", "update-check.txt");
            if (File.Exists(stamp) && DateTime.UtcNow - File.GetLastWriteTimeUtc(stamp) < Interval) return;
            Directory.CreateDirectory(Path.GetDirectoryName(stamp)!);
            File.WriteAllText(stamp, DateTime.UtcNow.ToString("O"));

            using var http = Client();
            using var document = JsonDocument.Parse(await http.GetStringAsync(Latest));
            var release = document.RootElement;
            var tag = release.GetProperty("tag_name").GetString() ?? "";
            if (!Version.TryParse(tag.TrimStart('v'), out var latest) || latest <= current) return;
            string? installer = null, name = null;
            foreach (var asset in release.GetProperty("assets").EnumerateArray())
            {
                name = asset.GetProperty("name").GetString();
                if (name != null && name.StartsWith("Vela-Setup-", StringComparison.Ordinal) && name.EndsWith("-x64.exe", StringComparison.Ordinal))
                {
                    installer = asset.GetProperty("browser_download_url").GetString();
                    break;
                }
            }
            if (installer == null || !installer.StartsWith("https://github.com/braedonsaunders/vela/releases/download/", StringComparison.Ordinal)) return;

            var answer = MessageBox.Show(owner, $"Vela {latest} is available (you have {current}).\n\nInstall it now? Vela will close and reopen when the update is done.",
                "Update Vela", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
            if (answer != DialogResult.Yes) return;

            string file = Path.Combine(Path.GetTempPath(), name!);
            await using (var source = await http.GetStreamAsync(installer))
            await using (var target = File.Create(file))
                await source.CopyToAsync(target);
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(file,
                "/SILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS") { UseShellExecute = true });
            owner.Close();
        }
        catch (Exception)
        {
            // Offline, rate-limited or no release yet: try again next time.
        }
    }

    private static Version? CurrentVersion()
    {
        string? text = Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        text = text?.Split('+')[0];
        return Version.TryParse(text, out var version) && version > new Version(0, 0, 0) ? version : null;
    }

    private static HttpClient Client()
    {
        var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Vela", CurrentVersion()?.ToString() ?? "0"));
        http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        return http;
    }
}
