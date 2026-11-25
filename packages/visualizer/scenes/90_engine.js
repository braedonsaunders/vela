
// ═════════════════════════ 5 · Frame loop ═════════════════════════
addEventListener('resize', resize); resize();
let sceneIx = 0, prevIx = -1, prevLive = false, needStill = false, slot = 0, xfAt = -10, switchedAt = -10;
let time = 0, frames = 0, travel = 0, last = performance.now(), cycle = false, cycleAt = 0, warm = false;
let palMode = -1;                                        // -1: each scene's own palette
const palX = { from: -1, to: -1, at: -10 };
const XF_SECONDS = 1.1, PAL_SECONDS = 1.2;
let stillPost = POST_DEFAULT, lastPost = POST_DEFAULT;
const smooth01 = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const mixPost = (a, b, m) => { const o = {}; for (const k in POST_DEFAULT) o[k] = a[k] + (b[k] - a[k]) * m; return o; };

function ensure(S) {
  if (S._ok || S._bad) return S._ok;
  try { S.init && S.init(); S._ok = true; } catch (e) { S._bad = true; console.error('scene ' + S.id + ': ' + (e && e.message || e)); }
  resetState(); return S._ok;
}
function setScene(i) {
  const n = ((i % SCENES.length) + SCENES.length) % SCENES.length; cycleAt = time;
  if (n === sceneIx) { renderModes(); return; }
  // Mid-fade, the picture on screen is already a blend: freeze that blend and fade out of the still instead.
  if (prevIx >= 0 && time - xfAt < XF_SECONDS) { needStill = true; prevLive = false; } else prevLive = true;
  prevIx = sceneIx; sceneIx = n; slot ^= 1; xfAt = time; switchedAt = time; perf.n = 0; perf.sum = 0; renderModes();
}
function setPalette(m) { palMode = m; renderModes(); }

// Adaptive resolution: if the display cannot hold its frame rate, render fewer pixels rather than drop frames.
const gov = { acc: 0, n: 0, best: 1, calm: 0, changes: 0 };
function govern(raw) {
  if (raw > 0.25 || document.hidden || !warm || time - xfAt < XF_SECONDS + 0.5) return;   // stalls, hidden tabs and cross-fades say nothing about the GPU
  gov.acc += raw; gov.n++; gov.best = Math.min(gov.best, raw);
  if (gov.n < 50) return;
  const avg = gov.acc / gov.n, refresh = Math.max(gov.best, 1 / 240); gov.acc = 0; gov.n = 0; gov.best = 1;
  if (avg > Math.max(0.0195, refresh * 1.35) && budgetScale > 0.3) { budgetScale *= 0.78; gov.calm = 0; gov.changes++; resize(); }
  else if (avg < 0.0175 && budgetScale < 1 && ++gov.calm > 14) { budgetScale = Math.min(1, budgetScale * 1.2); gov.calm = 0; gov.changes++; resize(); }
}
// Optional GPU timing (?perf): the whole frame inside one timer query, read back a few frames later.
const perf = { ext: QS.has('perf') ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null, q: [], ms: 0, n: 0, sum: 0 };

function frame(now) {
  const raw = (now - last) / 1000; last = now; govern(raw);
  const dt = Math.min(0.05, raw);
  analyse(dt); render(dt);
  requestAnimationFrame(frame);
}

