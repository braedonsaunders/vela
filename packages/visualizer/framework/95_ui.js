
// ═════════════════════════ 6 · UI ═════════════════════════
const $ = id => document.getElementById(id);
const ui = $('ui'), now = $('now'), help = $('help'), media = $('media'), vol = $('vol'), file = $('file'), drop = $('drop');
const keyOf = i => i < 9 ? String(i + 1) : i === 9 ? '0' : '';
function renderModes() { const m = $('modes'); m.innerHTML = '';
  SCENES.forEach((s, i) => { const b = document.createElement('button'); const k = keyOf(i);
    if (k) { const kb = document.createElement('kbd'); kb.textContent = k; b.appendChild(kb); }
    b.append(s.name); b.title = s.about || ''; b.className = i === sceneIx ? 'on' : ''; b.onclick = () => setScene(i); m.appendChild(b); });
  $('bCycle').className = cycle ? 'on' : '';
  $('bPal').textContent = 'Colour: ' + (palMode < 0 ? 'Auto' : PALETTES[palMode].name); }
function markSource() { $('bDemo').className = A.source === 'demo' ? 'on' : ''; $('bFile').className = A.source === 'file' ? 'on' : ''; $('bMic').className = A.source === 'mic' ? 'on' : ''; }
function setNow(title, sub) { now.innerHTML = ''; now.append(title); const s = document.createElement('small'); s.textContent = sub; now.appendChild(s); }
function begin(fn) { $('start').remove(); fn(); poke(); }
const nextPal = () => setPalette(palMode + 1 >= PALETTES.length ? -1 : palMode + 1);
$('sDemo').onclick = () => begin(useDemo);
$('sFile').onclick = () => { file.click(); };
$('sMic').onclick = () => begin(useMic);
$('bDemo').onclick = useDemo; $('bMic').onclick = useMic; $('bFile').onclick = () => file.click();
file.onchange = () => { const f = file.files[0]; if (f) { if ($('start')) $('start').remove(); useFile(f); } file.value = ''; };
$('bCycle').onclick = () => { cycle = !cycle; cycleAt = time; renderModes(); };
$('bPal').onclick = nextPal;
$('bFs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
vol.oninput = () => { if (A.out && !MUTED) A.out.gain.setTargetAtTime(+vol.value, A.ctx.currentTime, 0.02); };
addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('show'); });
addEventListener('dragleave', e => { if (e.target === drop) drop.classList.remove('show'); });
addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('show'); const f = e.dataTransfer.files[0]; if (f) { if ($('start')) $('start').remove(); useFile(f); } });
let idle = 0, hidden = false;
function poke() { clearTimeout(idle); if (!hidden) { ui.classList.remove('hide'); now.classList.remove('hide'); help.classList.remove('hide'); }
  idle = setTimeout(() => { ui.classList.add('hide'); now.classList.add('hide'); help.classList.add('hide'); }, 3200); }
addEventListener('mousemove', poke); addEventListener('touchstart', poke);
addEventListener('keydown', e => {
  if (e.key >= '1' && e.key <= '9') setScene(+e.key - 1);
  else if (e.key === '0') setScene(9);
  else if (e.key === 'c' || e.key === 'C') nextPal();
  else if (e.key === 'a' || e.key === 'A') { cycle = !cycle; cycleAt = time; renderModes(); }
  else if (e.key === 'f' || e.key === 'F') $('bFs').onclick();
  else if (e.key === 'h' || e.key === 'H') { hidden = !hidden; if (hidden) { ui.classList.add('hide'); now.classList.add('hide'); help.classList.add('hide'); } else poke(); }
  else if (e.key === 'ArrowRight') setScene(sceneIx + 1); else if (e.key === 'ArrowLeft') setScene(sceneIx - 1);
  else if (e.key === ' ') { e.preventDefault(); if (A.source === 'file') media.paused ? media.play() : media.pause(); else if (A.ctx) A.ctx.state === 'running' ? A.ctx.suspend() : A.ctx.resume(); }
  poke();
});
// ?mute keeps the output gain at zero for the whole session; ?scene=<id or number>, ?pal=<name or number> and ?hud=0 are for review.
if (MUTED) { vol.value = '0'; vol.disabled = true; }
if (QS.has('pal')) { const v = QS.get('pal'), i = PALETTES.findIndex(p => p.name.toLowerCase() === v.toLowerCase()); palMode = palX.to = palX.from = i >= 0 ? i : Math.max(-1, Math.min(PALETTES.length - 1, +v || 0)); }
if (QS.has('scene')) { const v = QS.get('scene'), i = SCENES.findIndex(s => s.id === v); sceneIx = i >= 0 ? i : Math.max(0, Math.min(SCENES.length - 1, (+v || 1) - 1)); }
if (QS.get('hud') === '0') { hidden = true; ui.classList.add('hide'); now.classList.add('hide'); help.classList.add('hide'); }
renderModes(); setNow('Vela Visualizer', 'Choose a source to begin');
window.__vela = { setScene, setPalette, get scene() { return sceneIx; }, SCENES, scenes: SCENES.map(s => s.name), PALETTES, A, perf, bench,
  get frames() { return frames; }, get res() { return [T.sw, T.sh, SAMPLES]; }, get warm() { return warm; }, get budget() { return budgetScale; }, gov, get broken() { return SCENES.filter(s => s._bad).map(s => s.id); } };
// Compile the scene on screen first, then the rest one at a time behind the start card, so a later switch never stalls.
ensure(SCENES[sceneIx]);
requestAnimationFrame(frame);
(function warmUp(i) { if (i >= SCENES.length) { warm = true; return; } ensure(SCENES[i]); setTimeout(() => warmUp(i + 1), 30); })(0);
