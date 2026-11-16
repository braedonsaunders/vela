// VelaMedia: the small C surface Vela's tvOS player uses over FFmpeg (LGPL-2.1-or-later).
// Demuxing (Matroska, MP4/MOV, MPEG-TS) from caller-supplied byte reads, audio decoding to
// interleaved float PCM for codecs Apple TV cannot render itself (DTS, DTS-HD, TrueHD, ...),
// and subtitle decoding (PGS/DVD/DVB bitmaps, SubRip/ASS/WebVTT/tx3g text).
// Video is never decoded here: compressed samples go to VideoToolbox.
#ifndef VELA_MEDIA_H
#define VELA_MEDIA_H
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/// Reads up to `size` bytes at the reader's position: the count, 0 at end of file, <0 on failure.
typedef int (*vm_read_fn)(void *opaque, uint8_t *buf, int size);
/// Moves the reader: whence 0 (set), 1 (current), 2 (end); 0x10000 asks only for the size (-1 if unknown).
typedef int64_t (*vm_seek_fn)(void *opaque, int64_t offset, int whence);

typedef struct VMDemuxer VMDemuxer;

enum { VM_VIDEO = 0, VM_AUDIO = 1, VM_SUBTITLE = 2, VM_OTHER = 3 };

typedef struct VMStreamInfo {
    int index;
    int type;
    char codec[32];          // FFmpeg codec name ("hevc", "h264", "eac3", "truehd", "hdmv_pgs_subtitle", ...)
    char language[16];
    char title[128];
    int is_default, is_forced, is_hearing_impaired, is_attached_pic;
    double time_base;        // seconds per tick
    double start_seconds;    // NAN when unknown
    // Codec configuration (owned by the demuxer; valid until vm_close).
    const uint8_t *extradata;
    int extradata_size;
    int profile, level;
    // Video
    int width, height, bits_per_raw_sample;
    double frame_rate;       // 0 when unknown
    int color_primaries, color_trc, color_space, color_range, field_order;
    int sar_num, sar_den;
    // Dolby Vision configuration record (dvcC/dvvC), when present.
    int dv_present, dv_version_major, dv_version_minor, dv_profile, dv_level;
    int dv_rpu_present, dv_el_present, dv_bl_present, dv_compatibility_id;
    // HDR10 static metadata, when present: SMPTE ST 2086 in HEVC SEI byte order (24 bytes:
    // G, B, R primaries and white point in 0.00002 units, max/min luminance in 0.0001 cd/m2)
    // and CTA-861.3 content light level (MaxCLL, MaxFALL), big endian.
    int has_mastering;
    uint8_t mastering[24];
    int has_light_level;
    uint8_t light_level[4];
    // Audio
    int sample_rate, channels;
    uint64_t channel_mask;   // AV_CH_* bits, 0 when the layout is unspecified
    int frame_size;          // samples per packet when fixed, else 0
    int bits_per_coded_sample;
} VMStreamInfo;

typedef struct VMPacket {
    int stream;
    double pts;              // seconds; NAN when absent
    double dts;              // seconds; NAN when absent
    double duration;         // seconds; 0 when unknown
    int keyframe;
    const uint8_t *data;     // valid until the next vm_read/vm_seek/vm_close
    int size;
    int64_t position;        // byte offset in the file, -1 when unknown
} VMPacket;

/// Opens and probes a container. NULL on failure, with a reason in `error`.
VMDemuxer *vm_open(void *opaque, vm_read_fn read, vm_seek_fn seek, char *error, int error_size);
/// Makes every blocking call return promptly with an error (from any thread).
void vm_interrupt(VMDemuxer *d, int interrupted);
const char *vm_container(VMDemuxer *d);
double vm_duration(VMDemuxer *d);     // seconds; NAN when unknown
int vm_stream_count(VMDemuxer *d);
int vm_stream_info(VMDemuxer *d, int index, VMStreamInfo *out);
/// Streams not enabled are discarded by the demuxer (all are enabled at open).
void vm_enable_stream(VMDemuxer *d, int index, int enabled);
/// 0 a packet, 1 end of file, <0 an error.
int vm_read(VMDemuxer *d, VMPacket *out);
/// Seeks so the next packets start at the keyframe at or before `seconds`. 0 ok, <0 error.
int vm_seek(VMDemuxer *d, double seconds);
void vm_close(VMDemuxer *d);

typedef struct VMAudioDecoder VMAudioDecoder;
typedef struct VMAudioFrame {
    const float *samples;    // interleaved float32, frames * channels; valid until the next call
    int frames, channels, sample_rate;
    uint64_t channel_mask;   // AV_CH_* bits of the output order
    double pts;              // seconds; NAN when unknown
} VMAudioFrame;
VMAudioDecoder *vm_audio_open(VMDemuxer *d, int stream, char *error, int error_size);
/// Feeds one packet (NULL data drains). 0 ok, <0 error.
int vm_audio_send(VMAudioDecoder *a, const uint8_t *data, int size, double pts);
/// 0 a frame, 1 needs more input, 2 drained, <0 error.
int vm_audio_receive(VMAudioDecoder *a, VMAudioFrame *out);
void vm_audio_flush(VMAudioDecoder *a);
void vm_audio_close(VMAudioDecoder *a);

typedef struct VMSubtitleDecoder VMSubtitleDecoder;
typedef struct VMSubtitleRect {
    int x, y, width, height;     // bitmap placement on the canvas
    const uint32_t *rgba;        // premultiplied RGBA8888 (byte order R,G,B,A), width*height; NULL for text
    const char *text;            // plain text or an ASS event line; NULL for bitmaps
    int ass;                     // text is an ASS "Dialogue" payload
} VMSubtitleRect;
typedef struct VMSubtitle {
    double start, end;           // seconds; end is NAN when open (until the next subtitle)
    int canvas_width, canvas_height;
    int count;                   // 0 clears the screen
    const VMSubtitleRect *rects; // valid until the next call
} VMSubtitle;
VMSubtitleDecoder *vm_subtitle_open(VMDemuxer *d, int stream, char *error, int error_size);
/// 0 a subtitle, 1 nothing to show yet, <0 error.
int vm_subtitle_decode(VMSubtitleDecoder *s, const uint8_t *data, int size, double pts, double duration, VMSubtitle *out);
void vm_subtitle_flush(VMSubtitleDecoder *s);
void vm_subtitle_close(VMSubtitleDecoder *s);
/// The ASS script header (styles, PlayResX/Y) for an ASS/SSA stream, or NULL.
const char *vm_subtitle_header(VMSubtitleDecoder *s);

#ifdef __cplusplus
}
#endif
#endif
