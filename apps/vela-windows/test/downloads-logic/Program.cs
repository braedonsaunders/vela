// Checks the pure download rules in DownloadPaths.cs on a real Windows filesystem: ID and route
// validation, containment (including a junction that points outside the root), Range parsing and the
// origin rules. Exit code 0 means every check passed.
using System.Diagnostics;

namespace Vela.Windows
{
    // DownloadPaths reads the app origin from MainWindow; test/downloads-bridge.test.ts pins the value.
    internal static class MainWindow { internal const string AppOrigin = "http://vela.localhost"; }

    internal static class Check
    {
        private static int failures, passes;

        private static void Expect(bool condition, string what)
        {
            if (condition) passes++;
            else { failures++; Console.Error.WriteLine("FAIL " + what); }
        }

        private static int Main()
        {
            if (!OperatingSystem.IsWindows()) { Console.Error.WriteLine("Run this check on Windows."); return 2; }
            Ids();
            Routes();
            Containment();
            Ranges();
            Origins();
            Console.WriteLine($"{passes} passed, {failures} failed");
            return failures == 0 ? 0 : 1;
        }

        private static void Ids()
        {
            foreach (var bad in new[] { "", ".", "..", "a/b", "a\\b", "a\0b" }) Expect(!DownloadPaths.SafeId(bad), $"SafeId refuses '{bad}'");
            foreach (var good in new[] { "123", "a:b", "Plex Title", "~x" }) Expect(DownloadPaths.SafeId(good), $"SafeId accepts '{good}'");
            Expect(DownloadPaths.DiskName("12345") == "12345", "plain numeric ID kept");
            Expect(DownloadPaths.DiskName("3f2a-b_c.d") == "3f2a-b_c.d", "plain lowercase ID kept");
            foreach (var hashed in new[] { "Abc", "a:b", "con", "CON.txt", "~x", "x.", "x ", "a*b", "ü", "lpt1" })
            {
                string name = DownloadPaths.DiskName(hashed);
                Expect(name.StartsWith('~') && name.Length == 33 && DownloadPaths.DigestName(name), $"'{hashed}' stored as a digest");
            }
            Expect(DownloadPaths.DiskName("Abc") != DownloadPaths.DiskName("abc"), "case-different IDs never share a folder");
            Expect(DownloadPaths.DiskName("a:b") == DownloadPaths.DiskName("a:b"), "digest is stable");
            Expect(Throws(() => DownloadPaths.DiskName("..")), "DiskName refuses '..'");
            Expect(Throws(() => DownloadPaths.DiskName("a/b")), "DiskName refuses separators");
            Expect(DownloadPaths.Extension("MKV", "mp4") == "mkv" && DownloadPaths.Extension("../x", "mp4") == "x"
                && DownloadPaths.Extension("", "mp4") == "mp4" && DownloadPaths.Extension("..", "vtt") == "vtt", "extensions are letters and digits");
            Expect(DownloadPaths.SuggestedFileName("Film (2020).mkv", "mkv") == "Film (2020).mkv", "suggested name kept");
            Expect(DownloadPaths.SuggestedFileName("..\\..\\evil.mkv", "mkv") == ".._.._evil.mkv" || !DownloadPaths.SuggestedFileName("..\\..\\evil.mkv", "mkv").Contains('\\'),
                "suggested name has no folders");
            Expect(DownloadPaths.SuggestedFileName("CON", "mkv") == "Video.mkv", "device name replaced");
            Expect(DownloadPaths.SuggestedFileName("a:b?.mkv", "mkv") == "a b .mkv", "reserved characters replaced");
        }

        private static bool Throws(Action action)
        {
            try { action(); return false; } catch (ArgumentException) { return true; }
        }

