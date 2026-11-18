'use strict';
(() => {
  const ASPECT = 2.0, FOVY = 24 * Math.PI / 180, TANH = Math.tan(FOVY / 2);
  const canvas = document.getElementById('film');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) { document.body.classList.add('nogl'); return; }
  const params = new URLSearchParams(location.search);
  const VIEW = params.get('view') || 'film';
  const hasFloat = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
  gl.getExtension('OES_texture_float_linear');

  // ------------------------------------------------------------ programs
  function prog(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('shader error', gl.getShaderInfoLog(s), src.split('\n').slice(0, 3).join('|'));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error('link error', gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }
  const pBg = prog(SH.fsqVS, SH.bgFS), pPost = prog(SH.fsqVS, SH.postFS);
  const pThread = prog(SH.stitchVS, SH.threadFS), pShadow = prog(SH.stitchVS, SH.shadowFS), pQuad = prog(SH.quadVS, SH.quadFS);

  // ------------------------------------------------------------ geometry
  const fsVao = gl.createVertexArray(); gl.bindVertexArray(fsVao);
  const fsBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, fsBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const NSEG = 6, strip = [];
  for (let i = 0; i <= NSEG; i++) strip.push(i / NSEG, -1, i / NSEG, 1);
  const stVao = gl.createVertexArray(); gl.bindVertexArray(stVao);
  const stripBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, stripBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(strip), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const instBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, 16 * 4 * 6000, gl.DYNAMIC_DRAW);
  for (let k = 1; k <= 4; k++) { gl.enableVertexAttribArray(k); gl.vertexAttribDivisor(k, 1); }
  function bindGroup(start) {
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    for (let k = 0; k < 4; k++) gl.vertexAttribPointer(k + 1, 4, gl.FLOAT, false, 64, start * 64 + k * 16);
  }

  // ------------------------------------------------------------ targets
  let fbo = null, tex = null, rw = 0, rh = 0, scale = 1, cw = 0, ch = 0, sized = false;
  function makeTarget(w, h) {
    if (tex) { gl.deleteTexture(tex); gl.deleteFramebuffer(fbo); }
    tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    if (hasFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    rw = w; rh = h;
  }
  function layout() {
    const W = window.innerWidth, H = window.innerHeight;
    const w = Math.min(W, H * ASPECT), h = w / ASPECT, dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    canvas.style.left = (W - w) / 2 + 'px'; canvas.style.top = (H - h) / 2 + 'px';
    cw = Math.max(2, Math.round(w * dpr)); ch = Math.max(2, Math.round(h * dpr));
    if (!sized) { sized = true; scale = Math.max(0.5, Math.min(1, Math.sqrt(3.7e6 / (cw * ch)))); } // start within budget on high-density screens
    canvas.width = cw; canvas.height = ch;
    makeTarget(Math.max(2, Math.round(cw * scale)), Math.max(2, Math.round(ch * scale)));
    document.documentElement.style.setProperty('--bar', Math.max(0, (H - h) / 2) + 'px');
    document.body.classList.toggle('tight', (H - h) / 2 < 40);
  }
  window.addEventListener('resize', layout);

  // ------------------------------------------------------------ camera
  const V = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] };
  const K = (tx, ty, dist, tilt, az, ap) => ({ tx, ty, dist, tilt, az, ap });
  const mix = (a, b, u) => { const o = {}; for (const k in a) o[k] = a[k] + (b[k] - a[k]) * u; return o; };
  const ease = u => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
  const WIDE = K(0, 3.5, 432, 0.10, 0, 0.25);
  function shot(t) {
    if (VIEW === 'wide') return WIDE;
    if (VIEW === 'top') return K(0, 3, 452, 0, 0, 0);
    if (VIEW === 'fox') { const f = foxState(t); return K(f.x + 2, -18, 150, 0.45, 0.1, 0.6); }
    if (VIEW === 'kite') { const k = kiteState(t); return K(k.x + 6, k.y - 8, 190, 0.4, 0.1, 0.6); }
    if (VIEW === 'child') return K(34, -14, 150, 0.4, 0, 0.6);
    if (VIEW === 'low') return K(0, -10, 300, 0.95, 0.3, 0.8);
    if (t < 8) { // the sewing: start close and low, drift out to the whole hoop
      const u = ease(t / 8), a = K(-34, -23, 150, 0.80, -0.30, 1.0), b = K(6, -16, 300, 0.50, 0.06, 0.7), c = WIDE;
      const ab = mix(a, b, u), bc = mix(b, c, u); return mix(ab, bc, u);
    }
    if (t < 10) return mix(WIDE, K(0, 2, 414, 0.10, 0, 0.25), (t - 8) / 2);
    if (t < 14) { const f = foxState(t), u = (t - 10) / 4; return K(f.x + 9, -19, 172 - 14 * u, 0.76, 0.22 - 0.24 * u, 1.0); }
    if (t < 16) { const u = (t - 14) / 2; return mix(K(2, 2, 400, 0.26, -0.08, 0.4), K(-2, 6, 372, 0.30, -0.03, 0.4), u); }
    if (t < 20) { const k = kiteState(t), u = (t - 16) / 4; return K(k.x * 0.7 + 4, k.y * 0.8 - 2, 250 - 20 * u, 0.56, 0.16 - 0.1 * u, 0.9); }
    if (t < 24) { const u = ease((t - 20) / 4); return mix(K(10, 8, 300, 0.42, -0.14, 0.7), K(6, 10, 270, 0.36, -0.04, 0.7), u); }
    if (t < 28) { const u = (t - 24) / 4; return mix(K(0, 2, 452, 0.16, 0.05, 0.25), K(0, 3.5, 430, 0.09, 0, 0.25), u); }
    return mix(K(0, 3.5, 430, 0.09, 0, 0.25), K(0, 3.5, 424, 0.12, -0.02, 0.25), (t - 28) / 2);
  }
  function camera(s) {
    const ct = Math.cos(s.tilt), st = Math.sin(s.tilt);
    const pos = [s.tx + s.dist * Math.sin(s.az) * st, s.ty - s.dist * Math.cos(s.az) * st, s.dist * ct];
    const F = V.norm(V.sub([s.tx, s.ty, 0], pos));
    const R = V.norm(V.cross(F, Math.abs(F[2]) > 0.9995 ? [0, 1, 0] : [0, 0, 1]));
    const U = V.cross(R, F);
    const n = 20, f = 3000, sy = 1 / TANH, sx = sy / ASPECT;
    // viewProj = P * V
    const vm = [R[0], U[0], -F[0], 0, R[1], U[1], -F[1], 0, R[2], U[2], -F[2], 0, -V.dot(R, pos), -V.dot(U, pos), V.dot(F, pos), 1];
    const pm = [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0];
    const vp = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let v = 0; for (let k = 0; k < 4; k++) v += pm[k * 4 + r] * vm[c * 4 + k]; vp[c * 4 + r] = v; }
    return { pos, R, U, F, vp, focus: s.dist, ap: s.ap };
  }

  // ------------------------------------------------------------ state
  let playing = true, filmT = 0, t0 = performance.now(), frozen = false;
  if (params.has('t')) { filmT = Math.max(0, Math.min(LOOP - 0.001, parseFloat(params.get('t')) || 0)); playing = false; frozen = true; }
  const flowers = [];
  let scene = null, sceneKey = '', mouse = [0, 0], mouseS = [0, 0], cam = null, lastNeedle = [0, 0, 0];
  const nowT = () => playing ? ((performance.now() - t0) / 1000) % LOOP : filmT;
  function setT(t) { filmT = ((t % LOOP) + LOOP) % LOOP; t0 = performance.now() - filmT * 1000; }

  function needleAt(list, t) {
    let lo = 0, hi = list.length - 1, i = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m][0] <= t) { i = m; lo = m + 1; } else hi = m - 1; }
    if (i < 0) return [0, 0, 0];
    const e = list[i]; if (t - e[0] > e[1] + 0.12) return [lastNeedle[0], lastNeedle[1], 0];
    let x = 0, y = 0, n = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(list.length - 1, i + 3); k++) {
      const q = list[k]; if (Math.abs(q[0] - e[0]) > 0.3) continue;
      const p = Math.min(1, Math.max(0, (t - q[0]) / q[1])); x += q[2] + (q[4] - q[2]) * p; y += q[3] + (q[5] - q[3]) * p; n++;
    }
    return [x / n, y / n, 1];
  }

  // ------------------------------------------------------------ frame
  let frames = 0, warm = 0, fpsT = performance.now(), emaDt = 16.7, slow = 0, lastFrame = performance.now(), upTry = 0, locked = false;
  window.__fps = 0; window.__scale = () => scale;
  function setCam(p) {
    gl.uniform3fv(p.u.uCam, cam.pos); if (p.u.uR) { gl.uniform3fv(p.u.uR, cam.R); gl.uniform3fv(p.u.uU, cam.U); gl.uniform3fv(p.u.uF, cam.F); gl.uniform2f(p.u.uProj, ASPECT * TANH, TANH); }
  }
  function frame() {
    const now = performance.now(), dt = now - lastFrame; lastFrame = now;
    if (!frozen) {
      emaDt += (Math.min(dt, 100) - emaDt) * 0.08;
      if (emaDt > 19.5) slow++; else slow = Math.max(0, slow - 1);
      if (warm < 90) { warm++; slow = 0; emaDt = 16.7; }
      if (slow > 40 && scale > 0.5) { scale = Math.max(0.5, scale - 0.15); slow = 0; locked = upTry > 1; upTry++; layout(); }
    }
    frames++; if (now - fpsT > 500) { window.__fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now; }

    const t = nowT(); filmT = t;
    const nowSec = now / 1000;
    const key = Math.floor(Math.min(t, UNRAVEL) * 12 + 1e-4) + '|' + flowers.length;
    if (!scene || key !== sceneKey || scene.anim) {
      scene = buildScene(t, flowers, nowSec); sceneKey = key;
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, scene.data);
    }
    cam = camera(shot(t));
    mouseS[0] += (mouse[0] - mouseS[0]) * 0.08; mouseS[1] += (mouse[1] - mouseS[1]) * 0.08;
    const light = [-150 + mouseS[0] * 150 + 14 * Math.sin(t * TAU / LOOP), 170 + mouseS[1] * 110, 215];
    const nd = needleAt(scene.needle, t); if (nd[2] > 0) lastNeedle = nd;
    const ndS = (t < UNRAVEL) ? nd : [0, 0, 0];

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, rw, rh);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.colorMask(true, true, true, true);
    gl.useProgram(pBg.p); setCam(pBg); gl.uniform3fv(pBg.u.uLight, light); gl.uniform3fv(pBg.u.uNeedle, ndS); gl.uniform1f(pBg.u.uPxK, 2 * TANH / rh); gl.uniform2f(pBg.u.uPix, 2 / rw, 2 / rh);
    gl.bindVertexArray(fsVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.BLEND);
    for (const p of [pThread, pShadow]) { gl.useProgram(p.p); gl.uniformMatrix4fv(p.u.uVP, false, cam.vp); gl.uniform1f(p.u.uT, t); gl.uniform3fv(p.u.uLight, light); }
    gl.useProgram(pThread.p); gl.uniform3fv(pThread.u.uCam, cam.pos); gl.uniform1f(pThread.u.uShadow, 0);
    gl.useProgram(pShadow.p); gl.uniform1f(pShadow.u.uShadow, 1);
    gl.useProgram(pQuad.p); gl.uniformMatrix4fv(pQuad.u.uVP, false, cam.vp);
    for (let g = 0; g < NG; g++) {
      const [start, count] = scene.ranges[g]; if (!count) continue;
      gl.bindVertexArray(stVao); bindGroup(start);
      if (g > 0) {
        gl.colorMask(false, false, false, true); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(pShadow.p); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (NSEG + 1) * 2, count);
        gl.colorMask(true, true, true, false); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.DST_ALPHA, gl.ONE_MINUS_DST_ALPHA);
        gl.useProgram(pQuad.p); gl.bindVertexArray(fsVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(stVao);
      }
      gl.colorMask(true, true, true, false); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(pThread.p); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (NSEG + 1) * 2, count);
    }
    gl.colorMask(true, true, true, true); gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, cw, ch);
    gl.useProgram(pPost.p); setCam(pPost);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(pPost.u.uTex, 0);
    gl.uniform2f(pPost.u.uRes, rw, rh); gl.uniform3f(pPost.u.uDof, cam.focus, cam.ap, 9 * rh / 1080);
    gl.uniform1f(pPost.u.uSeed, frozen ? 1 : (Math.floor(t * 24) % 97) * 13.7);
    gl.bindVertexArray(fsVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (playing) Score.update(t);
    bar.style.transform = 'scaleX(' + (t / LOOP) + ')';
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ input
  const ui = document.getElementById('ui'), bar = document.getElementById('bar-fill'), track = document.getElementById('bar');
  const btn = document.getElementById('sound');
  let hideTimer = 0, scrubbing = false;
  function wake() { document.body.classList.add('hover'); clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (!scrubbing) document.body.classList.remove('hover'); }, 2600); }
  function worldAt(cx, cy) {
    const r = canvas.getBoundingClientRect(); if (!cam) return null;
    const ux = ((cx - r.left) / r.width) * 2 - 1, uy = 1 - ((cy - r.top) / r.height) * 2;
    const d = V.norm([cam.F[0] + ux * ASPECT * TANH * cam.R[0] + uy * TANH * cam.U[0], cam.F[1] + ux * ASPECT * TANH * cam.R[1] + uy * TANH * cam.U[1], cam.F[2] + ux * ASPECT * TANH * cam.R[2] + uy * TANH * cam.U[2]]);
    const k = -cam.pos[2] / d[2]; return [cam.pos[0] + d[0] * k, cam.pos[1] + d[1] * k];
  }
  window.addEventListener('mousemove', e => {
    mouse = [e.clientX / window.innerWidth * 2 - 1, 1 - e.clientY / window.innerHeight * 2]; wake();
    if (scrubbing) scrub(e);
    const w = worldAt(e.clientX, e.clientY);
    canvas.style.cursor = (w && Math.hypot(w[0], w[1]) < 70) ? 'crosshair' : 'default';
  });
  document.addEventListener('mouseleave', () => { if (!scrubbing) document.body.classList.remove('hover'); });
  function scrub(e) { const r = track.getBoundingClientRect(); setT(Math.min(0.9999, Math.max(0, (e.clientX - r.left) / r.width)) * LOOP); if (!playing) filmT = filmT; Score.reseek(filmT); }
  track.addEventListener('mousedown', e => { scrubbing = true; scrub(e); e.preventDefault(); });
  window.addEventListener('mouseup', () => { scrubbing = false; });
  canvas.addEventListener('mousedown', e => {
    const w = worldAt(e.clientX, e.clientY); if (!w || Math.hypot(w[0], w[1]) > 70) return;
    const seed = (Math.random() * 1e6) | 0;
    flowers.push({ x: w[0], y: w[1], born: performance.now() / 1000, seed, rot: Math.random() * TAU });
    if (flowers.length > 40) flowers.shift();
    if (Score.on) { [0, 1, 2, 3, 4, 5].forEach(i => setTimeout(() => Score.note([74, 78, 81, 86, 83, 90][i], 0.1), 250 + i * 85)); Score.tap(); }
  });
  function togglePause() {
    if (playing) { filmT = nowT(); playing = false; } else { frozen = false; setT(filmT); playing = true; }
    Score.pause(!playing);
  }
  window.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); togglePause(); wake(); } });
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (!Score.on) { frozen = false; playing = true; setT(0); Score.start(0); btn.textContent = 'Mute'; btn.classList.add('on'); }
    else { Score.setMuted(!Score.muted); btn.textContent = Score.muted ? 'Sound on' : 'Mute'; }
    btn.blur();
  });
  window.__film = { setT: t => { setT(t); }, pause: () => { if (playing) togglePause(); }, play: () => { if (!playing) togglePause(); }, flowers, count: () => scene ? scene.count : 0 };

  layout();
  requestAnimationFrame(frame);
})();
