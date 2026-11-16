using Microsoft.Web.WebView2.Core;

namespace Vela.Windows;

/// <summary>Serve the installed Expo artifact at the real server origin, keeping API and media requests native.</summary>
internal static class BundledUi
{
    private static readonly string Root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "ui"));

    internal static void Serve(CoreWebView2Environment environment, Uri server,
        CoreWebView2WebResourceRequestedEventArgs request)
    {
        var url = new Uri(request.Request.Uri);
        if (request.Request.Method != "GET" || url.GetLeftPart(UriPartial.Authority)
            != server.GetLeftPart(UriPartial.Authority)) return;
        if (url.AbsolutePath != "/vela" && !url.AbsolutePath.StartsWith("/vela/", StringComparison.Ordinal)) return;
        if (url.AbsolutePath.StartsWith("/vela/v0/", StringComparison.Ordinal)) return;
        string relative = Uri.UnescapeDataString(url.AbsolutePath[5..]).TrimStart('/');
        string path = Path.GetFullPath(Path.Combine(Root, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (path != Root && !path.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return;
        if (relative is "pwa.js" or "sw.js")
        {
            request.Response = environment.CreateWebResourceResponse(new MemoryStream(), 200, "OK",
                "Content-Type: text/javascript\r\nCache-Control: no-store");
            return;
        }
        if (!File.Exists(path))
        {
            if (Path.HasExtension(relative)) return;
            path = Path.Combine(Root, "index.html");
        }
        if (!File.Exists(path)) return;
        request.Response = environment.CreateWebResourceResponse(File.OpenRead(path), 200, "OK",
            $"Content-Type: {ContentType(path)}\r\nCache-Control: no-store");
    }

    private static string ContentType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".js" or ".mjs" => "text/javascript",
        ".css" => "text/css",
        ".json" or ".webmanifest" => "application/json",
        ".wasm" => "application/wasm",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        ".woff" => "font/woff",
        ".woff2" => "font/woff2",
        ".ttf" => "font/ttf",
        ".mp4" => "video/mp4",
        _ => "application/octet-stream"
    };
}