        private static void Routes()
        {
            string digest = DownloadPaths.DiskName("a:b");
            var ok = DownloadPaths.RouteSegments("/vela-downloads/s1/v1/t1/media.mkv");
            Expect(ok is { Length: 4 } && ok[3] == "media.mkv", "plain route");
            Expect(DownloadPaths.RouteSegments($"/vela-downloads/{digest}/v/t/subtitles/{digest}.webvtt") is { Length: 5 }, "digest names route");
            Expect(DownloadPaths.RouteSegments("/vela-downloads/s/v/t/Media%20File.mkv") is { } spaced && spaced[3] == "Media File.mkv", "escaped space decodes");
            foreach (var bad in new[]
            {
                "/vela-downloads/", "/vela-downloads/s/../t/media.mkv", "/vela-downloads/s/./t/media.mkv", "/vela-downloads/s//t/media.mkv",
                "/vela-downloads/s/v/t/%2e%2e/x", "/vela-downloads/s/%2E%2E/x", "/vela-downloads/s/v%2Ft/media.mkv", "/vela-downloads/s/v%5ct/media.mkv",
                "/vela-downloads/s/v/t/media.mkv%00.jpg", "/vela-downloads/s\\v/t/media.mkv", "/vela-downloads/C:/x/y/z", "/vela-downloads/c%3A/x/y/z",
                "/vela-downloads/s/v/t/media.mkv:stream", "/vela-downloads/s/v/t/media.mkv%3Astream", "/vela-downloads/s/v/t/%252e%252e",
                "/vela-downloads/CON/v/t/media.mkv", "/vela-downloads/s/v/t/media.mkv.", "/vela-downloads/s/v/t/a%20", "/vela-downloads/~zz/v/t/x",
                "/vela-downloads/s/v/t/%E0%A4%A", "/vela/s/v/t/media.mkv", "/vela-downloads/s/v/t/a%0Ab",
            }) Expect(DownloadPaths.RouteSegments(bad) == null, $"route refuses {bad}");

            Expect(DownloadPaths.LocalUrlPath("http://vela.localhost/vela-downloads/s/v/t/media.mkv") == "/vela-downloads/s/v/t/media.mkv", "plan URL maps");
            Expect(DownloadPaths.LocalUrlPath("http://vela.localhost/vela-downloads/s/v/t/media.mkv?x=1") == null, "plan URL with a query refused");
            Expect(DownloadPaths.LocalUrlPath("http://vela.localhost/vela-downloads/s/v/t/poster.jpg?w=300", allowQuery: true) == "/vela-downloads/s/v/t/poster.jpg", "page request query ignored");
            Expect(DownloadPaths.LocalUrlPath("http://vela.localhost:8080/vela-downloads/s/v/t/media.mkv") == null, "other port refused");
            Expect(DownloadPaths.LocalUrlPath("https://vela.localhost/vela-downloads/s/v/t/media.mkv") == null, "other scheme refused");
            Expect(DownloadPaths.LocalUrlPath("http://server.lan/vela-downloads/s/v/t/media.mkv") == null, "server URL is not local");
            Expect(DownloadPaths.LocalUrlPath("http://vela.localhost/vela/index.html") == null, "app route is not local");

            Expect(DownloadPaths.RelativeSegments("s/v/t/media.mkv") is { Length: 4 }, "relative index path");
            Expect(DownloadPaths.RelativeSegments("s/../t") == null && DownloadPaths.RelativeSegments("/s/v") == null && DownloadPaths.RelativeSegments("C:/x") == null,
                "relative index path refuses escapes");
        }

        private static void Containment()
        {
            string scratch = Path.Combine(Path.GetTempPath(), "vela-downloads-logic-" + Guid.NewGuid().ToString("N"));
            string root = Path.Combine(scratch, "vela-downloads"), outside = Path.Combine(scratch, "outside");
            Directory.CreateDirectory(Path.Combine(root, "s", "v", "t"));
            Directory.CreateDirectory(outside);
            File.WriteAllText(Path.Combine(outside, "secret.txt"), "x");
            File.WriteAllText(Path.Combine(root, "s", "v", "t", "media.mkv"), "x");
            try
            {
                string resolved = DownloadPaths.ResolveRoot(root);
                Expect(DownloadPaths.Join(resolved, ["s", "v", "t", "media.mkv"]) is string inside && DownloadPaths.Contained(resolved, inside), "a stored file is contained");
                Expect(DownloadPaths.Join(resolved, ["s", "..", "..", "outside", "secret.txt"]) == null, "lexical escape refused");
                Expect(DownloadPaths.Join(resolved, ["..", "vela-downloads-evil", "x"]) == null, "sibling with the root as prefix refused");
                Expect(!DownloadPaths.Inside(resolved, resolved), "the root itself is not a stored file");
                Expect(DownloadPaths.Inside(resolved, resolved.ToUpperInvariant() + "\\S\\x"), "containment ignores case like NTFS");

                // A junction (no privilege needed) inside the root that points outside it.
                string junction = Path.Combine(root, "s", "v", "jt");
                Run("cmd.exe", $"/c mklink /J \"{junction}\" \"{outside}\"");
                Expect(Directory.Exists(junction), "junction created");
                Expect(File.Exists(Path.Combine(junction, "secret.txt")), "junction resolves outside");
                Expect(DownloadPaths.Join(resolved, ["s", "v", "jt", "secret.txt"]) is string through && !DownloadPaths.Contained(resolved, through),
                    "a file reached through a junction is refused");
                Expect(!DownloadPaths.Contained(resolved, junction), "the junction itself is refused");
                Expect(DownloadPaths.Contained(resolved, Path.Combine(resolved, "s", "v", "new", "media.mkv")), "a path not created yet is contained");

                // A root that is itself a junction resolves to its target before anything is compared.
                string linkedRoot = Path.Combine(scratch, "linked-root");
                Run("cmd.exe", $"/c mklink /J \"{linkedRoot}\" \"{root}\"");
                Expect(string.Equals(DownloadPaths.ResolveRoot(linkedRoot), resolved, StringComparison.OrdinalIgnoreCase), "a linked root resolves to its target");
                Directory.Delete(linkedRoot);
                Directory.Delete(junction);
            }
            finally
            {
                try { Directory.Delete(scratch, recursive: true); } catch (Exception) { }
            }
        }

