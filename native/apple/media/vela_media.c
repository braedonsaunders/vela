// VelaMedia shim over FFmpeg: see vela_media.h. Linked into VelaMedia.framework with
// FFmpeg's static libraries (LGPL-2.1-or-later); build-ffmpeg.sh builds both.
#include "vela_media.h"
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/dovi_meta.h>
#include <libavutil/mastering_display_metadata.h>
#include <libavutil/channel_layout.h>
#include <libavutil/opt.h>
#include <libswresample/swresample.h>
#include <math.h>
#include <stdatomic.h>
#include <string.h>

struct VMDemuxer {
    AVFormatContext *fmt;
    AVIOContext *io;
    AVPacket *pkt;
    void *opaque;
    vm_read_fn read;
    vm_seek_fn seek;
    atomic_int interrupted;
};

static int io_read(void *opaque, uint8_t *buf, int size) {
    VMDemuxer *d = opaque;
    if (atomic_load(&d->interrupted)) return AVERROR_EXIT;
    int n = d->read(d->opaque, buf, size);
    if (n == 0) return AVERROR_EOF;
    if (n < 0) return atomic_load(&d->interrupted) ? AVERROR_EXIT : AVERROR(EIO);
    return n;
}
static int64_t io_seek(void *opaque, int64_t offset, int whence) {
    VMDemuxer *d = opaque;
    if (atomic_load(&d->interrupted)) return AVERROR_EXIT;
    int64_t r = d->seek(d->opaque, offset, whence & ~AVSEEK_FORCE);
    return r < 0 && (whence & AVSEEK_SIZE) == 0 ? AVERROR(EIO) : r;
}
static int io_interrupt(void *opaque) { return atomic_load(&((VMDemuxer *)opaque)->interrupted); }
static void say(char *error, int size, const char *what, int code) {
    if (!error || size <= 0) return;
    char reason[128] = "";
    if (code) av_strerror(code, reason, sizeof reason);
    snprintf(error, (size_t)size, code ? "%s: %s" : "%s", what, reason);
}

VMDemuxer *vm_open(void *opaque, vm_read_fn read, vm_seek_fn seek, char *error, int error_size) {
    av_log_set_level(AV_LOG_ERROR);
    VMDemuxer *d = av_mallocz(sizeof *d);
    if (!d) return NULL;
    d->opaque = opaque; d->read = read; d->seek = seek;
    const int buffer_size = 256 * 1024;
    uint8_t *buffer = av_malloc(buffer_size);
    d->io = buffer ? avio_alloc_context(buffer, buffer_size, 0, d, io_read, NULL, io_seek) : NULL;
    d->fmt = avformat_alloc_context();
    d->pkt = av_packet_alloc();
    if (!d->io || !d->fmt || !d->pkt) { if (!d->io) av_free(buffer); say(error, error_size, "out of memory", 0); vm_close(d); return NULL; }
    d->fmt->pb = d->io;
    d->fmt->flags |= AVFMT_FLAG_CUSTOM_IO;
    d->fmt->interrupt_callback = (AVIOInterruptCB){ io_interrupt, d };
    AVDictionary *options = NULL;
    av_dict_set(&options, "analyzeduration", "3000000", 0);
    av_dict_set(&options, "probesize", "8000000", 0);
    int r = avformat_open_input(&d->fmt, NULL, NULL, &options);
    av_dict_free(&options);
    if (r < 0) { say(error, error_size, "The container could not be opened", r); d->fmt = NULL; vm_close(d); return NULL; }
    if ((r = avformat_find_stream_info(d->fmt, NULL)) < 0) { say(error, error_size, "The container's streams could not be read", r); vm_close(d); return NULL; }
    return d;
}

void vm_interrupt(VMDemuxer *d, int interrupted) { if (d) atomic_store(&d->interrupted, interrupted); }
const char *vm_container(VMDemuxer *d) { return d && d->fmt && d->fmt->iformat ? d->fmt->iformat->name : ""; }
double vm_duration(VMDemuxer *d) {
    return d && d->fmt && d->fmt->duration != AV_NOPTS_VALUE ? (double)d->fmt->duration / AV_TIME_BASE : NAN;
}
int vm_stream_count(VMDemuxer *d) { return d && d->fmt ? (int)d->fmt->nb_streams : 0; }

