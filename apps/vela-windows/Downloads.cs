using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;

namespace Vela.Windows;

/// <summary>
/// Offline downloads for the Windows app (docs/downloads.md, "Windows (WebView2)"): the shell side of
/// the page's DownloadsPort (apps/vela/src/data/downloads-shell.ts) over <c>downloads-*</c> web messages.
/// Files live under <c>vela-downloads\&lt;server&gt;\&lt;viewer&gt;\&lt;title&gt;\</c> in the app's data folder:
/// the original (<c>media.&lt;ext&gt;</c>, written as <c>.part</c> and renamed when verified), its poster and
/// text sidecars. The page keeps the index logic; this class writes <c>index.json</c>/<c>outbox.json</c>
/// atomically, transfers one title at a time, serves <c>http://vela.localhost/vela-downloads/…</c> and maps
/// those URLs back to validated paths for mpv. Credential headers live in memory only, go to the
/// request's exact origin only, and never reach a path, log, error or event.
/// </summary>
internal sealed class Downloads : IDisposable
{
    /// <summary>The bridge methods (DESKTOP_DOWNLOAD_METHODS in downloads-shell.ts).</summary>
    internal static readonly string[] Methods =
    [
        "readSnapshot", "writeSnapshot", "freeBytes", "startTransfer", "pauseTransfer", "resumeTransfer",
        "removeTitle", "removeViewer", "removeServer", "reveal", "exportCopy",
    ];

