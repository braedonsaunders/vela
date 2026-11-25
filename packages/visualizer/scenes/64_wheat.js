// ───────────────────────── Deep Forest: old trees, breathing canopy and shafts through leaves ─────────────────────────
{
// A single ray-cast landscape rather than a particle field: eighteen genuinely large trees stand at different
// depths, each with a trunk and overlapping crown. Bass travels through roots and trunks, mids move separate
// crown families, and highs catch individual leaves in the light. Nothing resets or shakes the camera.
const FS_FOREST = FSH + `
out vec4 o;

float sph(vec3 ro, vec3 rd, vec3 c, float r){
  vec3 q=ro-c; float b=dot(q,rd), h=b*b-dot(q,q)+r*r;
  return h>0.?-b-sqrt(h):1e4;
}
float trunk(vec3 ro, vec3 rd, vec2 c, float r, float h){
  vec2 q=ro.xz-c, d=rd.xz; float a=dot(d,d), b=dot(q,d), z=b*b-a*(dot(q,q)-r*r);
  if(z<=0.) return 1e4; float t=(-b-sqrt(z))/a, y=ro.y+t*rd.y;
  return t>0.&&y>-.12&&y<h?t:1e4;
}
vec3 treeBase(int i){
  float f=float(i), lane=mod(f,3.), row=floor(f/3.);
  float z=3.8+row*5.15+hash2(vec2(f,7.))*2.2;
  float x=(lane-1.)*(5.2+z*.16)+(hash2(vec2(f,3.))-.5)*4.1;
  return vec3(x,0.,z);
}
float bandLevel(float b){ return b<.34?uBandE.x:(b<.67?uBandE.y:uBandE.z); }
float bandHit(float b){ return b<.34?uHit.x:(b<.67?uHit.y:uHit.z); }

void main(){
  vec3 ro=uEye, rd=viewRay(); vec3 sun=normalize(vec3(-.42,.74,.52));
  float horizon=smoothstep(-.05,.48,rd.y);
  vec3 col=mix(vec3(.018,.035,.027),vec3(.19,.31,.27),horizon);
  col+=vec3(.52,.66,.42)*pow(max(dot(rd,sun),0.),28.)*.24;
  float best=1e4, typ=0., tid=0., leafN=0.; vec3 hitP=vec3(0.); float crownBand=0.;

  // Ground first: fern-dark earth with a long pool of daylight down the centre aisle.
  if(rd.y<-.001){
    float tg=-ro.y/rd.y; if(tg>0.){
      vec3 p=ro+rd*tg; best=tg; typ=1.; hitP=p;
      float moss=fbm(vec3(p.xz*.22,3.)), litter=noise(vec3(p.xz*3.8,8.));
      float aisle=exp(-p.x*p.x/(8.+p.z*.35));
      col=mix(vec3(.025,.045,.022),vec3(.11,.16,.055),moss)*(.62+.38*litter);
      col+=vec3(.36,.45,.16)*aisle*(.08+.42*uBandE.x+.5*uHitS.x)*exp(-p.z*.025);
    }
  }

  for(int i=0;i<18;i++){
    vec3 b=treeBase(i); float fi=float(i), h=5.7+hash2(vec2(fi,11.))*3.8, r=.22+.32*hash2(vec2(fi,13.));
    float family=fract(fi*.618+.17), sway=(.10+.24*uBandE.y+.32*uHitS.y)*sin(uTime*(.16+.05*family)+fi*2.1);
    vec3 shift=vec3(sway*(.35+.65*family),0.,sway*(family-.5)*.35);
    float tt=trunk(ro,rd,b.xz,r,h*.94);
    if(tt<best){ best=tt; typ=2.; tid=fi; hitP=ro+rd*tt; crownBand=family; }
    vec3 c=b+vec3(0.,h,0.)+shift;
    float t0=sph(ro,rd,c+vec3(-.42,.0,.05)*(1.+family),1.75+.72*family);
    float t1=sph(ro,rd,c+vec3(.65,.35,-.18),1.35+.55*(1.-family));
    float tc=min(t0,t1);
    if(tc>0.&&tc<best){ best=tc; typ=3.; tid=fi; hitP=ro+rd*tc; crownBand=family; leafN=noise(vec3(hitP*2.1+fi)); }
  }

  if(typ==2.){
    float bark=noise(vec3(hitP.xz*9.,hitP.y*2.8+tid)), grooves=noise(vec3(hitP.xz*31.,hitP.y*8.));
    vec3 barkC=mix(vec3(.045,.027,.016),vec3(.19,.105,.045),bark)*(.64+.36*grooves);
    float rootPulse=exp(-hitP.y*.34)*(uHitS.x*.72+uBandE.x*.32);
    col=barkC+vec3(.34,.19,.055)*rootPulse;
  } else if(typ==3.){
    float family=crownBand, lvl=bandLevel(family), strike=bandHit(family);
    vec3 dark=mix(vec3(.015,.075,.032),vec3(.055,.18,.065),leafN);
    vec3 fresh=mix(vec3(.12,.38,.09),vec3(.48,.56,.12),family);
    float facing=.25+.75*max(dot(normalize(hitP-treeBase(int(tid))),sun),0.);
    col=mix(dark,fresh,facing*(.26+.42*lvl));
    float leaf=pow(noise(vec3(hitP*13.+tid)),5.);
    col+=mix(vec3(.18,.6,.12),vec3(1.,.78,.22),family)*leaf*(.08+.75*lvl+1.4*strike);
    col*=.72+.28*noise(hitP*38.+vec3(0.,0.,tid));
  }

  // Shafts live in the gaps rather than flashing the whole frame. Mids open the canopy; highs glitter inside them.
  vec2 sp=gl_FragCoord.xy/uRes; float beamCell=floor((sp.x+.035*sin(uTime*.035))*13.);
  float beamSeed=hash2(vec2(beamCell,4.)), beamX=fract(sp.x*13.)-(.18+.55*beamSeed);
  float shaft=exp(-beamX*beamX*55.)*smoothstep(.08,.72,sp.y)*(1.-smoothstep(.76,1.,sp.y));
  shaft*=smoothstep(.42,.86,beamSeed)*(.035+.11*uBandE.y+.16*uHitS.y);
  col+=vec3(.62,.72,.36)*shaft;
  vec2 lc=floor(sp*uRes/vec2(17.,15.)), lp=fract(sp*uRes/vec2(17.,15.));
  vec2 seed=vec2(hash2(lc),hash2(lc+7.)); float fleck=exp(-dot(lp-seed,lp-seed)*210.)*step(.78,hash2(lc+13.));
  col+=vec3(1.,.82,.3)*fleck*(.035+.35*uBandE.z+1.15*uHit.z)*(shaft*3.+.12);
  float fog=1.-exp(-min(best,45.)*.018); col=mix(col,vec3(.12,.19,.13),fog*.42);
  o=vec4(col,best);
}`;

scene({ id: 'forest', name: 'Deep Forest', from: 'Organic', kind: 'nature', group: 'organic', pal: 3, hue: () => 0,
  about: 'An old forest opening into deep perspective: bass moves through roots and trunks, midrange phrases breathe through separate crowns, and high notes catch drifting leaves in broad shafts of sun',
  inputs: ['hit (low, mid, high)', 'bandE', 'hitS'],
  cost: 'Moderate: one full-screen pass ray-casting eighteen trunks and layered crowns. Phones render at the shared adaptive resolution.',
  post: { dof: { ap: 2.2, max: 5 }, bloom: 0.38, thr: 0.8, knee: 0.7, spread: 0.72, exp: 1.12, ca: 0.22, vig: 0.64, grain: 0.025, pulse: 0 },
  init(){ this.p=program(VS,FS_FOREST); },
  draw(F,out){
    const t=F.time, eye=[.35*Math.sin(t*.021),1.48,-2.2], target=[.2*Math.sin(t*.017),2.7,13.];
    const c=camera(eye,target,.84,.006*Math.sin(t*.027),.1,90); F.focus=10.5;
    draw(this.p,out,T.sw,T.sh,u=>{ F.set(u); setCam(u,c); });
  } });
}