static void put16(uint8_t *p, unsigned v) { p[0] = (uint8_t)(v >> 8); p[1] = (uint8_t)v; }
static void put32(uint8_t *p, unsigned v) { p[0] = (uint8_t)(v >> 24); p[1] = (uint8_t)(v >> 16); p[2] = (uint8_t)(v >> 8); p[3] = (uint8_t)v; }
static unsigned scaled(AVRational r, double unit) { double v = av_q2d(r) / unit; return v < 0 ? 0 : v > 4294967295.0 ? 4294967295u : (unsigned)lround(v); }

int vm_stream_info(VMDemuxer *d, int index, VMStreamInfo *out) {
    if (!d || index < 0 || index >= (int)d->fmt->nb_streams || !out) return -1;
    memset(out, 0, sizeof *out);
    AVStream *st = d->fmt->streams[index];
    AVCodecParameters *p = st->codecpar;
    out->index = index;
    out->type = p->codec_type == AVMEDIA_TYPE_VIDEO ? VM_VIDEO : p->codec_type == AVMEDIA_TYPE_AUDIO ? VM_AUDIO : p->codec_type == AVMEDIA_TYPE_SUBTITLE ? VM_SUBTITLE : VM_OTHER;
    snprintf(out->codec, sizeof out->codec, "%s", avcodec_get_name(p->codec_id));
    const AVDictionaryEntry *e = av_dict_get(st->metadata, "language", NULL, 0);
    if (e) snprintf(out->language, sizeof out->language, "%s", e->value);
    e = av_dict_get(st->metadata, "title", NULL, 0);
    if (e) snprintf(out->title, sizeof out->title, "%s", e->value);
    out->is_default = !!(st->disposition & AV_DISPOSITION_DEFAULT);
    out->is_forced = !!(st->disposition & AV_DISPOSITION_FORCED);
    out->is_hearing_impaired = !!(st->disposition & AV_DISPOSITION_HEARING_IMPAIRED);
    out->is_attached_pic = !!(st->disposition & AV_DISPOSITION_ATTACHED_PIC);
    out->time_base = av_q2d(st->time_base);
    out->start_seconds = st->start_time != AV_NOPTS_VALUE ? st->start_time * out->time_base : NAN;
    out->extradata = p->extradata; out->extradata_size = p->extradata_size;
    out->profile = p->profile; out->level = p->level;
    out->width = p->width; out->height = p->height; out->bits_per_raw_sample = p->bits_per_raw_sample;
    AVRational rate = st->avg_frame_rate.num && st->avg_frame_rate.den ? st->avg_frame_rate : st->r_frame_rate;
    out->frame_rate = rate.num && rate.den ? av_q2d(rate) : 0;
    out->color_primaries = p->color_primaries; out->color_trc = p->color_trc; out->color_space = p->color_space;
    out->color_range = p->color_range; out->field_order = p->field_order;
    out->sar_num = p->sample_aspect_ratio.num; out->sar_den = p->sample_aspect_ratio.den;
    const AVPacketSideData *sd = av_packet_side_data_get(p->coded_side_data, p->nb_coded_side_data, AV_PKT_DATA_DOVI_CONF);
    if (sd && sd->size >= (int)sizeof(AVDOVIDecoderConfigurationRecord)) {
        const AVDOVIDecoderConfigurationRecord *dv = (const void *)sd->data;
        out->dv_present = 1; out->dv_version_major = dv->dv_version_major; out->dv_version_minor = dv->dv_version_minor;
        out->dv_profile = dv->dv_profile; out->dv_level = dv->dv_level; out->dv_rpu_present = dv->rpu_present_flag;
        out->dv_el_present = dv->el_present_flag; out->dv_bl_present = dv->bl_present_flag;
        out->dv_compatibility_id = dv->dv_bl_signal_compatibility_id;
    }
    sd = av_packet_side_data_get(p->coded_side_data, p->nb_coded_side_data, AV_PKT_DATA_MASTERING_DISPLAY_METADATA);
    if (sd && sd->size >= (int)sizeof(AVMasteringDisplayMetadata)) {
        const AVMasteringDisplayMetadata *m = (const void *)sd->data;
        if (m->has_primaries && m->has_luminance) {
            static const int order[3] = { 1, 2, 0 }; // SEI order: green, blue, red
            for (int c = 0; c < 3; c++) {
                put16(out->mastering + c * 4, scaled(m->display_primaries[order[c]][0], 0.00002));
                put16(out->mastering + c * 4 + 2, scaled(m->display_primaries[order[c]][1], 0.00002));
            }
            put16(out->mastering + 12, scaled(m->white_point[0], 0.00002));
            put16(out->mastering + 14, scaled(m->white_point[1], 0.00002));
            put32(out->mastering + 16, scaled(m->max_luminance, 0.0001));
            put32(out->mastering + 20, scaled(m->min_luminance, 0.0001));
            out->has_mastering = 1;
        }
    }
    sd = av_packet_side_data_get(p->coded_side_data, p->nb_coded_side_data, AV_PKT_DATA_CONTENT_LIGHT_LEVEL);
    if (sd && sd->size >= (int)sizeof(AVContentLightMetadata)) {
        const AVContentLightMetadata *l = (const void *)sd->data;
        put16(out->light_level, l->MaxCLL > 65535 ? 65535 : l->MaxCLL);
        put16(out->light_level + 2, l->MaxFALL > 65535 ? 65535 : l->MaxFALL);
        out->has_light_level = 1;
    }
    out->sample_rate = p->sample_rate;
    out->channels = p->ch_layout.nb_channels;
    out->channel_mask = p->ch_layout.order == AV_CHANNEL_ORDER_NATIVE ? p->ch_layout.u.mask : 0;
    out->frame_size = p->frame_size;
    out->bits_per_coded_sample = p->bits_per_coded_sample;
    return 0;
}