// Draw one scene into its own HDR buffer (and through depth of field if it asks for it).
function drawScene(S, sl, dt) {
  const out = RT('s' + sl);
  if (!ensure(S)) { gl.bindFramebuffer(gl.FRAMEBUFFER, out.f); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return out; }
  const hue = S.hue ? S.hue(time, travel, A) : time * 0.012;
  const pm = smooth01((time - palX.at) / PAL_SECONDS);
  const pa = PALETTES[palX.from < 0 ? S.pal || 0 : palX.from].v, pb = PALETTES[palX.to < 0 ? S.pal || 0 : palX.to].v;
  const F = { time, dt, travel, A, focus: 10, px: T.sh / 900,
    set(u) {
      gl.uniform1f(u.uTime, time); gl.uniform1f(u.uBass, A.bass); gl.uniform1f(u.uMid, A.mid); gl.uniform1f(u.uHigh, A.high); gl.uniform1f(u.uLevel, A.level);
      gl.uniform1f(u.uBassS, A.bassS); gl.uniform1f(u.uMidS, A.midS); gl.uniform1f(u.uHighS, A.highS); gl.uniform1f(u.uLevelS, A.levelS);
      gl.uniform1f(u.uKick, A.kick); gl.uniform1f(u.uKickL, A.kickL); gl.uniform1f(u.uSnare, A.snare); gl.uniform1f(u.uDyn, A.dyn); gl.uniform1f(u.uDrop, A.drop); gl.uniform1f(u.uAccent, A.accent); gl.uniform3fv(u.uHit, A.hitFast); gl.uniform3fv(u.uHitS, A.hitSlow); gl.uniform3fv(u.uBandE, A.hitLvl); gl.uniform1f(u.uSlowHead, slowU); gl.uniform1fv(u.uPulse, A.pulse);
      gl.uniform1f(u.uHue, hue); gl.uniform1f(u.uTravel, travel); gl.uniform2f(u.uRes, T.sw, T.sh); gl.uniform1f(u.uHistHead, histU); gl.uniform1f(u.uPx, T.sh / 900);
      if (pm >= 1 || pa === pb) { gl.uniform3fv(u.uPA, pb); gl.uniform1f(u.uPalMix, 0); } else { gl.uniform3fv(u.uPA, pa); gl.uniform3fv(u.uPB, pb); gl.uniform1f(u.uPalMix, pm); }
      bindTex(0, specTex); gl.uniform1i(u.uSpec, 0); bindTex(1, waveTex); gl.uniform1i(u.uWave, 1); bindTex(2, histTex); gl.uniform1i(u.uHist, 2); bindTex(6, slowTex); gl.uniform1i(u.uSlow, 6);
    } };
  S.draw(F, out); resetState();
  if (!S.post.dof || !HDR) return out;
  const d = RT('d' + sl);
  draw(POST.dof, d, T.sw, T.sh, u => { bindTex(0, out.t); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uPx, 1 / T.sw, 1 / T.sh);
    gl.uniform1f(u.uFocus, F.focus); gl.uniform1f(u.uAperture, S.post.dof.ap * T.sh / 900); gl.uniform1f(u.uMaxCoc, S.post.dof.max * T.sh / 900); });
  return d;
}

