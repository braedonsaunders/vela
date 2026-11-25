# Quantize Natural Earth's 1:110m country rings to 1/8 degree and delta-code each ring.
import base64,gzip,json
from pathlib import Path
raw=bytearray()
def uint(n):
 while n>=128:
  raw.append((n&127)|128); n>>=7
 raw.append(n)
countries=json.loads(Path('countries.json').read_text())['features']
for country,feature in enumerate(countries,1):
 g=feature['geometry']
 for polygon in (g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]):
  for i,ring in enumerate(polygon):
   points=[]
   for lon,lat in ring:
    p=round((lon+180)*8),round((lat+90)*8)
    if not points or points[-1]!=p: points.append(p)
   if len(points)<4: continue
   uint(country if i==0 else 0); uint(len(points)); x=y=0
   for a,b in points:
    for delta in [a-x,b-y]: uint(delta*2 if delta>=0 else -delta*2-1)
    x,y=a,b
places=sorted((f['properties'] for f in json.loads(Path('cities.json').read_text())['features']),key=lambda c: (not c['adm0cap'], -c['pop_max']))
cities=[[c['name'],round(c['longitude'],2),round(c['latitude'],2)] for c in places if c['adm0cap'] or c['pop_max']>=900000 or c['scalerank']<=2]
data='// Public-domain Natural Earth countries (1:110m) and populated places (1:50m).\nconst WORLD_RINGS = '+json.dumps(base64.b64encode(raw).decode())+';\nconst CITIES = '+json.dumps(cities,ensure_ascii=False,separators=(',',':'))+';\n'
Path('packed.txt').write_text(data)
print(len(countries),len(cities),len(data.encode()),len(gzip.compress(data.encode())))