void vm_enable_stream(VMDemuxer *d, int index, int enabled) {
    if (d && index >= 0 && index < (int)d->fmt->nb_streams) d->fmt->streams[index]->discard = enabled ? AVDISCARD_DEFAULT : AVDISCARD_ALL;
}

int vm_read(VMDemuxer *d, VMPacket *out) {
    av_packet_unref(d->pkt);
    for (;;) {
        int r = av_read_frame(d->fmt, d->pkt);
        if (r == AVERROR_EOF) return 1;
        if (r < 0) return r;
        AVStream *st = d->fmt->streams[d->pkt->stream_index];
        if (st->discard == AVDISCARD_ALL) { av_packet_unref(d->pkt); continue; }
        double tb = av_q2d(st->time_base);
        out->stream = d->pkt->stream_index;
        out->pts = d->pkt->pts != AV_NOPTS_VALUE ? d->pkt->pts * tb : NAN;
        out->dts = d->pkt->dts != AV_NOPTS_VALUE ? d->pkt->dts * tb : NAN;
        out->duration = d->pkt->duration > 0 ? d->pkt->duration * tb : 0;
        out->keyframe = !!(d->pkt->flags & AV_PKT_FLAG_KEY);
        out->data = d->pkt->data; out->size = d->pkt->size;
        out->position = d->pkt->pos;
        return 0;
    }
}

int vm_seek(VMDemuxer *d, double seconds) {
    av_packet_unref(d->pkt);
    // An interrupted read leaves the I/O context's error and end flags set; a seek starts afresh.
    atomic_store(&d->interrupted, 0);
    if (d->fmt->pb) { d->fmt->pb->error = 0; d->fmt->pb->eof_reached = 0; }
    int64_t ts = (int64_t)llround((seconds < 0 ? 0 : seconds) * AV_TIME_BASE);
    if (d->fmt->start_time != AV_NOPTS_VALUE) ts += d->fmt->start_time;
    int r = avformat_seek_file(d->fmt, -1, INT64_MIN, ts, ts, 0);
    if (r < 0) r = av_seek_frame(d->fmt, -1, ts, AVSEEK_FLAG_BACKWARD);
    return r < 0 ? r : 0;
}