    private const int MaxRedirects = 5;
    private const int MaxAuxiliaryBytes = 20 * 1024 * 1024;
    private static readonly TimeSpan HeadersTimeout = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan ReadTimeout = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan ProgressInterval = TimeSpan.FromMilliseconds(250);
    private static readonly HashSet<string> RefusedHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "Host", "Range", "If-Range", "Content-Length", "Transfer-Encoding", "Connection", "Accept-Encoding", "Cookie", "Expect", "Upgrade", "TE",
    };

    private readonly string root;
    private readonly Action<Dictionary<string, object?>> emit;
    private readonly Func<string, string, Task<string?>> pickSaveTarget;
    private readonly HttpClient client = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false, UseCookies = false, AutomaticDecompression = DecompressionMethods.None,
        ConnectTimeout = TimeSpan.FromSeconds(20), PooledConnectionLifetime = TimeSpan.FromMinutes(5),
        ConnectCallback = ConnectAsync,
    }) { Timeout = Timeout.InfiniteTimeSpan };
    private readonly object gate = new();
    private readonly object files = new();
    private readonly Dictionary<string, Transfer> transfers = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim queue = new(1, 1);
    private readonly CancellationTokenSource shutdown = new();

    private sealed record Sidecar(string TrackId, string Format, Uri Url);

    private sealed record Request(string ServerId, string ViewerId, string TitleId, Uri Url, Dictionary<string, string> Headers,
        string Container, long? ByteLength, string? Etag, Uri? Poster, IReadOnlyList<Sidecar> Sidecars)
    {
        public string Key => $"{ServerId}/{ViewerId}/{TitleId}";
    }

    private enum StopReason { None, Pause, Remove, Replace }

    private sealed class Transfer(Request request, CancellationTokenSource cancel)
    {
        public Request Request { get; } = request;
        public CancellationTokenSource Cancel { get; } = cancel;
        public StopReason Reason;
        public bool Finishing;
        public Task Task = Task.CompletedTask;
    }

    /// <summary>A transfer that cannot continue: an iOS error code and a message without URLs or headers.</summary>
    private sealed class TransferError(string code, string message, long? needed = null) : Exception(message)
    {
        public string Code { get; } = code;
        public long? Needed { get; } = needed;
    }

    /// <summary>The network dropped or stalled: retried, then reported paused/interrupted.</summary>
    private sealed class TransientError : Exception { }

    /// <summary>What a resumable partial file was fetched against (no URL or header is ever stored).</summary>
    private sealed record PartInfo(string Container, string? Etag, string? LastModified, long? Total);

    internal Downloads(string folder, Action<Dictionary<string, object?>> emit, Func<string, string, Task<string?>> pickSaveTarget)
    {
        Directory.CreateDirectory(folder);
        root = DownloadPaths.ResolveRoot(folder);
        this.emit = emit;
        this.pickSaveTarget = pickSaveTarget;
    }

    internal string Root => root;

    // ---- Bridge calls ----------------------------------------------------------------------------

    /// <summary>One bridge call with already-cloned arguments. Throws ArgumentException/InvalidOperationException
    /// with messages fit for the page; anything else is reported generically by the caller.</summary>
    internal async Task<object?> Call(string method, JsonElement args)
    {
        JsonElement Arg(int i) => args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > i ? args[i] : default;
        string Id(int i) => Arg(i).ValueKind == JsonValueKind.String && Arg(i).GetString() is string s && DownloadPaths.SafeId(s)
            ? s : throw new ArgumentException("Invalid download identifier");
        switch (method)
        {
            case "readSnapshot": return await Task.Run(ReadSnapshot);
            case "writeSnapshot":
            {
                var snapshot = Arg(0);
                await Task.Run(() => WriteSnapshot(snapshot));
                return null;
            }
            case "freeBytes": return FreeBytes();
            case "startTransfer": Launch(ParseRequest(Arg(0)), resume: false); return null;
            case "resumeTransfer": Launch(ParseRequest(Arg(0)), resume: true); return null;
            case "pauseTransfer": await Pause($"{Id(0)}/{Id(1)}/{Id(2)}"); return null;
            case "removeTitle": await Remove($"{Id(0)}/{Id(1)}/{Id(2)}", exact: true, Id(0), Id(1), Id(2)); return null;
            case "removeViewer": await Remove($"{Id(0)}/{Id(1)}/", exact: false, Id(0), Id(1)); return null;
            case "removeServer": await Remove($"{Id(0)}/", exact: false, Id(0)); return null;
            case "reveal": Reveal(Id(0), Id(1), Id(2)); return null;
            case "exportCopy":
                return await ExportCopy(Id(0), Id(1), Id(2), Arg(3).ValueKind == JsonValueKind.String ? Arg(3).GetString() : null);
            default: throw new ArgumentException("Unknown downloads method");
        }
    }

    private Request ParseRequest(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new ArgumentException("Invalid download transfer request");
        string Id(string name) => Text(value, name) is string s && DownloadPaths.SafeId(s) ? s : throw new ArgumentException("Invalid download transfer request");
        var url = DownloadPaths.HttpUrl(Text(value, "url")) ?? throw new ArgumentException("Invalid download transfer request");
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (value.TryGetProperty("headers", out var rawHeaders) && rawHeaders.ValueKind == JsonValueKind.Object)
            foreach (var header in rawHeaders.EnumerateObject())
            {
                if (header.Value.ValueKind != JsonValueKind.String || !Token(header.Name) || RefusedHeaders.Contains(header.Name)) continue;
                string text = header.Value.GetString() ?? "";
                if (text.Length > 8192 || text.Any(c => c is '\r' or '\n' or '\0')) throw new ArgumentException("Invalid download transfer request");
                headers[header.Name] = text;
            }
        long? byteLength = value.TryGetProperty("byteLength", out var length) && length.ValueKind == JsonValueKind.Number
            && length.TryGetInt64(out long n) && n > 0 ? n : null;
        string? etag = Text(value, "etag") is { Length: > 0 and <= 1024 } tag && !tag.Any(c => c is '\r' or '\n' or '\0') ? tag : null;
        var sidecars = new List<Sidecar>();
        if (value.TryGetProperty("sidecars", out var rawSidecars) && rawSidecars.ValueKind == JsonValueKind.Array)
            foreach (var item in rawSidecars.EnumerateArray().Take(64))
                if (Text(item, "trackId") is string trackId && DownloadPaths.SafeId(trackId) && DownloadPaths.HttpUrl(Text(item, "url")) is Uri sidecarUrl)
                    sidecars.Add(new(trackId, DownloadPaths.Extension(Text(item, "format"), "vtt"), sidecarUrl));
        return new Request(Id("serverId"), Id("viewerId"), Id("titleId"), url, headers,
            DownloadPaths.Extension(Text(value, "container"), "mp4"), byteLength, etag,
            DownloadPaths.HttpUrl(Text(value, "posterUrl")), sidecars);
    }

    private static bool Token(string name) => name.Length is > 0 and <= 128
        && name.All(c => c is (>= 'a' and <= 'z') or (>= 'A' and <= 'Z') or (>= '0' and <= '9') || "!#$%&'*+-.^_`|~".Contains(c));

    private static string? Text(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    // ---- Paths -------------------------------------------------------------------------------------

    private string[] Segments(params string[] ids) => ids.Select(DownloadPaths.DiskName).ToArray();

    /// <summary>A server, viewer or title directory under the root, validated and free of links; null otherwise.</summary>
    private string? StoredDirectory(params string[] ids)
    {
        string? path = DownloadPaths.Join(root, Segments(ids));
        return path != null && DownloadPaths.Contained(root, path) ? path : null;
    }

    private string Relative(Request r, params string[] rest) =>
        string.Join('/', Segments(r.ServerId, r.ViewerId, r.TitleId).Concat(rest));

    /// <summary>The verified original in a title directory (never the partial file).</summary>
    private string? MediaFile(string serverId, string viewerId, string titleId)
    {
        string? dir = StoredDirectory(serverId, viewerId, titleId);
        if (dir == null || !Directory.Exists(dir)) return null;
        return Directory.EnumerateFiles(dir, "media.*")
            .Where(f => Path.GetExtension(f) is { Length: > 1 } ext && ext != ".part" && DownloadPaths.Contained(root, f))
            .OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault();
    }

    /// <summary>The validated stored file a local URL (<c>http://vela.localhost/vela-downloads/…</c>) names, or null.
    /// The page's index files and partial downloads are never served.</summary>
    internal string? LocalFile(string url) => DownloadPaths.LocalUrlPath(url) is string path ? StoredFile(path) : null;

    /// <summary>The validated stored file a <c>/vela-downloads/…</c> URL path names, or null.</summary>
    private string? StoredFile(string rawPath)
    {
        if (DownloadPaths.RouteSegments(rawPath) is not { Length: >= 4 } segments) return null;
        string name = segments[^1].ToLowerInvariant();
        if (name.EndsWith(".part") || name.EndsWith(".json") || name.EndsWith(".tmp")) return null;
        string? path = DownloadPaths.Join(root, segments);
        return path != null && DownloadPaths.Contained(root, path) && File.Exists(path) ? path : null;
    }

    // ---- Index -------------------------------------------------------------------------------------

    private object ReadSnapshot()
    {
        JsonArray items, outbox;
        lock (files)
        {
            items = ReadArray(Path.Combine(root, "index.json"));
            outbox = ReadArray(Path.Combine(root, "outbox.json"));
        }
        foreach (var node in items)
        {
            if (node is not JsonObject item) continue;
            string? serverId = Str(item, "serverId"), viewerId = Str(item, "viewerId"), titleId = Str(item, "titleId");
            if (!DownloadPaths.SafeId(serverId) || !DownloadPaths.SafeId(viewerId) || !DownloadPaths.SafeId(titleId)) continue;
            string? dir = StoredDirectory(serverId!, viewerId!, titleId!);
            // A terminal event the page may not have stored before Vela closed (completion, failure, pause).
            if (dir != null && ReadObject(Path.Combine(dir, "transfer-status.json")) is JsonObject status)
            {
                foreach (var pair in status) item[pair.Key] = pair.Value?.DeepClone();
                foreach (string key in new[] { "error", "errorCode", "neededBytes" })
                    if (!status.ContainsKey(key)) item.Remove(key);
                if (Str(status, "status") == "completed") item.Remove("previousCompleted");
            }
            bool live;
            lock (gate) live = transfers.ContainsKey($"{serverId}/{viewerId}/{titleId}");
            if (Str(item, "status") is "queued" or "downloading" && !live)
            {
                item["status"] = "paused";
                item["errorCode"] = "interrupted";
                item["error"] = "The download stopped when Vela closed.";
                item.Remove("neededBytes");
                string container = DownloadPaths.Extension(Str(item, "container"), "mp4");
                if (dir != null && new FileInfo(Path.Combine(dir, $"media.{container}.part")) is { Exists: true } part)
                    item["bytesWritten"] = part.Length;
            }
        }
        return new { items, outbox };
    }

    private void WriteSnapshot(JsonElement snapshot)
    {
        if (snapshot.ValueKind != JsonValueKind.Object) throw new ArgumentException("Invalid downloads snapshot");
        string ArrayText(string name) => snapshot.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array
            ? value.GetRawText() : "[]";
        lock (files)
        {
            WriteAtomically(Path.Combine(root, "index.json"), ArrayText("items"));
            WriteAtomically(Path.Combine(root, "outbox.json"), ArrayText("outbox"));
        }
    }

    /// <summary>Write beside the target, flush to disk, then swap it in with File.Replace (a rename when new).</summary>
    private static void WriteAtomically(string target, string json)
    {
        string temp = target + ".tmp";
        using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            stream.Write(Encoding.UTF8.GetBytes(json));
            stream.Flush(flushToDisk: true);
        }
        if (File.Exists(target)) File.Replace(temp, target, null, ignoreMetadataErrors: true);
        else File.Move(temp, target);
    }

    private static JsonArray ReadArray(string path)
    {
        try { return JsonNode.Parse(File.ReadAllText(path)) as JsonArray ?? new JsonArray(); }
        catch (Exception) { return new JsonArray(); }
    }

    private static JsonObject? ReadObject(string path)
    {
        try { return File.Exists(path) ? JsonNode.Parse(File.ReadAllText(path)) as JsonObject : null; }
        catch (Exception) { return null; }
    }

    private static string? Str(JsonObject item, string name) =>
        item.TryGetPropertyValue(name, out var value) && value is JsonValue v && v.TryGetValue(out string? s) ? s : null;

    private long? FreeBytes()
    {
        try { return new DriveInfo(Path.GetPathRoot(root)!).AvailableFreeSpace; }
        catch (Exception) { return null; }
    }

    // ---- Transfers ---------------------------------------------------------------------------------

    private void Launch(Request request, bool resume)
    {
        var transfer = new Transfer(request, CancellationTokenSource.CreateLinkedTokenSource(shutdown.Token));
        Transfer? previous;
        lock (gate)
        {
            transfers.TryGetValue(request.Key, out previous);
            transfers[request.Key] = transfer;
            if (previous != null) previous.Reason = StopReason.Replace;
        }
        if (previous != null) Cancel(previous);
        transfer.Task = Task.Run(() => RunAsync(transfer, previous?.Task, resume));
    }

    private static void Cancel(Transfer transfer)
    {
        try { transfer.Cancel.Cancel(); } catch (ObjectDisposedException) { }
    }

    private async Task RunAsync(Transfer transfer, Task? previous, bool resume)
    {
        var r = transfer.Request;
        var token = transfer.Cancel.Token;
        string? dir = null;
        try
        {
            if (previous != null) await previous.ContinueWith(_ => { }, TaskScheduler.Default).ConfigureAwait(false);
            dir = StoredDirectory(r.ServerId, r.ViewerId, r.TitleId) ?? throw new TransferError("unknown", "Could not prepare the download folder");
            Directory.CreateDirectory(dir);
            if (!DownloadPaths.Contained(root, dir)) throw new TransferError("unknown", "Could not prepare the download folder");
            TryDelete(Path.Combine(dir, "transfer-status.json"));
            if (!resume)
            {
                TryDelete(Path.Combine(dir, $"media.{r.Container}.part"));
                TryDelete(Path.Combine(dir, "part.json"));
            }
            await queue.WaitAsync(token).ConfigureAwait(false);
            try
            {
                for (int attempt = 0; ; attempt++)
                {
                    try
                    {
                        await TransferOnceAsync(transfer, dir, token).ConfigureAwait(false);
                        break;
                    }
                    catch (TransientError) when (attempt < 5 && !token.IsCancellationRequested)
                    {
                        // Transient network trouble backs off 2 s to 32 s before Vela gives up for now.
                        await Task.Delay(TimeSpan.FromSeconds(2 << attempt), token).ConfigureAwait(false);
                    }
                }
            }
            finally { queue.Release(); }
        }
        catch (Exception) when (token.IsCancellationRequested)
        {
            // Closing the app reports nothing: the next launch reads the record as interrupted.
            if (transfer.Reason == StopReason.Pause && dir != null) Emit(r, "paused", PartLength(dir, r));
        }
        catch (TransientError)
        {
            Emit(r, "paused", dir == null ? 0 : PartLength(dir, r), extra: new()
            {
                ["errorCode"] = "interrupted", ["error"] = "The connection dropped before the download finished.",
            });
        }
        catch (TransferError error)
        {
            if (Stopped(transfer)) return;
            var extra = new Dictionary<string, object?> { ["errorCode"] = error.Code, ["error"] = error.Message };
            if (error.Needed is long needed && needed > 0) extra["neededBytes"] = needed;
            Emit(r, "failed", dir == null ? 0 : PartLength(dir, r), r.ByteLength, extra);
        }
        catch (Exception error)
        {
            if (Stopped(transfer)) return;
            Emit(r, "failed", dir == null ? 0 : PartLength(dir, r), r.ByteLength, new()
            {
                ["errorCode"] = "unknown", ["error"] = $"The download failed ({error.GetType().Name}).",
            });
        }
        finally
        {
            lock (gate)
                if (transfers.TryGetValue(r.Key, out var current) && current == transfer) transfers.Remove(r.Key);
            transfer.Cancel.Dispose();
        }
    }

    private static bool Stopped(Transfer transfer) => transfer.Reason is StopReason.Remove or StopReason.Replace;

    private static long PartLength(string dir, Request r)
    {
        try { return new FileInfo(Path.Combine(dir, $"media.{r.Container}.part")) is { Exists: true } part ? part.Length : 0; }
        catch (Exception) { return 0; }
    }

    private async Task TransferOnceAsync(Transfer transfer, string dir, CancellationToken token)
    {
        var r = transfer.Request;
        string part = Path.Combine(dir, $"media.{r.Container}.part");
        string infoPath = Path.Combine(dir, "part.json");
        var info = ReadPartInfo(infoPath);
        long have = File.Exists(part) ? new FileInfo(part).Length : 0;
        // Resume only against the same file: its entity tag (or date) pins the bytes already on disk.
        bool sameFile = info == null || info.Container == r.Container
            && (r.ByteLength == null || info.Total == null || info.Total == r.ByteLength)
            && (r.Etag == null || info.Etag == null || DownloadPaths.SameEtag(r.Etag, info.Etag));
        string? validator = r.Etag ?? info?.Etag ?? info?.LastModified;
        if (have > 0 && (!sameFile || validator == null))
        {
            TryDelete(part);
            have = 0;
        }

        using var response = await SendAsync(r.Url, r, have > 0 ? (have, validator) : null, token).ConfigureAwait(false);
        int status = (int)response.StatusCode;
        string? contentRange = response.Content.Headers.TryGetValues("Content-Range", out var ranges) ? ranges.FirstOrDefault() : null;
        if (status == 416 && have > 0)
        {
            // Everything was already here when Vela stopped: finish without fetching again.
            if (DownloadPaths.ContentRangeTotal(contentRange) == have && (r.ByteLength == null || r.ByteLength == have))
            {
                await FinishAsync(transfer, dir, part, have, info?.Etag ?? r.Etag, info?.LastModified, token).ConfigureAwait(false);
                return;
            }
            TryDelete(part);
            TryDelete(infoPath);
            throw new TransientError();
        }
        if (status is 401 or 403) throw new TransferError("forbidden", "Downloads are not allowed for this title or account");
        if (status == 429) throw new TransferError("rate_limited", "Download limit reached; please try again later");
        if (status is 502 or 503 or 504) throw new TransientError();
        if (status is not (200 or 206)) throw new TransferError("network", $"Server answered with HTTP {status}");

        string? etag = response.Headers.ETag?.ToString();
        string? lastModified = response.Content.Headers.LastModified?.ToString("R");
        if (r.Etag != null && etag != null && !DownloadPaths.SameEtag(r.Etag, etag))
        {
            TryDelete(part);
            TryDelete(infoPath);
            throw new TransferError("corrupt", "The original file changed. Retry to get a fresh download.");
        }
        long offset = 0;
        if (status == 206)
        {
            if (DownloadPaths.ContentRangeStart(contentRange) != have)
            {
                TryDelete(part);
                TryDelete(infoPath);
                throw new TransferError("corrupt", "The server returned a different file range. Retry the download.");
            }
            offset = have;
        }
        long? total = r.ByteLength ?? DownloadPaths.ContentRangeTotal(contentRange)
            ?? (response.Content.Headers.ContentLength is long length ? length + offset : null);
        // A 206 may omit validators: keep the ones the earlier bytes were fetched against.
        etag ??= r.Etag ?? (status == 206 ? info?.Etag : null);
        lastModified ??= status == 206 ? info?.LastModified : null;
        WritePartInfo(infoPath, new PartInfo(r.Container, etag, lastModified, total));
        if (total is long size && FreeBytes() is long free && size - offset > free)
            throw new TransferError("no_space", "Not enough free storage space to finish downloading", size - offset - free);

        long written = offset;
        Emit(r, "downloading", written, total);
        var clock = Stopwatch.StartNew();
        var buffer = new byte[256 * 1024];
        await using (var input = await response.Content.ReadAsStreamAsync(token).ConfigureAwait(false))
        await using (var output = OpenPart(part, status == 206, total is long t ? t - written : null))
        {
            for (;;)
            {
                int read;
                using (var idle = CancellationTokenSource.CreateLinkedTokenSource(token))
                {
                    idle.CancelAfter(ReadTimeout);
                    try { read = await input.ReadAsync(buffer, idle.Token).ConfigureAwait(false); }
                    catch (OperationCanceledException) when (!token.IsCancellationRequested) { throw new TransientError(); }
                    catch (Exception e) when (e is IOException or HttpRequestException && !token.IsCancellationRequested) { throw new TransientError(); }
                }
                if (read == 0) break;
                if (total is long cap && written + read > cap)
                {
                    await output.DisposeAsync().ConfigureAwait(false);
                    TryDelete(part);
                    TryDelete(infoPath);
                    throw new TransferError("corrupt", "The server sent more data than the file holds. Retry the download.");
                }
                try { await output.WriteAsync(buffer.AsMemory(0, read), token).ConfigureAwait(false); }
                catch (IOException e) { throw DiskError(e, total is long cap2 ? cap2 - written : null); }
                written += read;
                if (clock.Elapsed >= ProgressInterval)
                {
                    clock.Restart();
                    Emit(r, "downloading", written, total);
                }
            }
            try { await output.FlushAsync(token).ConfigureAwait(false); output.Flush(flushToDisk: true); }
            catch (IOException e) { throw DiskError(e, null); }
        }
        if (total is long expected && written < expected) throw new TransientError();
        if (written <= 0) throw new TransferError("corrupt", "The downloaded file was empty");
        await FinishAsync(transfer, dir, part, written, etag, lastModified, token).ConfigureAwait(false);
    }

    private static FileStream OpenPart(string part, bool append, long? remaining)
    {
        try
        {
            return new FileStream(part, append ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.Read,
                1 << 16, FileOptions.Asynchronous | FileOptions.SequentialScan);
        }
        catch (IOException e) { throw DiskError(e, remaining); }
    }

    /// <summary>ERROR_DISK_FULL (112) and ERROR_HANDLE_DISK_FULL (39) are <c>no_space</c>; other write failures are <c>unknown</c>.</summary>
    private static TransferError DiskError(IOException error, long? remaining) => (error.HResult & 0xFFFF) is 112 or 39
        ? new TransferError("no_space", "Not enough free storage space to finish downloading", remaining is long n && n > 0 ? n : null)
        : new TransferError("unknown", "Could not save the downloaded file to disk");

    private async Task FinishAsync(Transfer transfer, string dir, string part, long written, string? etag, string? lastModified, CancellationToken token)
    {
        var r = transfer.Request;
        lock (gate)
        {
            token.ThrowIfCancellationRequested();
            // The original is complete: a pause from here on would only lose it.
            transfer.Finishing = true;
        }
        string final = Path.Combine(dir, $"media.{r.Container}");
        try { File.Move(part, final, overwrite: true); }
        catch (IOException e) { throw DiskError(e, null); }
        TryDelete(Path.Combine(dir, "part.json"));
        string? poster = await FetchPosterAsync(r, dir, token).ConfigureAwait(false);
        var sidecars = await FetchSidecarsAsync(r, dir, token).ConfigureAwait(false);
        if (Stopped(transfer)) return;
        var extra = new Dictionary<string, object?>
        {
            ["mediaPath"] = Relative(r, $"media.{r.Container}"),
            ["completedAt"] = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"),
        };
        if (etag != null) extra["etag"] = etag;
        if (lastModified != null) extra["lastModified"] = lastModified;
        if (poster != null) extra["posterPath"] = poster;
        if (sidecars.Count > 0) extra["sidecarPaths"] = sidecars;
        Emit(r, "completed", written, written, extra);
    }

    /// <summary>
    /// GET with the request's credentials, following redirects by hand within the original URL's exact
    /// origin only. Credentials attach only when the target is the media request's own origin; a redirect
    /// elsewhere fails the transfer before anything is sent there.
    /// </summary>
    private async Task<HttpResponseMessage> SendAsync(Uri url, Request r, (long From, string? Validator)? range, CancellationToken token)
    {
        Uri target = url;
        for (int redirects = 0; ; redirects++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, target);
            if (DownloadPaths.SameOrigin(target, r.Url))
                foreach (var pair in r.Headers) request.Headers.TryAddWithoutValidation(pair.Key, pair.Value);
            request.Headers.TryAddWithoutValidation("Accept-Encoding", "identity");
            if (range is var (from, validator))
            {
                request.Headers.TryAddWithoutValidation("Range", $"bytes={from}-");
                if (validator != null) request.Headers.TryAddWithoutValidation("If-Range", validator);
            }
            HttpResponseMessage response;
            using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(token))
            {
                timeout.CancelAfter(HeadersTimeout);
                try { response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false); }
                catch (OperationCanceledException) when (!token.IsCancellationRequested) { throw new TransientError(); }
                catch (HttpRequestException) { throw new TransientError(); }
            }
            int status = (int)response.StatusCode;
            if (status is < 300 or >= 400 || response.Headers.Location is not Uri location) return response;
            response.Dispose();
            if (redirects >= MaxRedirects) throw new TransferError("network", "The server redirected the download too many times");
            var next = new Uri(target, location);
            if (DownloadPaths.HttpUrl(next.AbsoluteUri) == null || !DownloadPaths.SameOrigin(next, url))
                throw new TransferError("network", "The server redirected the download to another address");
            target = next;
        }
    }

    /// <summary>
    /// Connect the way browsers do (Happy Eyeballs): alternate address families and start the next address
    /// 250 ms after the previous one, keeping the first that answers. A name whose first address silently
    /// drops packets (a dead IPv6 route, or "localhost" whose ::1 nobody answers) would otherwise use up
    /// the whole connect timeout before .NET tried the next address.
    /// </summary>
    private static async ValueTask<Stream> ConnectAsync(SocketsHttpConnectionContext context, CancellationToken token)
    {
        var endpoint = context.DnsEndPoint;
        IPAddress[] addresses = IPAddress.TryParse(endpoint.Host, out var literal) ? [literal]
            : await Dns.GetHostAddressesAsync(endpoint.Host, token).ConfigureAwait(false);
        var ordered = DownloadPaths.Interleave(addresses);
        if (ordered.Count == 0) throw new SocketException((int)SocketError.HostNotFound);
        using var race = CancellationTokenSource.CreateLinkedTokenSource(token);
        var attempts = ordered.Select((address, i) => Attempt(address, endpoint.Port, TimeSpan.FromMilliseconds(250 * i), race.Token)).ToList();
        Exception? failure = null;
        while (attempts.Count > 0)
        {
            var done = await Task.WhenAny(attempts).ConfigureAwait(false);
            attempts.Remove(done);
            try
            {
                var socket = await done.ConfigureAwait(false);
                race.Cancel();
                foreach (var loser in attempts)
                    _ = loser.ContinueWith(t => { if (t.IsCompletedSuccessfully) t.Result.Dispose(); }, TaskScheduler.Default);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch (Exception error) when (!token.IsCancellationRequested) { failure = error; }
        }
        token.ThrowIfCancellationRequested();
        throw failure ?? new SocketException((int)SocketError.HostNotFound);

        static async Task<Socket> Attempt(IPAddress address, int port, TimeSpan delay, CancellationToken token)
        {
            if (delay > TimeSpan.Zero) await Task.Delay(delay, token).ConfigureAwait(false);
            var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                await socket.ConnectAsync(new IPEndPoint(address, port), token).ConfigureAwait(false);
                return socket;
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        }
    }

    /// <summary>A poster or sidecar: only from the media request's own origin, small, and never fatal.</summary>
    private async Task<(byte[] Data, string? Type)?> FetchSmallAsync(Uri url, Request r, CancellationToken token)
    {
        if (!DownloadPaths.SameOrigin(url, r.Url)) return null;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        try
        {
            using var response = await SendAsync(url, r, null, timeout.Token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength > MaxAuxiliaryBytes) return null;
            await using var input = await response.Content.ReadAsStreamAsync(timeout.Token).ConfigureAwait(false);
            using var buffer = new MemoryStream();
            var chunk = new byte[64 * 1024];
            int read;
            while ((read = await input.ReadAsync(chunk, timeout.Token).ConfigureAwait(false)) > 0)
            {
                if (buffer.Length + read > MaxAuxiliaryBytes) return null;
                buffer.Write(chunk, 0, read);
            }
            return buffer.Length == 0 ? null : (buffer.ToArray(), response.Content.Headers.ContentType?.MediaType);
        }
        catch (Exception) when (!token.IsCancellationRequested) { return null; }
    }

    private async Task<string?> FetchPosterAsync(Request r, string dir, CancellationToken token)
    {
        if (r.Poster == null || await FetchSmallAsync(r.Poster, r, token).ConfigureAwait(false) is not var (data, type)) return null;
        string mime = type?.ToLowerInvariant() ?? "";
        string ext = mime.Contains("svg") ? "svg" : mime.Contains("png") ? "png" : mime.Contains("webp") ? "webp" : "jpg";
        try
        {
            WriteAtomically(Path.Combine(dir, $"poster.{ext}"), data);
            return Relative(r, $"poster.{ext}");
        }
        catch (Exception) { return null; }
    }

    private async Task<Dictionary<string, string>> FetchSidecarsAsync(Request r, string dir, CancellationToken token)
    {
        var paths = new Dictionary<string, string>();
        if (r.Sidecars.Count == 0) return paths;
        string folder = Path.Combine(dir, "subtitles");
        Directory.CreateDirectory(folder);
        if (!DownloadPaths.Contained(root, folder)) return paths;
        foreach (var sidecar in r.Sidecars)
        {
            if (await FetchSmallAsync(sidecar.Url, r, token).ConfigureAwait(false) is not var (data, _)) continue;
            string name = $"{DownloadPaths.DiskName(sidecar.TrackId)}.{sidecar.Format}";
            if (!DownloadPaths.WindowsName(name) && !DownloadPaths.DigestName(name)) continue;
            try
            {
                WriteAtomically(Path.Combine(folder, name), data);
                paths[sidecar.TrackId] = Relative(r, "subtitles", name);
            }
            catch (Exception) { }
        }
        return paths;
    }

    private static void WriteAtomically(string target, byte[] data)
    {
        string temp = target + ".tmp";
        File.WriteAllBytes(temp, data);
        File.Move(temp, target, overwrite: true);
    }

    private static PartInfo? ReadPartInfo(string path)
    {
        try { return File.Exists(path) ? JsonSerializer.Deserialize<PartInfo>(File.ReadAllText(path)) : null; }
        catch (Exception) { return null; }
    }

    private static void WritePartInfo(string path, PartInfo info)
    {
        try { WriteAtomically(path, JsonSerializer.Serialize(info)); }
        catch (Exception) { }
    }

    private async Task Pause(string key)
    {
        Transfer? transfer;
        lock (gate)
        {
            if (!transfers.TryGetValue(key, out transfer) || transfer.Finishing) return;
            transfer.Reason = StopReason.Pause;
        }
        Cancel(transfer);
        await Task.WhenAny(transfer.Task, Task.Delay(TimeSpan.FromSeconds(5))).ConfigureAwait(false);
    }

    private async Task Remove(string key, bool exact, params string[] ids)
    {
        List<Transfer> stopping;
        lock (gate)
        {
            stopping = transfers.Where(pair => exact ? pair.Key == key : pair.Key.StartsWith(key, StringComparison.Ordinal))
                .Select(pair => pair.Value).ToList();
            foreach (var transfer in stopping) transfer.Reason = StopReason.Remove;
        }
        foreach (var transfer in stopping) Cancel(transfer);
        await Task.WhenAny(Task.WhenAll(stopping.Select(t => t.Task)), Task.Delay(TimeSpan.FromSeconds(10))).ConfigureAwait(false);
        string? dir = StoredDirectory(ids);
        if (dir == null || !Directory.Exists(dir)) return;
        for (int attempt = 0; ; attempt++)
        {
            try
            {
                // Directory.Delete removes a junction or link it meets without following it.
                Directory.Delete(dir, recursive: true);
                return;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                if (attempt >= 4) throw new InvalidOperationException("The download is in use. Stop playing it and try again.");
                await Task.Delay(250).ConfigureAwait(false);
            }
        }
    }

    // ---- Desktop actions ---------------------------------------------------------------------------

    private void Reveal(string serverId, string viewerId, string titleId)
    {
        string target = MediaFile(serverId, viewerId, titleId) ?? throw new InvalidOperationException("This download is not on this computer");
        var explorer = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe");
        // Windows paths cannot contain quotes, so the path needs no further escaping.
        Process.Start(new ProcessStartInfo(explorer, $"/select,\"{target}\"") { UseShellExecute = false })?.Dispose();
    }

    private async Task<bool> ExportCopy(string serverId, string viewerId, string titleId, string? fileName)
    {
        string media = MediaFile(serverId, viewerId, titleId) ?? throw new InvalidOperationException("This download is not on this computer");
        string extension = Path.GetExtension(media).TrimStart('.');
        string? target = await pickSaveTarget(DownloadPaths.SuggestedFileName(fileName, extension), extension);
        if (target == null) return false;
        target = Path.GetFullPath(target);
        if (string.Equals(target, media, StringComparison.OrdinalIgnoreCase) || DownloadPaths.Inside(root, target))
            throw new InvalidOperationException("Choose a folder outside Vela's downloads");
        await Task.Run(async () =>
        {
            string temp = target + ".partial";
            try
            {
                await using (var input = new FileStream(media, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 20, FileOptions.Asynchronous | FileOptions.SequentialScan))
                await using (var output = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 20, FileOptions.Asynchronous | FileOptions.SequentialScan))
                {
                    await input.CopyToAsync(output, 1 << 20, shutdown.Token).ConfigureAwait(false);
                    output.Flush(flushToDisk: true);
                }
                File.Move(temp, target, overwrite: true);
            }
            catch (Exception error)
            {
                TryDelete(temp);
                throw new InvalidOperationException(error is IOException io && (io.HResult & 0xFFFF) is 112 or 39
                    ? "There isn't enough free space there for a copy" : "The copy could not be saved");
            }
        }).ConfigureAwait(false);
        return true;
    }

    // ---- Local route -------------------------------------------------------------------------------

    /// <summary>
    /// Serve <c>http://vela.localhost/vela-downloads/…</c> (posters and sidecars for the page, and the original
    /// should any web player ask) with single-range support. Returns false for any other URL.
    /// </summary>
    internal bool TryServe(CoreWebView2Environment environment, CoreWebView2WebResourceRequestedEventArgs e)
    {
        string url = e.Request.Uri;
        if (DownloadPaths.LocalUrlPath(url, allowQuery: true) is not string rawPath) return false;
        CoreWebView2WebResourceResponse Empty(int code, string reason, string extra = "") =>
            environment.CreateWebResourceResponse(null, code, reason, "Cache-Control: no-store" + extra);
        if (e.Request.Method is not ("GET" or "HEAD"))
        {
            e.Response = Empty(405, "Method Not Allowed");
            return true;
        }
        string? path = StoredFile(rawPath);
        if (path == null)
        {
            e.Response = Empty(404, "Not Found");
            return true;
        }
        FileStream stream;
        try { stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 16); }
        catch (Exception)
        {
            e.Response = Empty(404, "Not Found");
            return true;
        }
        long length = stream.Length;
        string? rangeHeader = e.Request.Headers.Contains("Range") ? e.Request.Headers.GetHeader("Range") : null;
        var (range, unsatisfiable) = DownloadPaths.ParseRange(rangeHeader, length);
        // A stored SVG poster opened as a document must not run anything.
        string common = $"Content-Type: {DownloadPaths.ContentType(path)}\r\nAccept-Ranges: bytes\r\nCache-Control: no-cache\r\n" +
            "X-Content-Type-Options: nosniff\r\nContent-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'";
        bool head = e.Request.Method == "HEAD";
        if (unsatisfiable)
        {
            stream.Dispose();
            e.Response = environment.CreateWebResourceResponse(null, 416, "Range Not Satisfiable", $"{common}\r\nContent-Range: bytes */{length}");
        }
        else if (range is { } part)
        {
            Stream body = new FileSlice(stream, part.Start, part.Length);
            if (head) { body.Dispose(); body = null!; }
            e.Response = environment.CreateWebResourceResponse(body, 206, "Partial Content",
                $"{common}\r\nContent-Range: bytes {part.Start}-{part.End}/{length}\r\nContent-Length: {part.Length}");
        }
        else
        {
            if (head) { stream.Dispose(); stream = null!; }
            e.Response = environment.CreateWebResourceResponse(stream, 200, "OK", $"{common}\r\nContent-Length: {length}");
        }
        return true;
    }

    /// <summary>A read-only window onto a file (one HTTP byte range).</summary>
    private sealed class FileSlice : Stream
    {
        private readonly FileStream inner;
        private readonly long start, length;
        private long position;

        public FileSlice(FileStream inner, long start, long length)
        {
            this.inner = inner;
            this.start = start;
            this.length = length;
            inner.Seek(start, SeekOrigin.Begin);
        }

        public override bool CanRead => true;
        public override bool CanSeek => true;
        public override bool CanWrite => false;
        public override long Length => length;
        public override long Position { get => position; set => Seek(value, SeekOrigin.Begin); }

        public override int Read(byte[] buffer, int offset, int count)
        {
            long left = length - position;
            if (left <= 0) return 0;
            int read = inner.Read(buffer, offset, (int)Math.Min(count, left));
            position += read;
            return read;
        }

        public override long Seek(long offset, SeekOrigin origin)
        {
            long next = origin switch { SeekOrigin.Begin => offset, SeekOrigin.Current => position + offset, _ => length + offset };
            position = Math.Clamp(next, 0, length);
            inner.Seek(start + position, SeekOrigin.Begin);
            return position;
        }

        public override void Flush() { }
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        protected override void Dispose(bool disposing)
        {
            if (disposing) inner.Dispose();
            base.Dispose(disposing);
        }
    }

    // ---- Events ------------------------------------------------------------------------------------

    private void Emit(Request r, string status, long bytesWritten, long? byteLength = null, Dictionary<string, object?>? extra = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["serverId"] = r.ServerId, ["viewerId"] = r.ViewerId, ["titleId"] = r.TitleId,
            ["status"] = status, ["bytesWritten"] = bytesWritten,
        };
        if ((byteLength ?? r.ByteLength) is long length && length > 0) payload["byteLength"] = length;
        if (extra != null) foreach (var pair in extra) payload[pair.Key] = pair.Value;
        // Terminal events also sit beside the files, so a completion the page never stored survives a restart.
        if (status != "downloading" && StoredDirectory(r.ServerId, r.ViewerId, r.TitleId) is string dir && Directory.Exists(dir))
        {
            try { WriteAtomically(Path.Combine(dir, "transfer-status.json"), JsonSerializer.Serialize(payload)); }
            catch (Exception) { }
        }
        try { emit(payload); } catch (Exception) { }
    }

    private static void TryDelete(string path)
    {
        try { File.Delete(path); } catch (Exception) { }
    }

    public void Dispose()
    {
        try { shutdown.Cancel(); } catch (ObjectDisposedException) { }
        client.Dispose();
    }
}
