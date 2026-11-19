// === AUDIO ENGINE (from Funky's 2P Games) ===
// Sampled sounds: CC0 Kenney interface / casino packs. Music: "Lofi Hip Hop Loop" by omfgdude (CC0).
// Nothing is created or played before the first user gesture (WebView autoplay policy).
const SND = {
  _ctx: null, _musicGain: null, _sfxGain: null,
  _musicOn: (() => { try { return localStorage.getItem('dm-music') !== 'off'; } catch (e) { return true; } })(),
  _sfxOn: (() => { try { return localStorage.getItem('dm-sfx') !== 'off'; } catch (e) { return true; } })(),
  _playing: false, _musicSrc: null, _musicToken: null,
  _buf: {}, _loading: {},
  _S: {
    click: ['click_001', 'click_002', 'click_003', 'click_004', 'click_005'],
    tick: ['tick_001', 'tick_002'],
    pop: ['select_001', 'select_002', 'select_003', 'select_004'],
    flip: ['card-place-1', 'card-place-2', 'card-place-3', 'card-place-4'],
    score: ['confirmation_001', 'confirmation_002', 'confirmation_003', 'confirmation_004'],
    chime: ['glass_001', 'glass_002', 'glass_003', 'glass_004', 'glass_005', 'glass_006'],
    buzz: ['error_001', 'error_002', 'error_003', 'error_004', 'error_005', 'error_006', 'error_007', 'error_008'],
    bong: ['bong_001'],
    pluck: ['pluck_001', 'pluck_002'],
    stack: ['chips-stack-1', 'chips-stack-2'],
  },
  _MUSIC: 'music-lofi',
  init() {
    if (this._ctx) return;
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._musicGain = this._ctx.createGain(); this._musicGain.gain.value = 0.35;
    this._musicGain.connect(this._ctx.destination);
    this._sfxGain = this._ctx.createGain(); this._sfxGain.gain.value = 0.7;
    this._sfxGain.connect(this._ctx.destination);
    for (const k in this._S) this._S[k].forEach(f => this._load(f));
  },
  _load(name) {
    if (this._buf[name] || this._loading[name]) return this._loading[name] || Promise.resolve(this._buf[name]);
    this._loading[name] = fetch('audio/' + name + '.ogg')
      .then(r => r.arrayBuffer())
      .then(ab => this._ctx.decodeAudioData(ab))
      .then(b => { this._buf[name] = b; return b; })
      .catch(e => { console.warn('audio load failed', name, e); delete this._loading[name]; });
    return this._loading[name];
  },
  _play(set, vol, rate, at) {
    const files = this._S[set]; if (!files) return;
    const name = files[Math.floor(Math.random() * files.length)];
    const b = this._buf[name]; if (!b) { this._load(name); return; }
    const src = this._ctx.createBufferSource(); src.buffer = b;
    src.playbackRate.value = rate || 1;
    const g = this._ctx.createGain(); g.gain.value = vol == null ? 1 : vol;
    src.connect(g); g.connect(this._sfxGain);
    src.start(this._ctx.currentTime + (at || 0));
  },
  _vary(base, spread) { return (base || 1) * (1 + (Math.random() * 2 - 1) * (spread == null ? 0.06 : spread)); },
  _sfx(fn) {
    if (!this._sfxOn) return;
    try { this.init(); if (this._ctx.state === 'suspended') this._ctx.resume(); fn.call(this); } catch (e) {}
  },
  sfxToggle(on) {
    this._sfxOn = on; try { localStorage.setItem('dm-sfx', on ? 'on' : 'off'); } catch (e) {}
  },

  // --- Music: one loop, faded in and out ---
  musicStart() {
    if (!this._musicOn || this._playing) return;
    try { this.init(); } catch (e) { return; }
    if (this._ctx.state === 'suspended') this._ctx.resume();
    this._playing = true;
    const token = {}; this._musicToken = token;
    this._load(this._MUSIC).then(b => {
      if (!b || !this._playing || this._musicToken !== token) return;
      const src = this._ctx.createBufferSource(); src.buffer = b; src.loop = true;
      const g = this._ctx.createGain();
      g.gain.setValueAtTime(0, this._ctx.currentTime);
      g.gain.linearRampToValueAtTime(1, this._ctx.currentTime + 2.5);
      src.connect(g); g.connect(this._musicGain); src.start();
      this._musicSrc = { src, g };
    });
  },
  musicStop() {
    this._playing = false; this._musicToken = null;
    const m = this._musicSrc; this._musicSrc = null;
    if (m) {
      const t = this._ctx.currentTime;
      m.g.gain.cancelScheduledValues(t); m.g.gain.setValueAtTime(m.g.gain.value, t);
      m.g.gain.linearRampToValueAtTime(0, t + 0.6);
      try { m.src.stop(t + 0.65); } catch (e) {}
    }
  },
  musicToggle(force) {
    this._musicOn = force == null ? !this._musicOn : force;
    try { localStorage.setItem('dm-music', this._musicOn ? 'on' : 'off'); } catch (e) {}
    if (this._musicOn) this.musicStart(); else this.musicStop();
    return this._musicOn;
  },
  // Pause the loop when the app goes to the background, resume when it comes back.
  suspend() { if (this._ctx && this._ctx.state === 'running') this._ctx.suspend(); },
  resume() { if (this._ctx && this._ctx.state === 'suspended') this._ctx.resume(); },

  // --- Devine-moi sound map (PLAN §A.8.2). The same methods are added to SND in 2P Games. ---
  key() { this._sfx(function () { this._play('click', 0.32, this._vary(1.15, 0.06)); }); },
  erase() { this._sfx(function () { this._play('tick', 0.35, this._vary(0.9, 0.05)); }); },
  reveal() { this._sfx(function () { this._play('flip', 0.42, this._vary(1, 0.08)); }); },
  // k-th green of the row: a rising arpeggio (major-ish steps)
  tileCorrect(k) { this._sfx(function () { this._play('chime', 0.5, Math.pow(1.19, k || 0)); }); },
  tilePresent() { this._sfx(function () { this._play('pop', 0.42, this._vary(1, 0.06)); }); },
  invalid() { this._sfx(function () { this._play('buzz', 0.5); }); },
  win(fast) { this._sfx(function () {
    this._play('score', 0.7);
    [1, 1.26, 1.5, 2].forEach((r, i) => this._play('chime', 0.55, r, 0.25 + i * 0.13));
    if (fast) this._play('stack', 0.5, 1, 0.8);
  }); },
  lose() { this._sfx(function () { this._play('bong', 0.6, 0.8); this._play('bong', 0.5, 0.6, 0.22); }); },
  open() { this._sfx(function () { this._play('pluck', 0.45, this._vary(1, 0.05)); }); },
  streak() { this._sfx(function () { this._play('stack', 0.6); }); },
  turn() { this._sfx(function () { this._play('pop', 0.5, 1); this._play('pop', 0.5, 1.25, 0.09); }); },
};