void vm_close(VMDemuxer *d) {
    if (!d) return;
    av_packet_free(&d->pkt);
    if (d->fmt) avformat_close_input(&d->fmt);
    if (d->io) { av_freep(&d->io->buffer); avio_context_free(&d->io); }
    av_free(d);
}

// Audio ---------------------------------------------------------------------------------

struct VMAudioDecoder {
    AVCodecContext *ctx;
    AVPacket *pkt;
    AVFrame *frame;
    SwrContext *swr;
    AVChannelLayout swr_layout;
    int swr_format, swr_rate;
    float *out; int out_capacity;
    double time_base;
};

VMAudioDecoder *vm_audio_open(VMDemuxer *d, int stream, char *error, int error_size) {
    if (!d || stream < 0 || stream >= (int)d->fmt->nb_streams) { say(error, error_size, "no such stream", 0); return NULL; }
    AVStream *st = d->fmt->streams[stream];
    const AVCodec *codec = avcodec_find_decoder(st->codecpar->codec_id);
    if (!codec) { say(error, error_size, "This audio format has no decoder", 0); return NULL; }
    VMAudioDecoder *a = av_mallocz(sizeof *a);
    a->ctx = avcodec_alloc_context3(codec);
    a->pkt = av_packet_alloc(); a->frame = av_frame_alloc();
    if (!a->ctx || !a->pkt || !a->frame) { vm_audio_close(a); say(error, error_size, "out of memory", 0); return NULL; }
    avcodec_parameters_to_context(a->ctx, st->codecpar);
    a->ctx->pkt_timebase = st->time_base;
    a->ctx->request_sample_fmt = AV_SAMPLE_FMT_FLT;
    a->time_base = av_q2d(st->time_base);
    a->swr_format = -1;
    int r = avcodec_open2(a->ctx, codec, NULL);
    if (r < 0) { say(error, error_size, "The audio decoder could not start", r); vm_audio_close(a); return NULL; }
    return a;
}

int vm_audio_send(VMAudioDecoder *a, const uint8_t *data, int size, double pts) {
    if (!data) return avcodec_send_packet(a->ctx, NULL) == AVERROR_EOF ? 0 : 0;
    av_packet_unref(a->pkt);
    if (av_new_packet(a->pkt, size) < 0) return AVERROR(ENOMEM);
    memcpy(a->pkt->data, data, (size_t)size);
    a->pkt->pts = isnan(pts) ? AV_NOPTS_VALUE : llround(pts / a->time_base);
    a->pkt->dts = a->pkt->pts;
    int r = avcodec_send_packet(a->ctx, a->pkt);
    // A corrupt packet is dropped, as a player does, rather than ending the stream.
    return r == AVERROR_INVALIDDATA ? 0 : r;
}

