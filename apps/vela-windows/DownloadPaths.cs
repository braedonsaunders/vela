using System.Net;
using System.Security.Cryptography;
using System.Text;

namespace Vela.Windows;

/// <summary>The pure rules behind offline downloads (docs/downloads.md, "Local file routes"): which IDs
/// and URL paths may name a stored file, how they map under the downloads root, and the HTTP range and
/// origin arithmetic of transfers and the local route. No I/O except the reparse-point walk in
/// <see cref="Contained"/>. Checked by test/downloads-logic.</summary>
internal static class DownloadPaths
{
    /// <summary>The page's same-origin download route (the bridge's <c>base</c>).</summary>
    internal const string RoutePrefix = "/vela-downloads/";
    internal const string Base = MainWindow.AppOrigin + RoutePrefix;

    private static readonly HashSet<string> Reserved = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "COM¹", "COM²", "COM³",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9", "LPT¹", "LPT²", "LPT³",
    };

    /// <summary>An ID the page may send (iOS's rule): not empty, '.', '..', and no separators or NUL.</summary>
    internal static bool SafeId(string? value) => !string.IsNullOrEmpty(value) && value.Length <= 512
        && value != "." && value != ".." && value.IndexOfAny(['/', '\\', '\0']) < 0;

    /// <summary>A name Windows stores as written: no reserved characters, controls, trailing dot or space,
    /// device names or alternate data streams, and not our own '~' namespace.</summary>
    internal static bool WindowsName(string value)
    {
        if (value.Length is 0 or > 120 || value == "." || value == ".." || value[0] == '~') return false;
        if (value[^1] is '.' or ' ' || value[0] == ' ') return false;
        foreach (char c in value)
            if (c < 0x20 || c == 0x7f || c is '<' or '>' or ':' or '"' or '/' or '\\' or '|' or '?' or '*') return false;
        string stem = value.Split('.')[0].TrimEnd(' ');
        return !Reserved.Contains(stem);
    }

    /// <summary>The directory name an ID is stored under: the ID itself when it is plain lowercase ASCII Windows
    /// stores as written, else a stable '~'-prefixed digest (an ID with ':' must never become a data stream).</summary>
    internal static string DiskName(string id)
    {
        if (!SafeId(id)) throw new ArgumentException("Invalid download identifier");
        // NTFS ignores case, so only lowercase ASCII names are stored as written: "Ab" and "ab" stay apart.
        if (WindowsName(id) && id.All(c => c is (>= 'a' and <= 'z') or (>= '0' and <= '9') or '.' or '-' or '_')) return id;
        return "~" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(id)), 0, 16).ToLowerInvariant();
    }

    /// <summary>A file extension the page may ask for (container, sidecar format): letters and digits only.</summary>
    internal static string Extension(string? value, string fallback)
    {
        var cleaned = new string((value ?? "").ToLowerInvariant().Where(c => c is (>= 'a' and <= 'z') or (>= '0' and <= '9')).ToArray());
        return cleaned.Length == 0 ? fallback : cleaned.Length > 12 ? cleaned[..12] : cleaned;
    }

    /// <summary>
    /// The relative path segments a <c>/vela-downloads/…</c> URL path names, or null. Encoded separators,
    /// NULs and encoded dots are refused before decoding; after decoding every segment must be a plain
    /// Windows name (no '..', '.', empty, backslash, control characters, drive letters or ':').
    /// </summary>
    internal static string[]? RouteSegments(string rawPath)
    {
        if (!rawPath.StartsWith(RoutePrefix, StringComparison.Ordinal)) return null;
        string rest = rawPath[RoutePrefix.Length..];
        if (rest.Length == 0 || rest.Length > 2048) return null;
        string lower = rest.ToLowerInvariant();
        if (lower.Contains("%2f") || lower.Contains("%5c") || lower.Contains("%00") || lower.Contains("%2e") || rest.Contains('\\')) return null;
        var segments = rest.Split('/');
        var decoded = new string[segments.Length];
        for (int i = 0; i < segments.Length; i++)
        {
            string value;
            try { value = Uri.UnescapeDataString(segments[i]); }
            catch (UriFormatException) { return null; }
            // A '%' left after decoding is a malformed or double escape: refuse, never decode twice.
            if (value.Contains('%') || !WindowsName(value) && !DigestName(value)) return null;
            decoded[i] = value;
        }
        return decoded;
    }

    /// <summary>
    /// The raw <c>/vela-downloads/…</c> path of a URL on the app's download route, or null. Plan URLs
    /// (<paramref name="allowQuery"/> false) must carry no query or fragment; the page's own requests may.
    /// </summary>
    internal static string? LocalUrlPath(string? url, bool allowQuery = false)
    {
        if (url == null || !url.StartsWith(Base, StringComparison.OrdinalIgnoreCase)) return null;
        string path = url[MainWindow.AppOrigin.Length..];
        int end = path.IndexOfAny(['?', '#']);
        if (end >= 0)
        {
            if (!allowQuery) return null;
            path = path[..end];
        }
        return path.StartsWith(RoutePrefix, StringComparison.Ordinal) ? path : null;
    }

    /// <summary>One of our own digest names (see <see cref="DiskName"/>), optionally with an extension.</summary>
    internal static bool DigestName(string value)
    {
        if (value.Length < 33 || value[0] != '~' || !value.Skip(1).Take(32).All(c => c is (>= '0' and <= '9') or (>= 'a' and <= 'f'))) return false;
        if (value.Length == 33) return true;
        string extension = value[33..];
        return extension.Length is >= 2 and <= 13 && extension[0] == '.' && extension.Skip(1).All(c => c is (>= 'a' and <= 'z') or (>= '0' and <= '9'));
    }

    /// <summary>The segments of an index path the page stored ("&lt;server&gt;/&lt;viewer&gt;/&lt;title&gt;/media.mkv").</summary>
    internal static string[]? RelativeSegments(string relative)
    {
        if (string.IsNullOrEmpty(relative) || relative.Length > 2048) return null;
        var segments = relative.Split('/');
        return segments.All(s => WindowsName(s) || DigestName(s)) ? segments : null;
    }

    /// <summary>The lexical join of validated segments under <paramref name="root"/>, or null when the full
    /// path would leave it. <paramref name="root"/> must already be a full path without a trailing separator.</summary>
    internal static string? Join(string root, IReadOnlyList<string> segments)
    {
        if (segments.Count == 0) return null;
        string path;
        try { path = Path.GetFullPath(Path.Combine(root, Path.Combine(segments.ToArray()))); }
        catch (Exception e) when (e is ArgumentException or NotSupportedException or PathTooLongException) { return null; }
        return Inside(root, path) ? path : null;
    }

    /// <summary>Whether <paramref name="path"/> lies strictly below <paramref name="root"/> (case-insensitive, as NTFS is).</summary>
    internal static bool Inside(string root, string path)
    {
        string prefix = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;
        return path.Length > prefix.Length && path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Lexically contained and real: no directory or file from below the root down to <paramref name="path"/>
    /// is a reparse point (a symlink or junction could point anywhere). Missing components are fine.
    /// </summary>
    internal static bool Contained(string root, string path)
    {
        if (!Inside(root, path)) return false;
        for (string? current = path; current != null && Inside(root, current); current = Path.GetDirectoryName(current))
        {
            try
            {
                var attributes = File.GetAttributes(current);
                if ((attributes & FileAttributes.ReparsePoint) != 0) return false;
            }
            catch (Exception e) when (e is FileNotFoundException or DirectoryNotFoundException) { }
            catch (Exception) { return false; }
        }
        return true;
    }

    /// <summary>The real downloads root: the configured folder with its own links resolved.</summary>
    internal static string ResolveRoot(string root)
    {
        string full = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        try
        {
            if (new DirectoryInfo(full).ResolveLinkTarget(returnFinalTarget: true) is { } target)
                return Path.GetFullPath(target.FullName).TrimEnd(Path.DirectorySeparatorChar);
        }
        catch (IOException) { }
        return full;
    }

    /// <summary>A request's byte range against a file of <paramref name="length"/> bytes.</summary>
    internal readonly record struct ByteRange(long Start, long End)
    {
        public long Length => End - Start + 1;
    }

    /// <summary>
    /// Parse one <c>Range: bytes=…</c> header. Returns (null, false) to serve the whole file (no header, a
    /// unit other than bytes, several ranges or a malformed value) and (null, true) when the single range
    /// cannot be satisfied (416).
    /// </summary>
    internal static (ByteRange? Range, bool Unsatisfiable) ParseRange(string? header, long length)
    {
        if (string.IsNullOrWhiteSpace(header)) return (null, false);
        string value = header.Trim();
        if (!value.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase)) return (null, false);
        string spec = value[6..].Trim();
        if (spec.Contains(',')) return (null, false);
        int dash = spec.IndexOf('-');
        if (dash < 0) return (null, false);
        string first = spec[..dash].Trim(), last = spec[(dash + 1)..].Trim();
        static bool Digits(string s) => s.Length is > 0 and <= 19 && s.All(char.IsAsciiDigit);
        if (first.Length == 0)
        {
            if (!Digits(last) || !long.TryParse(last, out long suffix)) return (null, false);
            if (suffix == 0 || length == 0) return (null, true);
            return (new ByteRange(Math.Max(0, length - suffix), length - 1), false);
        }
        if (!Digits(first) || !long.TryParse(first, out long start)) return (null, false);
        long end = length - 1;
        if (last.Length > 0)
        {
            if (!Digits(last) || !long.TryParse(last, out end) || end < start) return (null, false);
            end = Math.Min(end, length - 1);
        }
        if (start >= length) return (null, true);
        return (new ByteRange(start, end), false);
    }

    /// <summary>The first byte of a <c>Content-Range: bytes a-b/n</c> response header.</summary>
    internal static long? ContentRangeStart(string? header)
    {
        if (header == null || !header.StartsWith("bytes ", StringComparison.OrdinalIgnoreCase)) return null;
        int dash = header.IndexOf('-');
        return dash > 6 && long.TryParse(header.AsSpan(6, dash - 6).Trim(), out long start) && start >= 0 ? start : null;
    }

    /// <summary>The total size of a <c>Content-Range</c> (<c>bytes a-b/n</c> or <c>bytes */n</c>), or null when unknown.</summary>
    internal static long? ContentRangeTotal(string? header)
    {
        int slash = header?.LastIndexOf('/') ?? -1;
        return slash > 0 && long.TryParse(header.AsSpan(slash + 1).Trim(), out long total) && total >= 0 ? total : null;
    }

    /// <summary>Same exact origin: scheme, host and port (the only place credentials and redirects may go).</summary>
    internal static bool SameOrigin(Uri a, Uri b) => a.IsAbsoluteUri && b.IsAbsoluteUri
        && string.Equals(a.Scheme, b.Scheme, StringComparison.OrdinalIgnoreCase)
        && string.Equals(a.IdnHost, b.IdnHost, StringComparison.OrdinalIgnoreCase) && a.Port == b.Port;

    /// <summary>An http(s) URL without user information, or null.</summary>
    internal static Uri? HttpUrl(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" && uri.UserInfo.Length == 0 ? uri : null;

    /// <summary>Entity tags compare without the weak prefix (a proxy may weaken a strong tag).</summary>
    internal static bool SameEtag(string? a, string? b)
    {
        static string Strip(string s) => s.StartsWith("W/", StringComparison.Ordinal) ? s[2..] : s;
        return a != null && b != null && Strip(a.Trim()) == Strip(b.Trim());
    }

    /// <summary>The local route's Content-Type for a stored file.</summary>
    internal static string ContentType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".mp4" or ".m4v" => "video/mp4",
        ".mkv" => "video/x-matroska",
        ".webm" => "video/webm",
        ".mov" => "video/quicktime",
        ".avi" => "video/x-msvideo",
        ".ts" or ".m2ts" or ".mts" => "video/mp2t",
        ".mpg" or ".mpeg" => "video/mpeg",
        ".wmv" => "video/x-ms-wmv",
        ".m4a" => "audio/mp4",
        ".mp3" => "audio/mpeg",
        ".flac" => "audio/flac",
        ".vtt" or ".webvtt" => "text/vtt; charset=utf-8",
        ".srt" => "application/x-subrip; charset=utf-8",
        ".ass" or ".ssa" => "text/x-ssa; charset=utf-8",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".svg" => "image/svg+xml",
        _ => "application/octet-stream",
    };

    /// <summary>A file name the viewer's Save dialog starts from: the page's suggestion without folders or reserved characters.</summary>
    internal static string SuggestedFileName(string? value, string extension)
    {
        // Reserved characters go first: Windows reads "a:b" as a drive-relative path.
        string name = new string((value ?? "").Select(c => c < 0x20 || "<>:\"|?*".Contains(c) ? ' ' : c is '/' or '\\' ? '_' : c).ToArray());
        name = Path.GetFileName(name).Trim().TrimEnd('.');
        if (name.Length > 150) name = name[..150].Trim();
        if (name.Length == 0 || !WindowsName(name)) name = "Video." + extension;
        return name;
    }

    /// <summary>Addresses alternating between families, starting with the resolver's first choice.</summary>
    internal static List<IPAddress> Interleave(IReadOnlyList<IPAddress> addresses)
    {
        if (addresses.Count == 0) return [];
        var first = addresses.Where(a => a.AddressFamily == addresses[0].AddressFamily).ToList();
        var other = addresses.Where(a => a.AddressFamily != addresses[0].AddressFamily).ToList();
        var ordered = new List<IPAddress>(addresses.Count);
        for (int i = 0; i < Math.Max(first.Count, other.Count); i++)
        {
            if (i < first.Count) ordered.Add(first[i]);
            if (i < other.Count) ordered.Add(other[i]);
        }
        return ordered;
    }
}
