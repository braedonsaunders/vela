from pathlib import Path
import json,math,base64,gzip
s=Path('round6/src/33_contour.js').read_text()
raw=bytearray()
def uint(n):
 while n>=128:raw.append((n&127)|128);n>>=7
 raw.append(n)
def simplify(points):
 if len(points)<3:return points
 x,y=points[0];xx,yy=points[-1];dx,dy=xx-x,yy-y; div=dx*dx+dy*dy or 1
 best=-1; at=0
 for i,(a,b) in enumerate(points[1:-1],1):
  t=min(1,max(0,((a-x)*dx+(b-y)*dy)/div));d=(a-x-dx*t)**2+(b-y-dy*t)**2
  if d>best:best,at=d,i
 if best<=.09**2:return [points[0],points[-1]]
 return simplify(points[:at+1])[:-1]+simplify(points[at:])
features=json.load(open('round7-work/river50.json'))['features']
selected=[f for f in features if f['properties']['scalerank']<=4]
for f in selected:
 g=f['geometry']
 for line in (g['coordinates'] if g['type']=='MultiLineString' else [g['coordinates']]):
  pts=list(dict.fromkeys((round((x+180)*8),round((y+90)*8)) for x,y in simplify(line)))
  if len(pts)<2:continue
  uint(len(pts));x=y=0
  for a,b in pts:
   for d in [a-x,b-y]:uint(2*d if d>=0 else -2*d-1)
   x,y=a,b
uint(0)
cities=json.load(open('round6-work/cities.json'))['features']
for f in cities:
 x,y=f['geometry']['coordinates'];uint(round((x+180)*8));uint(round((y+90)*8))
packed=base64.b64encode(raw).decode()
start=s.index('  const alphabet');end=s.index('  const ids =',start)
decode=s[start:end].replace('WORLD_RINGS','data')
s=s[:start]+'''  const {uint,delta,remaining}=atlasReader(WORLD_RINGS);
'''+s[end:]
s=s.replace('while (cursor < count)', 'while (remaining())')
helper='\nconst HYDROGRAPHY="'+packed+'";\nfunction atlasReader(data){\n'+decode+'''  return {uint,delta,remaining:()=>cursor<count};
}
function hydroTexture(){
  const {uint,delta,remaining}=atlasReader(HYDROGRAPHY);
  const w=1440,h=720, pixels=new Uint8Array(w*h*2);
  function mark(x,y,channel,coverage){
    if(x<0||x>=w||y<0||y>=h)return;
    const i=(y*w+x)*2+channel;
    pixels[i]=Math.max(pixels[i],Math.round(255*coverage));
  }
  for(let n=uint();n;n=uint()){
    let x=0,y=0;
    for(let k=0;k<n;k++){
      const a=x,b=y;x+=delta()/2;y+=delta()/2;
      if(k===0 || Math.abs(x-a)>w/2)continue;
      const steps=Math.max(1,Math.ceil(Math.hypot(x-a,y-b)*1.6));
      for(let j=0;j<=steps;j++){
        const px=a+(x-a)*j/steps,py=b+(y-b)*j/steps,ix=Math.floor(px),iy=Math.floor(py);
        for(let yy=iy;yy<=iy+1;yy++)for(let xx=ix;xx<=ix+1;xx++)
          mark(xx,yy,0,(1-Math.abs(xx-px))*(1-Math.abs(yy-py)));
      }
    }
  }
  while(remaining())mark(Math.round(uint()/2),Math.round(uint()/2),1,1);
  const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RG8,w,h,0,gl.RG,gl.UNSIGNED_BYTE,pixels);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  return tex;
}
'''
s=s.replace('function worldMapTexture()',helper+'\nfunction worldMapTexture()')
s=s.replace('uMap,uText;', 'uMap,uText,uHydro;').replace('const span=34+9','const span=14+8')
s=s.replace('  float d=length(q), survey=', '''  vec2 hydro=texture(uHydro,uv+vec2(.5/1440.,.5/720.)).rg;
  float river=smoothstep(.04,.61,hydro.r), village=smoothstep(.12,.78,hydro.g);
  float voice=spec(fract(m.y*.036+m.x*.014));
  col=mix(col,vec3(.04,.17,.22),river*.88);
  col+=river*vec3(.11,.52,.61)*(.25+voice*voice*1.7);
  col=mix(col,vec3(.35,.075,.025),village*.85);
  vec2 minorGrid=abs(fract(m/2.+.5)-.5)*2./max(fwidth(m),vec2(.001));
  col*=1.-.065*(1.-smoothstep(.2,1.2,min(minorGrid.x,minorGrid.y)));
  float d=length(q), survey=''')
s=s.replace('this.map=worldMapTexture();','this.map=worldMapTexture();this.hydro=hydroTexture();')
s=s.replace('bindTex(4,this.text.t);','bindTex(5,this.hydro);gl.uniform1i(u.uHydro,5);bindTex(4,this.text.t);')
Path('src/33_contour.js').write_text(s)
print(len(selected),'river features;',len(cities),'places;',len(packed),'embedded bytes,',len(gzip.compress(packed.encode())),'gzip')
