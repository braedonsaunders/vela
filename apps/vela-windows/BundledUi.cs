using Microsoft.Web.WebView2.Core;

namespace Vela.Windows;

/// <summary>Serve the installed web build at the app's own origin (MainWindow.AppOrigin) under /vela, with
/// the app's routes answered by index.html. Servers are reached directly from the page.</summary>
internal static class BundledUi
{
    private static readonly string Root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "ui"));

    internal static void Serve(CoreWebView2Environment environment, CoreWebView2WebResourceRequestedEventArgs request)
    {
        var url = new Uri(request.Request.Uri);
        if (url.GetLeftPart(UriPartial.Authority) != MainWindow.AppOrigin) return;
        if (request.Request.Method != "GET"
            || (url.AbsolutePath != "/vela" && !url.AbsolutePath.StartsWith("/vela/", StringComparison.Ordinal)))
        {
            request.Response = environment.CreateWebResourceResponse(new MemoryStream(), 404, "Not Found", "");
            return;
        }
        string relative = Uri.UnescapeDataString(url.AbsolutePath[5..]).TrimStart('/');
        string path = Path.GetFullPath(Path.Combine(Root, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (path != Root && !path.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        {
            request.Response = environment.CreateWebResourceResponse(new MemoryStream(), 404, "Not Found", "");
            return;
        }
        if (relative is "pwa.js" or "sw.js")
        {
            request.Response = environment.CreateWebResourceResponse(new MemoryStream(), 200, "OK",
                "Content-Type: text/javascript\r\nCache-Control: no-store");
            return;
        }
        // A missing file is a 404 here, never a request to whatever answers on this machine's port 80.
        if (!File.Exists(path) && !Path.HasExtension(relative)) path = Path.Combine(Root, "index.html");
        if (!File.Exists(path))
        {
            request.Response = environment.CreateWebResourceResponse(new MemoryStream(), 404, "Not Found", "");
            return;
        }
        // Content-addressed build output never changes under its name; everything else revalidates.
        bool immutable = relative.StartsWith("_expo/static/", StringComparison.Ordinal)
            || relative.StartsWith("assets/", StringComparison.Ordinal) || relative.StartsWith("player/", StringComparison.Ordinal);
        request.Response = environment.CreateWebResourceResponse(File.OpenRead(path), 200, "OK",
            $"Content-Type: {ContentType(path)}\r\nCache-Control: {(immutable ? "max-age=31536000, immutable" : "no-cache")}");
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
