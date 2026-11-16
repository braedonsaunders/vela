/* SPDX-License-Identifier: LGPL-2.1-or-later
 * Vela general audio bridge. Separately linked with unmodified LGPL FFmpeg.
 * Exports WebGPU Player audio decoder ABI 1; source distributed with the module.
 */
#include <emscripten.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include "libavcodec/avcodec.h"
#include "libavutil/channel_layout.h"
#include "libavutil/intreadwrite.h"
#include "libavutil/log.h"
#include "libavutil/mem.h"
#include "libavutil/samplefmt.h"
#include "codec_ids.h"

typedef struct {
    const AVCodec *codec;
    AVCodecContext *context;
    AVPacket *packet;
    AVFrame *frame;
    float *planes;
    size_t capacity;
    int opened;
    uint32_t error, value;
} Decoder;
static int fail(Decoder *d, uint32_t error, uint32_t value) { d->error=error; d->value=value; return -1; }
static void release(Decoder *d) {
    if (!d) return;
    avcodec_free_context(&d->context); av_packet_free(&d->packet);
    av_frame_free(&d->frame); free(d->planes); free(d);
}
EMSCRIPTEN_KEEPALIVE uint32_t audio_decoder_abi_version(void) { return 1; }
EMSCRIPTEN_KEEPALIVE Decoder *audio_decoder_create(uint32_t index) {
    if (index >= sizeof(codec_ids)/sizeof(codec_ids[0])) return NULL;
    const AVCodec *codec=avcodec_find_decoder(codec_ids[index]);
    if (!codec) return NULL;
    av_log_set_level(AV_LOG_QUIET);
    Decoder *d=calloc(1,sizeof(*d)); if (!d) return NULL;
    d->codec=codec; d->context=avcodec_alloc_context3(codec);
    d->packet=av_packet_alloc(); d->frame=av_frame_alloc();
    if (!d->context || !d->packet || !d->frame) { release(d); return NULL; }
    d->context->pkt_timebase=(AVRational){1,1000000};
    return d;
}
EMSCRIPTEN_KEEPALIVE void audio_decoder_destroy(Decoder *d) { release(d); }
EMSCRIPTEN_KEEPALIVE uint8_t *audio_decoder_reserve_input(Decoder *d,uint32_t length) {
    av_packet_unref(d->packet);
    if (!length || length>2*1024*1024 || av_new_packet(d->packet,(int)length)<0) { fail(d,1,length); return NULL; }
    return d->packet->data;
}
static int open_decoder(Decoder *d) {
    int result=avcodec_open2(d->context,d->codec,NULL);
    if (result<0) return fail(d,7,(uint32_t)-result);
    d->opened=1; return 0;
}
EMSCRIPTEN_KEEPALIVE int audio_decoder_configure(Decoder *d,uint32_t length) {
    if (!d->packet->data || length>(uint32_t)d->packet->size || d->opened) return fail(d,1,length);
    const uint8_t *private=d->packet->data;
    uint32_t private_size=length;
    if (length>=32 && AV_RL32(private)==0x31414c56) {
        uint32_t rate=AV_RL32(private+4), channels=AV_RL32(private+8), mask=AV_RL32(private+12);
        uint32_t bits=AV_RL32(private+16), align=AV_RL32(private+20), bitrate=AV_RL32(private+24);
        private_size=AV_RL32(private+28);
        if (!rate || rate>768000 || !channels || channels>32 || bits>64 || align>INT32_MAX || private_size!=length-32)
            return fail(d,1,length);
        d->context->sample_rate=(int)rate; d->context->bits_per_coded_sample=(int)bits;
        d->context->block_align=(int)align; d->context->bit_rate=bitrate;
        if (mask) {
            if (av_channel_layout_from_mask(&d->context->ch_layout,mask)<0 || d->context->ch_layout.nb_channels!=(int)channels)
                return fail(d,6,mask);
        } else { d->context->ch_layout.order=AV_CHANNEL_ORDER_UNSPEC; d->context->ch_layout.nb_channels=channels; }
        private+=32;
    }
    if (private_size) {
        d->context->extradata=av_mallocz(private_size+AV_INPUT_BUFFER_PADDING_SIZE);
        if (!d->context->extradata) return fail(d,6,private_size);
        memcpy(d->context->extradata,private,private_size); d->context->extradata_size=(int)private_size;
    }
    return open_decoder(d);
}
EMSCRIPTEN_KEEPALIVE int audio_decoder_set_option(Decoder *d,uint32_t key,double value) { (void)value; return fail(d,5,key); }
EMSCRIPTEN_KEEPALIVE int audio_decoder_send(Decoder *d,uint32_t length,double timestamp) {
    if (!d->opened && open_decoder(d)<0) return -1;
    if (!d->packet->data || !length || length>(uint32_t)d->packet->size || !isfinite(timestamp) || timestamp< -9007199254740991.0 || timestamp>9007199254740991.0)
        return fail(d,1,length);
    d->packet->size=(int)length; d->packet->pts=d->packet->dts=(int64_t)timestamp;
    int result=avcodec_send_packet(d->context,d->packet); av_packet_unref(d->packet);
    if (!result) return 0;
    if (result==AVERROR_INVALIDDATA) return 1;
    return fail(d,2,(uint32_t)-result);
}
static int convert(Decoder *d) {
    AVFrame *f=d->frame;
    int channels=f->ch_layout.nb_channels, frames=f->nb_samples;
    if (channels<1 || channels>32 || frames<1 || frames>65536 || f->sample_rate<1 || f->sample_rate>768000)
        return fail(d,6,frames);
    size_t samples=(size_t)channels*frames;
    if (samples>d->capacity) {
        float *next=realloc(d->planes,samples*sizeof(float));
        if (!next) return fail(d,6,samples); d->planes=next; d->capacity=samples;
    }
    enum AVSampleFormat packed=av_get_packed_sample_fmt(f->format);
    int planar=av_sample_fmt_is_planar(f->format);
    for (int c=0;c<channels;c++) for (int i=0;i<frames;i++) {
        const uint8_t *data=f->extended_data[planar?c:0]; size_t at=planar?(size_t)i:(size_t)i*channels+c;
        double sample;
        switch (packed) {
            case AV_SAMPLE_FMT_U8: sample=((const uint8_t*)data)[at]/128.0-1.0; break;
            case AV_SAMPLE_FMT_S16: sample=((const int16_t*)data)[at]*0x1p-15; break;
            case AV_SAMPLE_FMT_S32: sample=((const int32_t*)data)[at]*0x1p-31; break;
            case AV_SAMPLE_FMT_S64: sample=(double)((const int64_t*)data)[at]*0x1p-63; break;
            case AV_SAMPLE_FMT_FLT: sample=((const float*)data)[at]; break;
            case AV_SAMPLE_FMT_DBL: sample=((const double*)data)[at]; break;
            default: return fail(d,4,f->format);
        }
        if (!isfinite(sample)) return fail(d,4,f->format);
        float output=(float)sample;
        if (!isfinite(output)) return fail(d,4,f->format);
        d->planes[(size_t)c*frames+i]=output;
    }
    return 0;
}
EMSCRIPTEN_KEEPALIVE int audio_decoder_receive(Decoder *d) {
    av_frame_unref(d->frame); if (!d->opened) return 0;
    int result=avcodec_receive_frame(d->context,d->frame);
    if (result==AVERROR(EAGAIN) || result==AVERROR_EOF) return 0;
    if (result<0) return fail(d,3,(uint32_t)-result);
    return convert(d)<0?-1:1;
}
EMSCRIPTEN_KEEPALIVE int audio_decoder_drain(Decoder *d) {
    if (!d->opened) return 0;
    int result=avcodec_send_packet(d->context,NULL);
    return result==AVERROR_EOF || result>=0?0:fail(d,2,(uint32_t)-result);
}
EMSCRIPTEN_KEEPALIVE uint32_t audio_decoder_frame_count(Decoder *d) { return d->frame->nb_samples; }
EMSCRIPTEN_KEEPALIVE uint32_t audio_decoder_sample_rate(Decoder *d) { return d->frame->sample_rate; }
EMSCRIPTEN_KEEPALIVE uint32_t audio_decoder_channel_count(Decoder *d) { return d->frame->ch_layout.nb_channels; }
EMSCRIPTEN_KEEPALIVE uint32_t audio_decoder_channel_mask(Decoder *d) {
    AVChannelLayout *layout=&d->frame->ch_layout;
    /* Do not guess a multichannel layout by count. Stereo and mono are unambiguous. */
    if (layout->order==AV_CHANNEL_ORDER_NATIVE && !(layout->u.mask>>32)) return layout->u.mask;
    if (layout->nb_channels==1) return 4;
    if (layout->nb_channels==2) return 3;
    return 0;
}
EMSCRIPTEN_KEEPALIVE float *audio_decoder_channel_pointer(Decoder *d,uint32_t channel) {
    return channel<(uint32_t)d->frame->ch_layout.nb_channels?d->planes+(size_t)channel*d->frame->nb_samples:NULL;
}
EMSCRIPTEN_KEEPALIVE double audio_decoder_timestamp(Decoder *d) { return d->frame->pts==AV_NOPTS_VALUE?-1.0:(double)d->frame->pts; }
EMSCRIPTEN_KEEPALIVE double audio_decoder_attribute(Decoder *d,uint32_t key) { (void)d; return key==1?(double)avcodec_version():__builtin_nan(""); }
EMSCRIPTEN_KEEPALIVE void audio_decoder_clear(Decoder *d) {
    av_packet_unref(d->packet); av_frame_unref(d->frame);
    if (d->opened) avcodec_flush_buffers(d->context);
}
EMSCRIPTEN_KEEPALIVE uint32_t audio_decoder_error_code(Decoder *d) { return d->error; }
EMSCRIPTEN_KEEPALIVE uint32_t audio_decoder_error_value(Decoder *d) { return d->value; }