int vm_audio_receive(VMAudioDecoder *a, VMAudioFrame *out) {
    av_frame_unref(a->frame);
    int r = avcodec_receive_frame(a->ctx, a->frame);
    if (r == AVERROR(EAGAIN)) return 1;
    if (r == AVERROR_EOF) return 2;
    if (r == AVERROR_INVALIDDATA) return 1;
    if (r < 0) return r;
    AVFrame *f = a->frame;
    AVChannelLayout layout;
    if (f->ch_layout.order == AV_CHANNEL_ORDER_NATIVE) av_channel_layout_copy(&layout, &f->ch_layout);
    else av_channel_layout_default(&layout, f->ch_layout.nb_channels);
    if (!a->swr || a->swr_format != f->format || a->swr_rate != f->sample_rate || av_channel_layout_compare(&a->swr_layout, &layout)) {
        swr_free(&a->swr);
        if (swr_alloc_set_opts2(&a->swr, &layout, AV_SAMPLE_FMT_FLT, f->sample_rate, &layout, f->format, f->sample_rate, 0, NULL) < 0 || swr_init(a->swr) < 0) {
            av_channel_layout_uninit(&layout); swr_free(&a->swr); return AVERROR(EINVAL);
        }
        av_channel_layout_uninit(&a->swr_layout);
        av_channel_layout_copy(&a->swr_layout, &layout);
        a->swr_format = f->format; a->swr_rate = f->sample_rate;
    }
    int channels = layout.nb_channels;
    int need = f->nb_samples * channels;
    if (need > a->out_capacity) {
        av_free(a->out);
        a->out = av_malloc((size_t)need * sizeof(float));
        a->out_capacity = a->out ? need : 0;
        if (!a->out) { av_channel_layout_uninit(&layout); return AVERROR(ENOMEM); }
    }
    uint8_t *dst[1] = { (uint8_t *)a->out };
    int frames = swr_convert(a->swr, dst, f->nb_samples, (const uint8_t **)f->extended_data, f->nb_samples);
    if (frames < 0) { av_channel_layout_uninit(&layout); return frames; }
    out->samples = a->out; out->frames = frames; out->channels = channels; out->sample_rate = f->sample_rate;
    out->channel_mask = layout.u.mask;
    int64_t ts = f->best_effort_timestamp != AV_NOPTS_VALUE ? f->best_effort_timestamp : f->pts;
    out->pts = ts != AV_NOPTS_VALUE ? ts * a->time_base : NAN;
    av_channel_layout_uninit(&layout);
    return 0;
}

void vm_audio_flush(VMAudioDecoder *a) { if (a && a->ctx) avcodec_flush_buffers(a->ctx); }
void vm_audio_close(VMAudioDecoder *a) {
    if (!a) return;
    swr_free(&a->swr);
    av_channel_layout_uninit(&a->swr_layout);
    av_free(a->out);
    av_frame_free(&a->frame); av_packet_free(&a->pkt);
    avcodec_free_context(&a->ctx);
    av_free(a);
}

// Subtitles -----------------------------------------------------------------------------

struct VMSubtitleDecoder {
    AVCodecContext *ctx;
    AVPacket *pkt;
    AVSubtitle sub;
    int has_sub;
    VMSubtitleRect *rects; int rect_capacity;
    uint32_t **bitmaps; int bitmap_count;
    double time_base;
};

VMSubtitleDecoder *vm_subtitle_open(VMDemuxer *d, int stream, char *error, int error_size) {
    if (!d || stream < 0 || stream >= (int)d->fmt->nb_streams) { say(error, error_size, "no such stream", 0); return NULL; }
    AVStream *st = d->fmt->streams[stream];
    const AVCodec *codec = avcodec_find_decoder(st->codecpar->codec_id);
    if (!codec) { say(error, error_size, "This subtitle format has no decoder", 0); return NULL; }
    VMSubtitleDecoder *s = av_mallocz(sizeof *s);
    s->ctx = avcodec_alloc_context3(codec); s->pkt = av_packet_alloc();
    if (!s->ctx || !s->pkt) { vm_subtitle_close(s); say(error, error_size, "out of memory", 0); return NULL; }
    avcodec_parameters_to_context(s->ctx, st->codecpar);
    s->ctx->pkt_timebase = st->time_base;
    s->time_base = av_q2d(st->time_base);
    int r = avcodec_open2(s->ctx, codec, NULL);
    if (r < 0) { say(error, error_size, "The subtitle decoder could not start", r); vm_subtitle_close(s); return NULL; }
    return s;
}

static void release_subtitle(VMSubtitleDecoder *s) {
    if (s->has_sub) { avsubtitle_free(&s->sub); s->has_sub = 0; }
    for (int i = 0; i < s->bitmap_count; i++) av_free(s->bitmaps[i]);
    av_freep(&s->bitmaps); s->bitmap_count = 0;
}

