// LGPL libmpv render API. mpv's built-in X11 VO is GPL and must not be used.
#include <mpv/client.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavfilter/avfilter.h>
#include <libavutil/avutil.h>
#include <libswresample/swresample.h>
#include <libswscale/swscale.h>
#include <mpv/render_gl.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/extensions/shape.h>
#include <EGL/egl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/select.h>
#include <unistd.h>
#include <fcntl.h>
static void *get_proc(void *ctx, const char *name) { (void)ctx; return (void *)eglGetProcAddress(name); }
static void wake(void *ctx) { int fd=*(int *)ctx; char c=1; (void)write(fd,&c,1); }
int main(int argc, char **argv) {
    if (!strstr(avformat_license(),"LGPL") || !strstr(avfilter_license(),"LGPL") || !strstr(avutil_license(),"LGPL") || !strstr(swresample_license(),"LGPL") || !strstr(swscale_license(),"LGPL") || !strstr(avcodec_license(),"LGPL") || strstr(avcodec_configuration(),"--enable-gpl") || strstr(avcodec_configuration(),"--enable-nonfree")) return 11;
    if (argc==2 && !strcmp(argv[1],"--audit")) return 0;
    int probe=argc==2 && !strcmp(argv[1],"--probe");
    if (!probe && argc!=3) return 2;
    Display *display=XOpenDisplay(NULL); if (!display) return 3;
    char selection[64]; snprintf(selection,sizeof(selection),"_NET_WM_CM_S%d",DefaultScreen(display));
    if (XGetSelectionOwner(display,XInternAtom(display,selection,False))==None) { XCloseDisplay(display); return 10; }
    if (probe) { XCloseDisplay(display); return 0; }
    EGLDisplay egl=eglGetDisplay((EGLNativeDisplayType)display);
    if (!eglInitialize(egl,NULL,NULL) || !eglBindAPI(EGL_OPENGL_API)) return 4;
    EGLint config_attrs[]={EGL_SURFACE_TYPE,EGL_WINDOW_BIT,EGL_RENDERABLE_TYPE,EGL_OPENGL_BIT,EGL_RED_SIZE,8,EGL_GREEN_SIZE,8,EGL_BLUE_SIZE,8,EGL_NONE};
    EGLConfig config; EGLint count,visual_id;
    if (!eglChooseConfig(egl,config_attrs,&config,1,&count) || count<1) return 4;
    eglGetConfigAttrib(egl,config,EGL_NATIVE_VISUAL_ID,&visual_id);
    XVisualInfo wanted={.visualid=(VisualID)visual_id}; int matches;
    XVisualInfo *visual=XGetVisualInfo(display,VisualIDMask,&wanted,&matches);
    if (!visual) return 4;
    Window above=strtoul(argv[1],NULL,10), root=DefaultRootWindow(display);
    Colormap cmap=XCreateColormap(display,root,visual->visual,AllocNone);
    XSetWindowAttributes attrs={.override_redirect=True,.background_pixel=0,.colormap=cmap,.border_pixel=0};
    Window surface=XCreateWindow(display,root,0,0,1,1,0,visual->depth,InputOutput,visual->visual,CWOverrideRedirect|CWBackPixel|CWColormap|CWBorderPixel,&attrs);
    XFree(visual);
    int shape_event,shape_error;
    if (!XShapeQueryExtension(display,&shape_event,&shape_error)) return 4;
    XShapeCombineRectangles(display,surface,ShapeInput,0,0,NULL,0,ShapeSet,Unsorted);
    EGLContext context=eglCreateContext(egl,config,EGL_NO_CONTEXT,NULL);
    EGLSurface target=eglCreateWindowSurface(egl,config,(EGLNativeWindowType)surface,NULL);
    if (context==EGL_NO_CONTEXT || target==EGL_NO_SURFACE || !eglMakeCurrent(egl,target,target,context)) return 4;
    mpv_handle *mpv=mpv_create(); if (!mpv) return 5;
    const char *options[][2]={
        {"config","no"},{"load-scripts","no"},{"terminal","no"},
        {"input-default-bindings","no"},{"input-vo-keyboard","no"},
        {"vo","libmpv"},{"hwdec","auto-safe"},{"gpu-sw","yes"},
        {"tone-mapping","bt.2390"},{"target-trc","srgb"},{"target-prim","bt.709"},
        {"audio-spdif","ac3,eac3,dts,dts-hd,truehd"},{"network-timeout","20"},
        {"speed","1"},{"idle","yes"},{"input-ipc-server",argv[2]}
    };
    for (size_t i=0;i<sizeof(options)/sizeof(options[0]);i++)
        if (mpv_set_option_string(mpv,options[i][0],options[i][1])<0) { fprintf(stderr,"Unsupported option: %s\n",options[i][0]); return 6; }
    if (mpv_initialize(mpv)<0) return 7;
    mpv_opengl_init_params gl={.get_proc_address=get_proc};
    mpv_render_param params[]={
        {MPV_RENDER_PARAM_API_TYPE,MPV_RENDER_API_TYPE_OPENGL},
        {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,&gl},
        {MPV_RENDER_PARAM_X11_DISPLAY,display},{MPV_RENDER_PARAM_INVALID,NULL}
    };
    mpv_render_context *render;
    if (mpv_render_context_create(&render,mpv,params)<0) { mpv_terminate_destroy(mpv); return 8; }
    int notify[2]; if (pipe(notify)) return 9;
    fcntl(notify[0],F_SETFL,O_NONBLOCK); fcntl(notify[1],F_SETFL,O_NONBLOCK);
    mpv_render_context_set_update_callback(render,wake,&notify[1]);
    mpv_set_wakeup_callback(mpv,wake,&notify[1]);
    setvbuf(stdin,NULL,_IONBF,0); puts("ready"); fflush(stdout);
    int width=1,height=1,shown=0,running=1;
    while (running) {
        fd_set readfds; FD_ZERO(&readfds); FD_SET(0,&readfds); FD_SET(notify[0],&readfds);
        struct timeval timeout={.tv_sec=0,.tv_usec=16000};
        if (select(notify[0]+1,&readfds,NULL,NULL,&timeout)<0) break;
        if (FD_ISSET(0,&readfds)) {
            char line[256]; int x,y,w,h;
            if (!fgets(line,sizeof(line),stdin) || sscanf(line,"%d %d %d %d",&x,&y,&w,&h)!=4) break;
            shown=w>0 && h>0;
            if (!shown) XUnmapWindow(display,surface);
            else {
                width=w; height=h; XMoveResizeWindow(display,surface,x,y,(unsigned)w,(unsigned)h);
                XWindowChanges changes={.sibling=above,.stack_mode=Below};
                XConfigureWindow(display,surface,CWSibling|CWStackMode,&changes); XMapWindow(display,surface);
            }
            XFlush(display);
        }
        char buf[256]; while (read(notify[0],buf,sizeof(buf))>0) {}
        while (1) { mpv_event *event=mpv_wait_event(mpv,0); if (event->event_id==MPV_EVENT_NONE) break; if (event->event_id==MPV_EVENT_SHUTDOWN) running=0; }
        uint64_t flags=mpv_render_context_update(render);
        if (shown && (flags&MPV_RENDER_UPDATE_FRAME)) {
            mpv_opengl_fbo fbo={.fbo=0,.w=width,.h=height}; int flip=1;
            mpv_render_param frame[]={{MPV_RENDER_PARAM_OPENGL_FBO,&fbo},{MPV_RENDER_PARAM_FLIP_Y,&flip},{MPV_RENDER_PARAM_INVALID,NULL}};
            mpv_render_context_render(render,frame); eglSwapBuffers(egl,target); mpv_render_context_report_swap(render);
        }
    }
    mpv_set_wakeup_callback(mpv,NULL,NULL); mpv_render_context_set_update_callback(render,NULL,NULL);
    mpv_render_context_free(render); mpv_terminate_destroy(mpv); close(notify[0]); close(notify[1]);
    eglMakeCurrent(egl,EGL_NO_SURFACE,EGL_NO_SURFACE,EGL_NO_CONTEXT); eglDestroySurface(egl,target); eglDestroyContext(egl,context); eglTerminate(egl);
    XDestroyWindow(display,surface); XFreeColormap(display,cmap); XCloseDisplay(display); return 0;
}
