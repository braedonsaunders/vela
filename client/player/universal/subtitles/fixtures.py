from pathlib import Path
from struct import pack
import argparse, subprocess
parser=argparse.ArgumentParser(description='Generate public synthetic subtitle fixtures; optional generated AVC input is remuxed locally.')
parser.add_argument('--output',required=True)
parser.add_argument('--video')
parser.add_argument('--font')
args=parser.parse_args()
root=Path(args.output);root.mkdir(parents=True,exist_ok=True)
(root/'sample.srt').write_text('1\n00:00:01,000 --> 00:00:03,000\n<b>Vela bold</b> and <i>italic</i>\nSecond line &amp; symbols\n\n2\n00:00:04,000 --> 00:00:07,000\n<font color="yellow">Seek-safe subtitle</font>\n')
(root/'sample.vtt').write_text('WEBVTT\n\nfirst\n00:01.000 --> 00:03.000 align:center position:50%\n<b>Vela styled VTT</b>\n\n00:04.000 --> 00:07.000 line:20% align:start\n<c.yellow>Positioned caption</c>\n')
(root/'sample.ass').write_text('''[Script Info]
ScriptType: v4.00+
PlayResX: 640
PlayResY: 360
WrapStyle: 0
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans,26,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,20,1
Style: Sign,Noto Sans,32,&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,8,20,20,20,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Vela {\\i1}styled{\\i0} ASS
Dialogue: 1,0:00:04.00,0:00:07.00,Sign,,0,0,0,,{\\pos(320,60)\\fad(200,200)}Positioned yellow sign
''')
def seg(kind,data,time):return b'PG'+pack('>II',round(time*90000),round(time*90000))+pack('>BH',kind,len(data))+data
def pcs(time,show,epoch=False):
 data=pack('>HHBHBBBB',640,360,0x10,0,0x80 if epoch else 0,0,0,1 if show else 0)
 if show:data+=pack('>HBBHH',0,0,0,210,280)
 return seg(0x16,data,time)
# A rectangular caption image, with a transparent margin and opaque glyph bars.
w,h=220,32
rle=bytearray()
for y in range(h):
 row=[1 if (4<=y<28 and x%20 in range(3,15)) else 0 for x in range(w)]
 x=0
 while x<w:
  color=row[x];end=x+1
  while end<w and row[end]==color:end+=1
  run=end-x
  if run==1 and color:rle.append(color)
  elif run<64:rle.extend([0,0x80|run,color])
  else:rle.extend([0,0xc0|(run>>8),run&255,color])
  x=end
 rle.extend([0,0])
ods=pack('>HBB',0,0,0xc0)+(len(rle)+4).to_bytes(3,'big')+pack('>HH',w,h)+rle
palette=bytes([0,0,0,16,128,128,0,1,235,128,128,255])
show=pcs(1,True,True)+seg(0x17,bytes([1])+pack('>BHHHH',0,210,280,w,h),1)+seg(0x14,palette,1)+seg(0x15,ods,1)+seg(0x80,b'',1)
clear=pcs(3,False)+seg(0x80,b'',3)
show2=pcs(4,True)+seg(0x80,b'',4)
clear2=pcs(7,False)+seg(0x80,b'',7)
(root/'sample.sup').write_bytes(show+clear+show2+clear2)
print('Generated SRT, VTT, ASS and PGS/SUP fixtures')

if args.video:
    for name,extension,codec in [('srt','mkv','copy'),('ass','mkv','copy'),('sup','mkv','copy'),('srt','mp4','mov_text')]:
        output=root/({'srt':'tx3g' if extension=='mp4' else 'srt','ass':'ass-font','sup':'pgs'}[name]+'.'+extension)
        command=['ffmpeg','-hide_banner','-loglevel','error','-i',args.video,'-i',str(root/('sample.'+name)),'-map','0','-map','1','-c:v','copy','-c:a','copy','-c:s',codec,'-metadata:s:s:0','language=eng']
        if name=='ass' and args.font: command+=['-attach',args.font,'-metadata:s:t:0','mimetype=application/x-truetype-font','-metadata:s:t:0','filename=NotoSans.ttf']
        subprocess.run(command+[str(output)],check=True)