let histU = 0;
function render(dt) {
  time += dt; frames++;
  if (cycle && time - cycleAt > 24) setScene(sceneIx + 1);
  if (palMode !== palX.to) { palX.from = palX.to; palX.to = palMode; palX.at = time; }
  // travel: distance flown, on the slow envelopes, so anything in flight speeds up and eases off instead of lurching
  travel += dt * (0.55 + A.bassS * 2.2 + A.kick * 1.2);
  let q = null;
  if (perf.ext) { q = gl.createQuery(); gl.beginQuery(perf.ext.TIME_ELAPSED_EXT, q); }
  if (A.analyser) {
    bindTex(0, specTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BANDS, 1, gl.RG, gl.UNSIGNED_BYTE, A.specU8);
    bindTex(1, waveTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, WAVE, 1, gl.RED, gl.UNSIGNED_BYTE, A.waveU8);
  }
  // The waterfall advances at a fixed rate whatever the frame rate; the fractional part scrolls it between rows.
  histAcc += dt * HIST_HZ; bindTex(2, histTex);
  for (let n = Math.min(4, Math.floor(histAcc)); n > 0; n--) { histHead = (histHead + 1) % HIST_H; gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, histHead, HIST_W, 1, gl.RED, gl.FLOAT, A.histRow); }
  histAcc -= Math.floor(histAcc);
  histU = (histHead - 1 + histAcc + 0.5) / HIST_H;
  A.slowAcc += dt * 30; bindTex(6, slowTex);
  for (let n = Math.min(3, Math.floor(A.slowAcc)); n > 0; n--) { slowHead = (slowHead + 1) % 512; gl.texSubImage2D(gl.TEXTURE_2D, 0, slowHead, 0, 1, 1, gl.RGBA, gl.FLOAT, A.slowRow); }
  A.slowAcc -= Math.floor(A.slowAcc); slowU = (slowHead - 1 + A.slowAcc + 0.5) / 512;

  // 1. the scene, or two of them while they cross-fade
  const S = SCENES[sceneIx], m = smooth01((time - xfAt) / XF_SECONDS);
  if (needStill) { needStill = false; stillPost = lastPost; draw(POST.copy, RT('still'), T.sw, T.sh, u => { bindTex(0, RT('mix').t); gl.uniform1i(u.uA, 0); }); }
  if (m >= 1) prevIx = -1;
  let img = drawScene(S, slot, dt), post = S.post;
  if (prevIx >= 0) {
    const from = prevLive ? drawScene(SCENES[prevIx], slot ^ 1, dt) : RT('still');
    draw(POST.mix, RT('mix'), T.sw, T.sh, u => { bindTex(0, from.t); gl.uniform1i(u.uA, 0); bindTex(1, img.t); gl.uniform1i(u.uB, 1); gl.uniform1f(u.uMix, m); });
    img = RT('mix'); post = mixPost(prevLive ? SCENES[prevIx].post : stillPost, S.post, m);
  }
  lastPost = post;
  // 2. trails (feedback)
  const src = RT('trail' + (T.flip ? 1 : 0)), dst = RT('trail' + (T.flip ? 0 : 1)); T.flip = !T.flip;
  draw(POST.trail, dst, T.sw, T.sh, u => { bindTex(0, img.t); gl.uniform1i(u.uCur, 0); bindTex(1, src.t); gl.uniform1i(u.uPrev, 1);
    gl.uniform1f(u.uDecay, post.trail); gl.uniform1f(u.uZoom, post.zoom * (1 + A.bassS)); gl.uniform1f(u.uSpin, post.spin); });
  // 3. bloom
  const half = o => [0.5 / o.w, 0.5 / o.h];
  draw(POST.pre, T.down[0], T.down[0].w, T.down[0].h, u => { bindTex(0, dst.t); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uHalf, 0.5 / T.sw, 0.5 / T.sh); gl.uniform1f(u.uThr, post.thr); gl.uniform1f(u.uKnee, post.knee); });
  for (let i = 1; i < LEVELS; i++) draw(POST.down, T.down[i], T.down[i].w, T.down[i].h, u => { bindTex(0, T.down[i - 1].t); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uHalf, ...half(T.down[i - 1])); });
  for (let i = LEVELS - 2; i >= 0; i--) {
    const from = i === LEVELS - 2 ? T.down[LEVELS - 1] : T.up[i + 1];
    draw(POST.up, T.up[i], T.up[i].w, T.up[i].h, u => { bindTex(0, from.t); gl.uniform1i(u.uSrc, 0); bindTex(1, T.down[i].t); gl.uniform1i(u.uAdd, 1); gl.uniform2f(u.uHalf, ...half(from)); gl.uniform1f(u.uSpread, post.spread); });
  }
  // 4. composite to screen
  draw(POST.final, null, T.w, T.h, u => { bindTex(0, dst.t); gl.uniform1i(u.uScene, 0); bindTex(1, T.up[0].t); gl.uniform1i(u.uBloom, 1);
    gl.uniform1f(u.uKick, A.kick); gl.uniform1f(u.uTime, time); gl.uniform1f(u.uFade, smooth01(time / 0.8));
    gl.uniform1f(u.uBloomAmt, post.bloom * (1 + A.kick * 0.6 * post.pulse)); gl.uniform1f(u.uPulseAmt, post.pulse); gl.uniform1f(u.uExposure, post.exp); gl.uniform2f(u.uRes, T.w, T.h);
    gl.uniform1f(u.uCA, post.ca); gl.uniform1f(u.uVig, post.vig); gl.uniform1f(u.uGrain, post.grain); });
  if (q) { gl.endQuery(perf.ext.TIME_ELAPSED_EXT); perf.q.push(q);
    while (perf.q.length && gl.getQueryParameter(perf.q[0], gl.QUERY_RESULT_AVAILABLE)) { const d = perf.q.shift();
      if (!gl.getParameter(perf.ext.GPU_DISJOINT_EXT)) { perf.ms = gl.getQueryParameter(d, gl.QUERY_RESULT) / 1e6; perf.sum += perf.ms; perf.n++; } gl.deleteQuery(d); } }
}
// Review aid: render n frames back to back and wait for the GPU, giving true milliseconds per frame.
function bench(n = 200) { const px1 = new Uint8Array(4); render(1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
  const t0 = performance.now(); for (let i = 0; i < n; i++) render(1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
  return (performance.now() - t0) / n; }
