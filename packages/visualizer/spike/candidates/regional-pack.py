from pathlib import Path
import base64, json, math, re
from collections import defaultdict
root=Path(__file__).parent
source=(root/'base.js').read_text()
def array(name):
    return json.loads(re.search('const '+name+r'\s*=\s*(\[.*?\]);',source).group(1))
tour=array('TOUR')
# Keep the major-place legend in its existing order, adding local candidates near the tour.
major=array('CITIES')
names={(name,lon,lat) for name,lon,lat in major}
def along_route(x,y):
    for (x0,y0),(x1,y1) in zip(tour,tour[1:]):
        lon=x+360*round(((x0+x1)*.5-x)/360)
        c=max(.45,math.cos(math.radians(y)))
        dx,dy=(x1-x0)*c,y1-y0
        t=max(0,min(1,((lon-x0)*c*dx+(y-y0)*dy)/(dx*dx+dy*dy)))
        if abs(y-(y0+t*dy))<=4.4 and abs(c*(lon-x0)-t*dx)<=7.5:return True
    return False
extra=[]
for f in sorted(json.loads((root/'inputs/cities.json').read_text())['features'],key=lambda f:-f['properties']['pop_max']):
    q=f['properties']; item=(q['name'],round(q['longitude'],2),round(q['latitude'],2))
    if item not in names and along_route(item[1],item[2]):extra.append(item);names.add(item)
cities=major+extra
(root/'cities-ordered.json').write_text(json.dumps(cities,ensure_ascii=False,separators=(',',':')))
print('city counts',len(major),len(extra),len(cities))
def simplify(p):
    if len(p)<3:return p
    (x,y),(x1,y1)=p[0],p[-1];dx=x1-x;dy=y1-y;den=dx*dx+dy*dy or 1
    best=0;at=1
    for i,(a,b) in enumerate(p[1:-1],1):
        t=max(0,min(1,((a-x)*dx+(b-y)*dy)/den))
        d=(a-x-dx*t)**2+(b-y-dy*t)**2
        if d>best:best=d;at=i
    return [p[0],p[-1]] if best<.010**2 else simplify(p[:at+1])[:-1]+simplify(p[at:])
payload=bytearray()
def uint(n):
    while n>=128:payload.append((n%128)|128);n//=128
    payload.append(n)
nr=0;pts=0
for f in json.loads((root/'inputs/river50.json').read_text())['features']:
    g=f['geometry']
    for path in (g['coordinates'] if g['type']=='MultiLineString' else [g['coordinates']]):
        line=[]
        for a,b in simplify(path):
            xy=(round((a+180)*400), round((b+90)*400))
            if not line or xy!=line[-1]:line.append(xy)
        if len(line)<2:continue
        nr+=1;pts+=len(line)
        uint(len(line)); x=y=0
        for xx,yy in line:
            for d in (xx-x,yy-y):uint(d*2 if d>=0 else -d*2-1)
            x,y=xx,yy
(root/'river-data.txt').write_text(base64.b64encode(payload).decode())
print(nr,'paths',pts,'vertices',len(payload),'binary bytes')
