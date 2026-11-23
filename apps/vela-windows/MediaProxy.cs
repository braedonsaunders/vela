using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Vela.Windows;

/// <summary>Token-scoped streaming proxy for mpv, including HLS resources.</summary>
public sealed class MediaProxy : IDisposable
{
    private const int MaxPlaylistBytes = 2 * 1024 * 1024;
    private readonly HttpListener listener = new();
    private readonly HttpClient client = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = Timeout.InfiniteTimeSpan };
    private readonly CancellationTokenSource stopping = new();
    private readonly ConcurrentDictionary<string, Uri> resources = new();
    private readonly string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
    private readonly object accessLock = new();
    private Uri? origin;
    private string pathPrefix = "/";
    private Dictionary<string, string> headers = new(StringComparer.OrdinalIgnoreCase);
    private readonly Uri endpoint;
    private double targetDuration;

    /// <summary>The newest media playlist's EXT-X-TARGETDURATION (the live segment length), or null before one.</summary>
    public double? TargetDurationSeconds => Volatile.Read(ref targetDuration) is var value && value > 0 ? value : null;

    public MediaProxy()
    {
        // Reserve an ephemeral loopback port; HttpListener binds it immediately afterward.
        var socket = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        socket.Start();
        int port = ((IPEndPoint)socket.LocalEndpoint).Port;
        socket.Stop();
        endpoint = new Uri($"http://127.0.0.1:{port}/{token}/");
        listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        listener.Start();
        _ = AcceptAsync();
    }

    public void SetAccess(string origin, string pathPrefix, Dictionary<string, string> headers)
    {
        var uri = Validate(new Uri(origin, UriKind.Absolute));
        if (!pathPrefix.StartsWith('/')) throw new ArgumentException("Path prefix must be absolute.", nameof(pathPrefix));
        lock (accessLock)
        {
            this.origin = uri;
            this.pathPrefix = pathPrefix;
            this.headers = new Dictionary<string, string>(headers, StringComparer.OrdinalIgnoreCase);
        }
    }

    public Uri Register(string source) => Register(Validate(new Uri(source, UriKind.Absolute)));
    public Task<Uri> RegisterAsync(string source) => Task.FromResult(Register(source));

    private Uri Register(Uri source)
    {
        string id = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        resources[id] = source;
        return new Uri(endpoint, id);
    }

    private static Uri Validate(Uri uri)
    {
        if (!uri.IsAbsoluteUri || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) || !string.IsNullOrEmpty(uri.UserInfo))
            throw new ArgumentException("Only HTTP(S) URLs without user information are supported.");
        return uri;
    }

    private async Task AcceptAsync()
    {
        while (!stopping.IsCancellationRequested)
        {
            try { var context = await listener.GetContextAsync().ConfigureAwait(false); _ = ServeAsync(context); }
            catch (Exception) when (stopping.IsCancellationRequested) { break; }
            catch (HttpListenerException) { break; }
        }
    }

    private bool Scoped(Uri uri)
    {
        lock (accessLock)
            return origin != null && uri.Scheme == origin.Scheme && uri.IdnHost == origin.IdnHost && uri.Port == origin.Port &&
                (pathPrefix == "/" || uri.AbsolutePath.Equals(pathPrefix.TrimEnd('/'), StringComparison.Ordinal) || uri.AbsolutePath.StartsWith(pathPrefix.TrimEnd('/') + "/", StringComparison.Ordinal));
    }

    private async Task ServeAsync(HttpListenerContext context)
    {
        try
        {
            var request = context.Request;
            string[] parts = request.Url!.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if ((request.HttpMethod != "GET" && request.HttpMethod != "HEAD") || parts.Length != 2 || parts[0] != token || !resources.TryGetValue(parts[1], out var target))
            { context.Response.StatusCode = 404; return; }
            HttpResponseMessage? upstream = null;
            try
            {
                for (int redirects = 0; ; redirects++)
                {
                    using var outgoing = new HttpRequestMessage(new HttpMethod(request.HttpMethod), target);
                    if (request.Headers["Range"] is string range) outgoing.Headers.TryAddWithoutValidation("Range", range);
                    if (request.Headers["If-Range"] is string ifRange) outgoing.Headers.TryAddWithoutValidation("If-Range", ifRange);
                    lock (accessLock)
                        if (Scoped(target)) foreach (var pair in headers) outgoing.Headers.TryAddWithoutValidation(pair.Key, pair.Value);
                    upstream = await client.SendAsync(outgoing, HttpCompletionOption.ResponseHeadersRead, stopping.Token).ConfigureAwait(false);
                    if ((int)upstream.StatusCode < 300 || (int)upstream.StatusCode >= 400 || upstream.Headers.Location == null) break;
                    if (redirects >= 5) throw new HttpRequestException("Too many redirects.");
                    var next = Validate(new Uri(target, upstream.Headers.Location));
                    // Never follow redirects to local services on a different origin.
                    if (!Scoped(next) && (next.IsLoopback || IPAddress.TryParse(next.Host, out var ip) && (IPAddress.IsLoopback(ip) || ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || (ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && (ip.GetAddressBytes()[0] == 10 || ip.GetAddressBytes()[0] == 127 || ip.GetAddressBytes()[0] == 192 && ip.GetAddressBytes()[1] == 168 || ip.GetAddressBytes()[0] == 172 && ip.GetAddressBytes()[1] >= 16 && ip.GetAddressBytes()[1] <= 31 || ip.GetAddressBytes()[0] == 169 && ip.GetAddressBytes()[1] == 254))))) throw new HttpRequestException("Invalid redirect.");
                    upstream.Dispose(); upstream = null; target = next;
                }
                var response = context.Response;
                response.StatusCode = (int)upstream.StatusCode;
                foreach (string name in new[] { "Accept-Ranges", "Content-Range", "ETag", "Last-Modified" })
                    if (upstream.Headers.TryGetValues(name, out var values) || upstream.Content.Headers.TryGetValues(name, out values)) response.Headers[name] = string.Join(", ", values);
                string? contentType = upstream.Content.Headers.ContentType?.ToString();
                if (contentType != null) response.ContentType = contentType;
                bool playlist = request.HttpMethod == "GET" && upstream.IsSuccessStatusCode && (target.AbsolutePath.EndsWith(".m3u8", StringComparison.OrdinalIgnoreCase) || contentType?.Contains("mpegurl", StringComparison.OrdinalIgnoreCase) == true);
                if (playlist)
                {
                    using var input = await upstream.Content.ReadAsStreamAsync(stopping.Token).ConfigureAwait(false);
                    using var buffer = new MemoryStream();
                    byte[] chunk = new byte[8192]; int read;
                    while ((read = await input.ReadAsync(chunk, stopping.Token).ConfigureAwait(false)) != 0) { if (buffer.Length + read > MaxPlaylistBytes) throw new HttpRequestException("Playlist too large."); buffer.Write(chunk, 0, read); }
                    string text = Encoding.UTF8.GetString(buffer.ToArray());
                    var duration = Regex.Match(text, @"(?m)^#EXT-X-TARGETDURATION:\s*(\d+(?:\.\d+)?)\s*$");
                    if (duration.Success && double.TryParse(duration.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var seconds) && seconds > 0 && seconds <= 60)
                        Volatile.Write(ref targetDuration, seconds);
                    string rewritten = Regex.Replace(text, @"(?m)^(?!#)([^\r\n]+)|URI=""([^""]+)""", match =>
                    {
                        string value = match.Groups[1].Success ? match.Groups[1].Value.Trim() : match.Groups[2].Value;
                        try { string url = Register(Validate(new Uri(target, value))).ToString(); return match.Groups[1].Success ? url : "URI=\"" + url + "\""; }
                        catch (ArgumentException) { return match.Groups[1].Success ? "" : "URI=\"\""; }
                    });
                    byte[] bytes = Encoding.UTF8.GetBytes(rewritten); response.ContentLength64 = bytes.Length;
                    await response.OutputStream.WriteAsync(bytes, stopping.Token).ConfigureAwait(false);
                }
                else
                {
                    if (upstream.Content.Headers.ContentLength is long length) response.ContentLength64 = length;
                    if (request.HttpMethod != "HEAD") await upstream.Content.CopyToAsync(response.OutputStream, stopping.Token).ConfigureAwait(false);
                }
            }
            finally { upstream?.Dispose(); }
        }
        catch (Exception) { try { context.Response.StatusCode = 502; } catch { } }
        finally { try { context.Response.Close(); } catch { } }
    }

    public void Dispose()
    {
        stopping.Cancel(); listener.Close(); client.Dispose(); stopping.Dispose();
    }
}