        private static void Run(string file, string arguments)
        {
            using var process = Process.Start(new ProcessStartInfo(file, arguments) { UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true })!;
            process.WaitForExit();
        }

        private static void Ranges()
        {
            void Range(string? header, long length, long? start, long? end, bool unsatisfiable = false)
            {
                var (range, refused) = DownloadPaths.ParseRange(header, length);
                bool ok = refused == unsatisfiable && (start == null ? range == null : range is { } r && r.Start == start && r.End == end);
                Expect(ok, $"Range '{header}' of {length} -> {(unsatisfiable ? "416" : start == null ? "whole" : $"{start}-{end}")}");
            }
            Range(null, 100, null, null);
            Range("bytes=0-", 100, 0, 99);
            Range("bytes=0-0", 100, 0, 0);
            Range("bytes=10-19", 100, 10, 19);
            Range("bytes=90-200", 100, 90, 99);
            Range("bytes=-10", 100, 90, 99);
            Range("bytes=-500", 100, 0, 99);
            Range("BYTES=5-", 100, 5, 99);
            Range("bytes=100-", 100, null, null, unsatisfiable: true);
            Range("bytes=-0", 100, null, null, unsatisfiable: true);
            Range("bytes=0-", 0, null, null, unsatisfiable: true);
            Range("bytes=20-10", 100, null, null);
            Range("bytes=0-1,5-6", 100, null, null);
            Range("items=0-1", 100, null, null);
            Range("bytes=abc", 100, null, null);
            Range("bytes=-", 100, null, null);
            Range("bytes=99999999999999999999-", 100, null, null);

            Expect(DownloadPaths.ContentRangeStart("bytes 100-199/1000") == 100, "Content-Range start");
            Expect(DownloadPaths.ContentRangeStart("bytes */1000") == null, "unsatisfied Content-Range has no start");
            Expect(DownloadPaths.ContentRangeTotal("bytes 100-199/1000") == 1000 && DownloadPaths.ContentRangeTotal("bytes */1000") == 1000, "Content-Range total");
            Expect(DownloadPaths.ContentRangeTotal("bytes 0-1/*") == null && DownloadPaths.ContentRangeTotal(null) == null, "unknown total");
        }

        private static void Origins()
        {
            Uri U(string s) => new(s);
            Expect(DownloadPaths.SameOrigin(U("http://Server.LAN:32400/a"), U("http://server.lan:32400/b?x")), "same origin ignores host case and path");
            Expect(DownloadPaths.SameOrigin(U("http://h/a"), U("http://h:80/b")), "default port equals explicit");
            Expect(!DownloadPaths.SameOrigin(U("http://h/a"), U("https://h/a")), "scheme differs");
            Expect(!DownloadPaths.SameOrigin(U("http://h:1/a"), U("http://h:2/a")), "port differs");
            Expect(!DownloadPaths.SameOrigin(U("http://h.example/a"), U("http://h.example.evil/a")), "host differs");
            Expect(DownloadPaths.HttpUrl("http://user:pw@h/x") == null && DownloadPaths.HttpUrl("file:///c:/x") == null && DownloadPaths.HttpUrl("http://h/x") != null,
                "transfer URLs are plain http(s)");
            Expect(DownloadPaths.SameEtag("W/\"a\"", "\"a\"") && !DownloadPaths.SameEtag("\"a\"", "\"b\"") && !DownloadPaths.SameEtag(null, "\"a\""), "entity tags");
            var v6 = System.Net.IPAddress.IPv6Loopback; var v4 = System.Net.IPAddress.Loopback; var v4b = System.Net.IPAddress.Parse("10.0.0.2");
            Expect(DownloadPaths.Interleave([v6, v4, v4b]).SequenceEqual([v6, v4, v4b]) && DownloadPaths.Interleave([v4, v4b, v6]).SequenceEqual([v4, v6, v4b])
                && DownloadPaths.Interleave([]).Count == 0, "connect order alternates families from the resolver's first choice");
            Expect(DownloadPaths.ContentType("x.MKV") == "video/x-matroska" && DownloadPaths.ContentType("x.webvtt").StartsWith("text/vtt")
                && DownloadPaths.ContentType("x.bin") == "application/octet-stream", "content types");
        }
    }
}