int vm_subtitle_decode(VMSubtitleDecoder *s, const uint8_t *data, int size, double pts, double duration, VMSubtitle *out) {
    release_subtitle(s);
    av_packet_unref(s->pkt);
    if (av_new_packet(s->pkt, size) < 0) return AVERROR(ENOMEM);
    memcpy(s->pkt->data, data, (size_t)size);
    s->pkt->pts = isnan(pts) ? AV_NOPTS_VALUE : llround(pts / s->time_base);
    s->pkt->dts = s->pkt->pts;
    s->pkt->duration = duration > 0 ? llround(duration / s->time_base) : 0;
    int got = 0;
    int r = avcodec_decode_subtitle2(s->ctx, &s->sub, &got, s->pkt);
    if (r < 0) return r == AVERROR_INVALIDDATA ? 1 : r;
    if (!got) return 1;
    s->has_sub = 1;
    AVSubtitle *sub = &s->sub;
    double base = sub->pts != AV_NOPTS_VALUE ? (double)sub->pts / AV_TIME_BASE : pts;
    out->start = base + sub->start_display_time / 1000.0;
    out->end = sub->end_display_time > sub->start_display_time && sub->end_display_time < 0x7fffffff ? base + sub->end_display_time / 1000.0
             : duration > 0 ? pts + duration : NAN;
    out->canvas_width = s->ctx->width; out->canvas_height = s->ctx->height;
    if ((int)sub->num_rects > s->rect_capacity) {
        av_free(s->rects);
        s->rects = av_calloc(sub->num_rects, sizeof *s->rects);
        s->rect_capacity = s->rects ? (int)sub->num_rects : 0;
        if (!s->rects) return AVERROR(ENOMEM);
    }
    s->bitmaps = sub->num_rects ? av_calloc(sub->num_rects, sizeof *s->bitmaps) : NULL;
    int count = 0;
    for (unsigned i = 0; i < sub->num_rects; i++) {
        AVSubtitleRect *r0 = sub->rects[i];
        VMSubtitleRect *o = &s->rects[count];
        memset(o, 0, sizeof *o);
        if (r0->type == SUBTITLE_BITMAP && r0->w > 0 && r0->h > 0 && r0->data[0] && r0->data[1] && s->bitmaps) {
            uint32_t *rgba = av_malloc((size_t)r0->w * (size_t)r0->h * 4);
            if (!rgba) continue;
            s->bitmaps[s->bitmap_count++] = rgba;
            const uint32_t *palette = (const uint32_t *)r0->data[1];
            uint8_t *dst = (uint8_t *)rgba;
            for (int y = 0; y < r0->h; y++) {
                const uint8_t *row = r0->data[0] + (size_t)y * (size_t)r0->linesize[0];
                for (int x = 0; x < r0->w; x++, dst += 4) {
                    uint32_t c = palette[row[x]]; // 0xAARRGGBB
                    unsigned alpha = c >> 24;
                    dst[0] = (uint8_t)(((c >> 16) & 0xff) * alpha / 255);
                    dst[1] = (uint8_t)(((c >> 8) & 0xff) * alpha / 255);
                    dst[2] = (uint8_t)((c & 0xff) * alpha / 255);
                    dst[3] = (uint8_t)alpha;
                }
            }
            o->x = r0->x; o->y = r0->y; o->width = r0->w; o->height = r0->h; o->rgba = rgba;
            count++;
        } else if (r0->type == SUBTITLE_ASS && r0->ass) {
            o->text = r0->ass; o->ass = 1; count++;
        } else if (r0->type == SUBTITLE_TEXT && r0->text) {
            o->text = r0->text; count++;
        }
    }
    out->count = count;
    out->rects = s->rects;
    return 0;
}

void vm_subtitle_flush(VMSubtitleDecoder *s) { if (s && s->ctx) avcodec_flush_buffers(s->ctx); }
const char *vm_subtitle_header(VMSubtitleDecoder *s) { return s && s->ctx && s->ctx->subtitle_header ? (const char *)s->ctx->subtitle_header : NULL; }
void vm_subtitle_close(VMSubtitleDecoder *s) {
    if (!s) return;
    release_subtitle(s);
    av_free(s->rects);
    av_packet_free(&s->pkt);
    avcodec_free_context(&s->ctx);
    av_free(s);
}
