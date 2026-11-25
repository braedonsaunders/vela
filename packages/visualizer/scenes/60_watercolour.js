
// ═════════════════════════ Organic scenes ═════════════════════════
// ───────────────────────── Watercolour: wet paint blooming and bleeding on cold-pressed paper ─────────────────────────
{
// A small simulation on a 960×600 sheet: three pigments and the wetness of the paper. Wet paint drifts and
// spreads; where a new drop lands it pushes the wash outward; pigment fades slowly so the sheet keeps renewing.
// The picture is paper seen through the paint (pigments subtract light), with the pigment gathered at the
// edges of each wash and settled into the tooth of the paper, the way real watercolour dries.
const WC_W = 960, WC_H = 600;
const WC_PAINT = `
vec3 paintOf(float k){ k = mod(k, 3.); return clamp(vec3(max(1.-abs(k), 1.-abs(k-3.)), 1.-abs(k-1.), 1.-abs(k-2.)), 0., 1.); }`;
// Three kinds of mark, one for each part of the music:
//   washes   low frequencies (every kick): big, pale, wet, with no edge to speak of; they bleed and merge
//   strokes  mids (every note that starts): a loaded brush drawn quickly across the sheet, bristle-streaked,
//            running dry toward its end; its colour comes from the pitch of the note
//   dots     highs: single dots on the hats, a flicked splatter on the snares
const FS_WC_SIM = HEAD + LIB + WC_PAINT + `
in vec2 uv; out vec4 o;
uniform sampler2D uState; uniform float uDt; uniform float uWashAge[8]; uniform vec4 uDropP[8], uSpl[4], uStk[6], uStk2[6], uDot[8];
const float ASP = 1.6, DUR = .5;
float psi(vec2 p){ return noise(vec3(p*3.2, uTime*.05)); }
float land(float a){ return exp(-a*12.)*3.6; }           // paint leaves the brush over a moment, never all at once
void main(){
  vec2 p = uv*vec2(ASP, 1.), tx = 1./vec2(${WC_W}., ${WC_H}.); const float e = .02;
  // wet paint wanders: a slow, divergence-free drift; each fresh wash pushes outward from where it lands
  vec2 v = vec2(psi(p+vec2(0.,e))-psi(p-vec2(0.,e)), psi(p-vec2(e,0.))-psi(p+vec2(e,0.)))/(2.*e)*.011*(.5+uMidS);
  for (int i = 0; i < 8; i++){ float a = uWashAge[i]; if (a > 1.2) continue; vec2 d = (uv-uDropP[i].xy)*vec2(ASP, 1.); float R = uDropP[i].z;
    v += d/(length(d)+1e-4)*exp(-dot(d,d)/(R*R*1.6))*smoothstep(0.,.1,a)*(1.-smoothstep(.2,1.,a))*.09; }
  float wet0 = texture(uState, uv).a;
  vec2 src = uv-v/vec2(ASP, 1.)*uDt*(.25+wet0);
  vec4 s = texture(uState, src);
  vec4 av = (texture(uState, src+vec2(tx.x*1.5,0.))+texture(uState, src-vec2(tx.x*1.5,0.))+texture(uState, src+vec2(0.,tx.y*1.5))+texture(uState, src-vec2(0.,tx.y*1.5)))*.25;
  float k = clamp(s.a*uDt*24., 0., .6); s.rgb = mix(s.rgb, av.rgb, k); s.a = mix(s.a, av.a, k*.6);      // wet-in-wet: paint spreads where the paper is wet
  // washes
  for (int i = 0; i < 8; i++){ float a = uWashAge[i]; if (a > .7) continue; vec2 d = (uv-uDropP[i].xy)*vec2(ASP, 1.); float r = length(d);
    float R=uDropP[i].z*(1.+.62*uBandE.x), seed=uDropP[i].w;
    float theta=atan(d.y,d.x), petal=.5+.5*sin(theta*9.+seed+1.5*sin(theta*3.+seed));
    float jag=.66+.25*petal+.22*noise(vec3(d*22.,seed));
    float rr=r/max(.001,R*jag);
    float reach=.55+.60*(1.-exp(-a*23.)), crown=exp(-pow((rr-reach)/.13,2.));
    float wet=(1.-smoothstep(reach*.48,reach,rr));
    float hit=exp(-a*18.)*(wet*1.4+crown*.95)*(1.+.7*uBandE.x);
    vec3 centre=paintOf(seed), fringe=paintOf(seed+.85+petal*.42);
    vec3 pigment=mix(centre,fringe,smoothstep(.13,.99,rr))*(.82+.37*petal);
    // Replace some previous pigment where the drop pushes a wet layer aside.
    s.rgb=mix(s.rgb,pigment*2.05,clamp(hit*uDt*23.,0.,.86));
    vec2 fleckGrid=d/(R+.0001)*13., cell=floor(fleckGrid);
    vec2 offset=fract(fleckGrid)-vec2(hash2(cell+seed),hash2(cell+seed+3.));
    float spatter=exp(-dot(offset,offset)*31.)*step(.72,hash2(cell+seed+9.))*smoothstep(.50,.9,rr)*(1.-smoothstep(1.,1.7,rr));
    s.rgb+=fringe*spatter*exp(-a*23.)*uDt*27.;
    s.a=max(s.a,wet*.72);
  }
  // Each note prints the edges of a small faceted stone. Some facets share a translucent wash.
  // Compute segment distance analytically so even a single slow frame leaves a connected mark.
  for (int i=0;i<6;i++){
    float age=uStk[i].w; if(age>.22) continue;
    vec2 d=rot(uStk[i].z)*(p-uStk[i].xy*vec2(ASP,1.));
    float radius=.043+uStk2[i].x*.32;
    d/=radius; d.y*=1.1+abs(uStk2[i].z)*.7;
    if(dot(d,d)>2.2) continue;
    float seed=uStk2[i].w*8.3, sides=4.+floor(fract(seed)*4.);
    float angle=mod(atan(d.y,d.x)+TAU,TAU), wedge=TAU/sides, ix=floor(angle/wedge);
    float a0=ix*wedge, a1=(ix+1.)*wedge;
    vec2 v0=vec2(cos(a0),sin(a0))*(.68+.32*hash2(vec2(ix,seed)));
    vec2 v1=vec2(cos(a1),sin(a1))*(.68+.32*hash2(vec2(mod(ix+1.,sides),seed)));
    vec2 edge=v1-v0;
    float outside=-(edge.x*(d.y-v0.y)-edge.y*(d.x-v0.x))/length(edge);
    vec2 hub=.19*vec2(cos(seed),sin(seed));
    vec2 rib=v0-hub;
    float seam=length(d-hub-rib*clamp(dot(d-hub,rib)/dot(rib,rib),0.,1.));
    float fibre=.72+.28*noise(vec3(p*175.,seed));
    float outline=exp(-abs(outside)*34.)+exp(-seam*46.)*(1.-smoothstep(-.02,.02,outside))*.72;
    float tint=(1.-smoothstep(-.02,.02,outside))*(.04+.16*hash2(vec2(ix,seed+1.)));
    float mark=(outline+tint)*fibre*exp(-age*27.)*min(uDt*37.,1.);
    s.rgb+=paintOf(seed+ix*.12)*mark; s.a=max(s.a,mark*.14);
  }
  // dots (hats) and splatter (snares)
  for (int i = 0; i < 8; i++){ float a = uDot[i].w; if (a > .4) continue; float dd = length((uv-uDot[i].xy)*vec2(ASP, 1.))/uDot[i].z;
    s.rgb += (paintOf(float(i)*1.3)*.6+.5)*smoothstep(1., .7, dd)*land(a)*uDt*9.; s.a = max(s.a, smoothstep(1.3, .8, dd)*.3*smoothstep(0.,.1,a)); }
  for (int j = 0; j < 4; j++){ float a = uSpl[j].w; if (a > .5) continue; vec2 q = (uv-uSpl[j].xy)*vec2(ASP, 1.)/.03, c = floor(q); float sd = uSpl[j].z;
    float h = hash2(c+sd*17.), keep = step(.74, h)*smoothstep(8., 1., length(c)+3.*hash2(c+sd*5.));
    float dd = length(q-c-.12-.76*vec2(hash2(c+sd), hash2(c+sd+3.)));
    s.rgb += paintOf(sd*3.+h)*smoothstep(.12+.3*h, .04, dd)*keep*land(a)*uDt*7.; s.a = max(s.a, smoothstep(.5, .1, dd)*keep*.5*smoothstep(0.,.1,a)); }
  s.a = max(s.a-uDt*.04, 0.);                                              // the paper dries
  s.rgb = min(s.rgb*exp(-uDt*.018), vec3(3.));                             // and old paint fades, so the sheet keeps renewing
  o = s;
}`;
const FS_WC = FSH + COVER + `
out vec4 o; uniform sampler2D uState;
float tooth(vec2 p){ return noise(vec3(p*150., 1.))*.45+noise(vec3(p*64., 5.))*.35+noise(vec3(p*vec2(22., 300.), 9.))*.2; }
void main(){
  vec2 uv = cover(gl_FragCoord.xy/uRes, 1.6), p = uv*vec2(1.6, 1.), e = 1.5/vec2(${WC_W}., ${WC_H}.);
  vec4 s = texture(uState, uv);
  vec3 gx = texture(uState, uv+vec2(e.x,0.)).rgb-texture(uState, uv-vec2(e.x,0.)).rgb, gy = texture(uState, uv+vec2(0.,e.y)).rgb-texture(uState, uv-vec2(0.,e.y)).rgb;
  float th = tooth(p), dens = dot(s.rgb, vec3(1.)), edge = length(vec2(dot(gx, vec3(1.)), dot(gy, vec3(1.))));
  vec3 pig = s.rgb*(1.+(.5-th)*.6*(1.-.6*s.a)) + s.rgb/max(dens, 1e-3)*edge*2.6*(1.-.5*s.a);   // settled in the hollows, gathered at the edges
  // three paints; what they do not absorb is what you see
  vec3 c0 = mix(vec3(.1,.24,.7), neon(.0), .1), c1 = mix(vec3(.82,.13,.27), neon(.33), .1), c2 = mix(vec3(.96,.66,.14), neon(.66), .1);
  vec3 T = exp(-(pig.r*-log(max(c0, .04))+pig.g*-log(max(c1, .04))+pig.b*-log(max(c2, .04)))*.85);
  vec3 paper = vec3(.93,.905,.85)*(.9+.14*th)*(1.-.07*s.a);
  paper *= .97+.03*noise(vec3(p*vec2(3., 60.), 3.));                         // faint laid lines
  vec2 q = gl_FragCoord.xy/uRes-.5;
  o = vec4(paper*T*(1.02-.5*dot(q,q)), 1.);
}`;
scene({ id: 'wash', name: 'Watercolour', from: 'Organic', kind: 'paint', group: 'organic', pal: 0, hue: () => 0,
  about: 'Wet paint on cold-pressed paper, with a brush for each part of the music: big soft washes on the low end, quick bristled strokes for every note (coloured by its pitch), dots and splatter for the hats and snares',
  inputs: ['midS', 'bassS', 'pulse', 'notes, hats, snares (onsets)', 'noteBand', 'noteAmp', 'hatAmp'],
  cost: 'Light: one 960×600 simulation pass and one full-screen pass. Phones: a 640×400 sheet.',
  post: { bloom: 0.08, thr: 1.6, exp: 1.0, ca: 0.15, vig: 0.35, grain: 0.03, pulse: 0 },
  init() { this.sim = program(VS, FS_WC_SIM); this.show = program(VS, FS_WC);
    this.a = simTarget(WC_W, WC_H); this.b = simTarget(WC_W, WC_H);
    this.drops = new Float32Array(32); this.spl = new Float32Array(16).fill(9); this.stk = new Float32Array(24).fill(9); this.stk2 = new Float32Array(24); this.dot = new Float32Array(32).fill(9);
    this.washAge = new Float32Array(8).fill(9); this.washSlot=0; this.si = 0; this.ki = 0; this.di = 0;
    this.h0=A.hit[0].n; this.h1=A.hit[1].n; this.h2=A.hit[2].n; },
  draw(F, out) {
    const t = F.time, r = Math.random, D = this.drops, S = this.spl, K = this.stk, K2 = this.stk2, O = this.dot;
    // the hand wanders the sheet slowly; strokes and dots fall near it, so the picture has a centre that moves
    const hand = [0.5 + 0.34 * Math.sin(t * 0.13 + Math.sin(t * 0.07) * 2), 0.5 + 0.3 * Math.sin(t * 0.17 + 1.3 + Math.cos(t * 0.05) * 2)];
    for (let j = 0; j < 4; j++) S[j * 4 + 3] += F.dt;
    for (let j = 0; j < 6; j++) K[j * 4 + 3] += F.dt;
    for (let j = 0; j < 8; j++) O[j * 4 + 3] += F.dt;
    for(let j=0;j<8;j++) this.washAge[j]+=F.dt;
    const H=A.hit;
    if(this.h0!==H[0].n){
      this.h0=H[0].n;
      const count=A.levelS>.58?2:1;
      for(let q=0;q<count;q++){
        const i=this.washSlot++ % 8, strength=.35+.65*H[0].amp;
        D.set([.13+r()*.74,.14+r()*.72,.15+.25*strength+.08*A.hitLvl[0],(this.washSlot*.89)%3],i*4);
        this.washAge[i]=0;
      }
    }
    if (this.h1!==H[1].n) { this.h1=H[1].n; const j = this.ki++ % 6, len = 0.16 + 0.34 * r() ** 1.5 + 0.18 * H[1].amp;
      K.set([hand[0] + (r() - 0.5) * 0.5, hand[1] + (r() - 0.5) * 0.52, r() * 6.283, 0], j * 4); K2.set([len, 0.011 + 0.018 * H[1].amp + 0.006 * r(), (r() - 0.5) * 2.2, 3.1 + this.ki * 0.47], j * 4); }
    if (this.h2!==H[2].n) {
      this.h2=H[2].n;
      const angle=r()*6.283, cx=.1+.8*r(), cy=.1+.8*r(), count=3+Math.round(4*H[2].amp+3*A.hitLvl[2]);
      for(let j=0;j<count;j++){
        const dist=(j-2)*.029;
        O.set([cx+dist*Math.cos(angle),cy+dist*Math.sin(angle)+.012*(r()-.5),.008+.014*H[2].amp+.005*r(),0],(this.di++ & 7)*4);
      }
    }
    if(H[2].fast>.72 && H[2].since<F.dt*1.5) S.set([hand[0]+(r()-.5)*.5,hand[1]+(r()-.5)*.5,r(),0],(this.si++&3)*4);
    draw(this.sim, this.b, WC_W, WC_H, u => { F.set(u); bindTex(3, this.a.t); gl.uniform1i(u.uState, 3); gl.uniform1f(u.uDt, Math.min(F.dt, 1 / 30));
      gl.uniform1fv(u.uWashAge,this.washAge); gl.uniform4fv(u.uDropP, D); gl.uniform4fv(u.uSpl, S); gl.uniform4fv(u.uStk, K); gl.uniform4fv(u.uStk2, K2); gl.uniform4fv(u.uDot, O); });
    [this.a, this.b] = [this.b, this.a];
    draw(this.show, out, T.sw, T.sh, u => { F.set(u); bindTex(3, this.a.t); gl.uniform1i(u.uState, 3); });
  } });
}
