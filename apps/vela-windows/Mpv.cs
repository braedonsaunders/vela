using System.Runtime.InteropServices;
using System.Text.Json;

namespace Vela.Windows;

// All calls are serialized by the UI thread. JSON property reads avoid native struct ownership.
internal sealed class Mpv : IDisposable
{
    private IntPtr handle;
    [DllImport("libmpv-2.dll", CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr mpv_create();
    [DllImport("libmpv-2.dll", CallingConvention = CallingConvention.Cdecl)] private static extern int mpv_initialize(IntPtr ctx);
    [DllImport("libmpv-2.dll", CallingConvention = CallingConvention.Cdecl)] private static extern int mpv_set_option_string(IntPtr ctx, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, [MarshalAs(UnmanagedType.LPUTF8Str)] string value);
    [DllImport("libmpv-2.dll", CallingConvention = CallingConvention.Cdecl)] private static extern int mpv_command(IntPtr ctx, IntPtr args);
    [DllImport("libmpv-2.dll", CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr mpv_get_property_string(IntPtr ctx, [MarshalAs(UnmanagedType.LPUTF8Str)] string name);
    [DllImport("libmpv-2.dll", CallingConvention = CallingConvention.Cdecl)] private static extern void mpv_free(IntPtr value);
    [DllImport("libmpv-2.dll", CallingConvention = CallingConvention.Cdecl)] private static extern void mpv_terminate_destroy(IntPtr ctx);
    internal Mpv(IntPtr window)
    {
        handle = mpv_create();
        if (handle == IntPtr.Zero) throw new InvalidOperationException("mpv_create failed");
        try
        {
            Check(mpv_set_option_string(handle, "config", "no"));
            Check(mpv_set_option_string(handle, "scripts", ""));
            Check(mpv_set_option_string(handle, "wid", window.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture)));
            Check(mpv_set_option_string(handle, "input-default-bindings", "no"));
            Check(mpv_initialize(handle));
        }
        catch { Dispose(); throw; }
    }
    internal void Command(params string[] args)
    {
        ObjectDisposedException.ThrowIf(handle == IntPtr.Zero, this);
        var strings = args.Select(Marshal.StringToCoTaskMemUTF8).ToArray();
        var array = Marshal.AllocHGlobal((strings.Length + 1) * IntPtr.Size);
        try
        {
            for (int i = 0; i < strings.Length; i++) Marshal.WriteIntPtr(array, i * IntPtr.Size, strings[i]);
            Marshal.WriteIntPtr(array, strings.Length * IntPtr.Size, IntPtr.Zero);
            Check(mpv_command(handle, array));
        }
        finally { Marshal.FreeHGlobal(array); foreach (var value in strings) Marshal.FreeCoTaskMem(value); }
    }
    internal string? Property(string name)
    {
        ObjectDisposedException.ThrowIf(handle == IntPtr.Zero, this);
        var value = mpv_get_property_string(handle, name);
        try { return Marshal.PtrToStringUTF8(value); }
        finally { if (value != IntPtr.Zero) mpv_free(value); }
    }
    private static void Check(int result)
    {
        if (result < 0) throw new InvalidOperationException($"libmpv operation failed ({result})");
    }
    public void Dispose()
    {
        var current = handle; handle = IntPtr.Zero;
        if (current != IntPtr.Zero) mpv_terminate_destroy(current);
    }
}
