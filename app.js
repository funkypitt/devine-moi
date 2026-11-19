// Devine-moi — application: daily word, training, persistence, stats, sheets.
(function () {
  'use strict';
  const C = DevineCore, UI = DevineUI, W = C.prepare(window.DEVINE_WORDS);
  const EPOCH = W.epoch, ROWS = 6, VERSION = '1.1.0';
  const $ = id => document.getElementById(id);
  const P = 'dm:v1:';
  const store = {
    get(k, def) { try { const v = localStorage.getItem(P + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(P + k); } catch (e) {} },
    keys() { try { return Object.keys(localStorage).filter(k => k.startsWith(P)); } catch (e) { return []; } },
  };

  // Debug helpers, only on a local dev server: ?day=YYYY-MM-DD, ?reset=1
  const DEV = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const qs = new URLSearchParams(location.search);
  if (DEV && qs.get('reset')) store.keys().forEach(k => localStorage.removeItem(k));
  let dayOffset = 0;
  if (DEV && qs.get('day')) dayOffset = C.dayIndex(new Date(qs.get('day') + 'T12:00'), EPOCH) - C.dayIndex(new Date(), EPOCH);
  const now = () => new Date(Date.now() + dayOffset * 86400000);
  const today = () => C.dayIndex(now(), EPOCH);

  const settings = Object.assign({ hard: false, contrast: false, trainLen: 5, keyboard: 'auto' }, store.get('settings', {}));
  // 'auto' follows the phone: fr-CH -> QWERTZ, fr-FR / fr-BE -> AZERTY, fr-CA and others -> QWERTY
  const phoneLocale = () => (navigator.languages && navigator.languages[0]) || navigator.language || 'fr-FR';
  const KBD_NAMES = { azerty: 'AZERTY', qwertz: 'QWERTZ', qwerty: 'QWERTY' };
  const layoutFor = choice => (choice === 'auto' ? C.keyboardLayoutFor(phoneLocale()) : choice);
  const saveSettings = () => store.set('settings', settings);
  const stats = Object.assign({ played: 0, won: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0], lastDay: -1, lastWinDay: -9, training: 0, trainingWon: 0 },
                              store.get('stats', {}));
  const saveStats = () => store.set('stats', stats);

  // purge daily games older than 30 days
  store.keys().forEach(k => { const m = k.match(/daily:(-?\d+)$/); if (m && +m[1] < today() - 30) localStorage.removeItem(k); });

  // ---------- game state ----------
  // options a build may set before this script (window.DM_OPTIONS): training: false leaves the training out;
  // reverse: true plays the daily words in reverse order; about: another name and version in the settings
  // sheet; homeNote: a line of HTML under the home screen
  const OPT = Object.assign({ training: true }, window.DM_OPTIONS || {});
  let mode = 'daily';            // 'daily' | 'train' | 'home' | a plugin id
  let g = null;                  // {kind, day?, len, answer, guesses[], evals[], hard, done, won}
  let input = '', busy = false;

  function newDaily(day) {
    const saved = store.get('daily:' + day, null);
    const answer = C.dailyAnswer(W, 5, OPT.reverse ? -1 - day : day);   // reverse: the desktop build walks the list backwards
    const guesses = saved ? saved.guesses.filter(x => x.length === 5) : [];
    const evals = guesses.map(x => C.evaluate(x, answer));
    const won = evals.length > 0 && C.isWin(evals[evals.length - 1]);
    return { kind: 'daily', day, len: 5, answer, guesses, evals, hard: saved ? !!saved.hard : settings.hard,
             done: won || guesses.length >= ROWS, won };
  }
  function newTraining(fresh) {
    const saved = !fresh && store.get('train', null);
    if (saved && W[saved.len] && W[saved.len].allowedSet.has(saved.answer) && !saved.done) {
      const evals = saved.guesses.map(x => C.evaluate(x, saved.answer));
      return { kind: 'train', len: saved.len, answer: saved.answer, guesses: saved.guesses, evals, hard: settings.hard, done: false, won: false };
    }
    const len = settings.trainLen, avoid = new Set(store.get('trainRecent', []));
    const answer = C.randomAnswer(W, len, Math.random, avoid);
    const recent = [...avoid, answer].slice(-200); store.set('trainRecent', recent);
    const t = { kind: 'train', len, answer, guesses: [], evals: [], hard: settings.hard, done: false, won: false };
    saveGame(t);
    return t;
  }
  function saveGame(x) {
    x = x || g;
    if (x.kind === 'daily') store.set('daily:' + x.day, { len: 5, guesses: x.guesses, hard: x.hard, done: x.done, won: x.won });
    else store.set('train', { len: x.len, answer: x.answer, guesses: x.guesses, done: x.done });
  }

  // ---------- DOM ----------
  const stage = $('stage'), boardHost = $('board-host');
  const board = UI.createBoard(boardHost, { len: 5, rows: ROWS });
  const kb = UI.createKeyboard($('kbd-host'), { onKey, onEnter, onBackspace, enterLabel: 'Entrée', layout: layoutFor(settings.keyboard) });
  document.body.classList.toggle('dm-hc', settings.contrast);

  function fit() {
    const r = stage.getBoundingClientRect();
    board.fit(Math.min(r.width - 32, 420), r.height - 12, 64);
  }
  window.addEventListener('resize', fit);

  const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const longDate = d => `${DAYS[d.getDay()]} ${d.getDate() === 1 ? '1er' : d.getDate()} ${MONTHS[d.getMonth()]}`;

  function renderHeader() {
    syncTabs();
    if (activePlugin || mode === 'home') return;  // the plugin, or the home screen, sets the plaque and the subline
    if (g.kind === 'daily') {
      $('plaque-num').textContent = 'n°' + (g.day + 1);
      $('subline').textContent = 'Le mot du ' + longDate(C.dateOfIndex(g.day, EPOCH)) + (g.hard ? ', mode difficile' : '');
    } else {
      $('plaque-num').textContent = 'entraînement';
      $('subline').textContent = `Mots de ${g.len} lettres, parties illimitées` + (g.hard ? ', mode difficile' : '');
    }
  }
  function syncTabs() {
    document.querySelectorAll('#modes [role=tab]').forEach(t => {
      t.setAttribute('aria-selected', t.dataset.mode === mode);
      if (HOME) t.classList.toggle('done', !!gameStatus(t.dataset.mode).done);
    });
  }

  function renderAll() {
    input = ''; busy = false;
    board.reset(g.len, ROWS);
    g.guesses.forEach((x, r) => board.paintRow(r, x, g.evals[r]));
    kb.setStates(C.keyboardStates(g.guesses, g.evals));
    kb.setEnabled(!g.done);
    renderHeader(); renderStrip(); fit();
  }

  let stripTimer = null;
  function renderStrip() {
    clearInterval(stripTimer);
    const strip = $('strip');
    if (!g.done) { strip.hidden = true; return; }
    strip.hidden = false;
    if (g.kind === 'daily') {
      const tick = () => { $('strip-text').textContent = 'Prochain mot dans ' + hms(C.nextMidnightMs(now())); };
      tick(); stripTimer = setInterval(tick, 1000);
      $('strip-btn').textContent = 'Voir le résultat';
    } else {
      $('strip-text').textContent = g.won ? 'Trouvé !' : 'Le mot était ' + C.displayWord(W, g.len, g.answer);
      $('strip-btn').textContent = 'Nouveau mot';
    }
  }
  $('strip-btn').onclick = () => { SND.open(); if (g.kind === 'daily') openResult(); else { g = newTraining(true); renderAll(); } };

  function hms(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':');
  }

  // ---------- input ----------
  let started = false;
  function firstGesture() { if (started) return; started = true; SND.musicStart(); }

  function onKey(ch) {
    firstGesture();
    if (busy || g.done || input.length >= g.len) return;
    input += ch; SND.key(); board.setRow(g.guesses.length, input);
  }
  function onBackspace() {
    firstGesture();
    if (busy || g.done || !input) return;
    input = input.slice(0, -1); SND.erase(); board.setRow(g.guesses.length, input);
  }
  function reject(msg) { SND.invalid(); board.shakeRow(g.guesses.length); UI.toast(stage, msg); }

  const WIN_TITLES = ['Génie !', 'Magnifique !', 'Superbe !', 'Bien joué !', 'Ouf !', 'De justesse !'];
  function onEnter() {
    firstGesture();
    if (busy || g.done) return;
    if (input.length < g.len) return reject('Pas assez de lettres');
    if (!C.isAllowed(W, g.len, input)) return reject('Ce mot n’est pas dans le dictionnaire');
    if (g.hard) { const v = C.hardModeViolation(input, g.guesses, g.evals); if (v) return reject(v); }
    const guess = input, ev = C.evaluate(guess, g.answer), r = g.guesses.length;
    busy = true; kb.setEnabled(false);
    // commit before the animation, so closing the app mid-reveal never loses the row
    g.guesses.push(guess); g.evals.push(ev); input = '';
    const won = C.isWin(ev), lost = !won && g.guesses.length >= ROWS;
    g.done = won || lost; g.won = won;
    saveGame();
    if (g.done) recordEnd();
    let k = 0;
    board.revealRow(r, ev, {
      onTileStart: () => SND.reveal(),
      onTile: (i, s) => { if (s === 'c') SND.tileCorrect(k++); else if (s === 'p') SND.tilePresent(); },
      onDone: () => {
        kb.setStates(C.keyboardStates(g.guesses, g.evals));
        if (won) {
          SND.win(g.guesses.length <= 2);
          UI.toast(stage, WIN_TITLES[g.guesses.length - 1], 1600);
          confetti(board.rowElement(r));
          board.bounceRow(r, { onDone: () => { busy = false; renderStrip(); setTimeout(openResult, 350); } });
        } else if (lost) {
          SND.lose();
          UI.toast(stage, C.displayWord(W, g.len, g.answer), 2200);
          busy = false; renderStrip(); setTimeout(openResult, 1700);
        } else { busy = false; kb.setEnabled(true); }
      },
    });
  }

  function recordEnd() {
    if (g.kind === 'train') { stats.training++; if (g.won) stats.trainingWon++; saveStats(); return; }
    if (stats.lastDay >= g.day) return;           // already counted
    stats.lastDay = g.day; stats.played++;
    if (g.won) {
      stats.won++; stats.dist[g.guesses.length - 1]++;
      stats.streak = stats.lastWinDay === g.day - 1 ? stats.streak + 1 : 1;
      stats.lastWinDay = g.day;
      stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
    } else stats.streak = 0;
    saveStats(); syncTabs();
  }
  const currentStreak = () => (stats.lastWinDay >= today() - 1 ? stats.streak : 0);

  document.addEventListener('keydown', e => {
    if (!$('sheet').hidden || e.ctrlKey || e.metaKey || e.altKey || mode === 'home') return;
    if (activePlugin) { if (activePlugin.onKeydown) activePlugin.onKeydown(e); return; }
    if (e.key === 'Enter') { e.preventDefault(); kb.flash('ENTER'); onEnter(); }
    else if (e.key === 'Backspace') { e.preventDefault(); kb.flash('BACK'); onBackspace(); }
    else { const ch = C.norm(e.key); if (ch.length === 1) { kb.flash(ch); onKey(ch); } }
  });

  // ---------- modes ----------
  function setMode(m) {
    if (busy || m === mode) return;
    const leaving = activePlugin;
    mode = m; SND.open();
    activePlugin = plugins.find(p => p.id === m) || null;
    if (leaving && leaving !== activePlugin && leaving.deactivate) leaving.deactivate();
    document.body.classList.toggle('at-home', m === 'home');
    if (m === 'home') { renderHome(); return; }
    ['stage', 'strip', 'kbd-host'].forEach(id => $(id).classList.toggle('plugin-off', !!activePlugin));
    pluginHost.hidden = !activePlugin; pluginKbd.hidden = !activePlugin;
    if (activePlugin) {
      if (!activePlugin._mounted) { activePlugin.mount(pluginHost, pluginApi); activePlugin._mounted = true; }
      if (activePlugin.activate) activePlugin.activate();
      syncTabs();
      return;
    }
    g = m === 'daily' ? newDaily(today()) : newTraining(false);
    renderAll();
    if (HOME && m === 'daily' && !store.get('howto', 0)) setTimeout(openHelp, 350);
  }
  $('tab-daily').dataset.mode = 'daily'; $('tab-train').dataset.mode = 'train';
  $('tab-daily').onclick = e => { e.currentTarget.blur(); firstGesture(); setMode('daily'); };
  $('tab-train').onclick = e => { e.currentTarget.blur(); firstGesture(); setMode('train'); };
  if (!OPT.training) $('tab-train').remove();

  // ---------- plugins: a game beside the word of the day (brouille.js; the private build adds its own) ----------
  // window.DM_PLUGINS = [{ id, tab, mount(host, api), activate(), deactivate(), onKeydown(e),
  //                        openHelp(), openStats(), setLayout(layout), onDayChange(day),
  //                        home(api, day) -> { title, status, done, art } for the home screen }]
  const plugins = window.DM_PLUGINS || [];
  let activePlugin = null;
  const pluginHost = document.createElement('div');
  pluginHost.id = 'plugin-host'; pluginHost.hidden = true;
  $('stage').after(pluginHost);
  const pluginKbd = document.createElement('div');          // plugins put their keyboard here, under the tabs
  pluginKbd.id = 'plugin-kbd'; pluginKbd.hidden = true;
  $('kbd-host').after(pluginKbd);
  plugins.forEach(p => {
    const t = document.createElement('button');
    t.setAttribute('role', 'tab'); t.dataset.mode = p.id; t.textContent = p.tab; t.setAttribute('aria-selected', 'false');
    t.onclick = e => { e.currentTarget.blur(); firstGesture(); setMode(p.id); };
    $('modes').insertBefore(t, OPT.training ? $('tab-train') : null);
  });
  if (plugins.length) document.body.classList.add('has-plugins');

  // ---------- home: the day's games, one big plaque each ----------
  const HOME = plugins.some(p => p.home);
  const homeEl = document.createElement('div');
  homeEl.id = 'home'; homeEl.hidden = !HOME;
  $('stage').before(homeEl);
  if (HOME) { $('top').after($('modes')); document.body.classList.add('has-home'); }   // big game tabs at the top
  function gameStatus(id) {
    if (id === 'daily') {
      const x = mode === 'daily' && g && g.day === today() ? g : newDaily(today()), n = x.guesses.length;
      const last = n ? x.evals[n - 1] : null;
      return { title: 'Le mot du jour', done: x.done,
        status: x.won ? `Trouvé en ${n} essai${n > 1 ? 's' : ''}` : x.done ? 'Pas trouvé cette fois'
              : n ? `En cours, ${n} essai${n > 1 ? 's' : ''} sur ${ROWS}` : 'À jouer',
        art: `<div class="home-tiles">${[0, 1, 2, 3, 4].map(i => `<i data-s="${last ? last[i] : ''}"></i>`).join('')}</div>` };
    }
    const p = plugins.find(q => q.id === id);
    return p && p.home ? p.home(pluginApi, today()) : {};
  }
  function renderHome() {
    $('plaque-num').textContent = '';
    $('subline').textContent = 'Les jeux du ' + longDate(now());
    homeEl.innerHTML = ['daily', ...plugins.filter(p => p.home).map(p => p.id)].map(id => {
      const st = gameStatus(id);
      return `<button class="home-card${st.done ? ' done' : ''}" data-mode="${id}">
        <span class="home-text"><b>${st.title}</b><small>${st.status}</small></span>${st.art || ''}</button>`;
    }).join('') + `<p class="home-next">Nouveaux jeux dans <b id="home-count">${hms(C.nextMidnightMs(now()))}</b></p>` + (OPT.homeNote || '');
    homeEl.querySelectorAll('.home-card').forEach(b => b.onclick = () => { firstGesture(); setMode(b.dataset.mode); });
    syncTabs();
  }
  $('plaque').onclick = () => { if (HOME && mode !== 'home' && !busy) { firstGesture(); setMode('home'); } };

  // ---------- confetti ----------
  function confetti(rowEl) {
    if (!rowEl || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = rowEl.getBoundingClientRect(), cols = ['var(--dm-correct)', 'var(--dm-present)', 'var(--dm-rim)', '#F06292'];
    for (let i = 0; i < 14; i++) {
      const c = document.createElement('i'); c.className = 'chip';
      c.style.left = (r.left + Math.random() * r.width) + 'px'; c.style.top = (r.top + r.height / 2) + 'px';
      c.style.background = cols[i % cols.length];
      c.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px');
      c.style.setProperty('--dy', (140 + Math.random() * 220) + 'px');
      c.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
      c.style.animationDelay = (Math.random() * 0.15) + 's';
      document.body.appendChild(c); setTimeout(() => c.remove(), 1600);
    }
  }

  // ---------- sheets ----------
  const sheet = $('sheet'), veil = $('veil'), body = $('sheet-body');
  let sheetName = null, sheetTimer = null;
  function openSheet(name, html, after) {
    clearInterval(sheetTimer);
    body.innerHTML = html;
    if (!sheetName) history.pushState({ sheet: name }, '');
    sheetName = name;
    sheet.hidden = false; veil.hidden = false;
    requestAnimationFrame(() => { sheet.classList.add('on'); veil.classList.add('on'); });
    if (after) after(body);
    sheet.scrollTop = 0;
  }
  function hideSheet() {
    clearInterval(sheetTimer);
    sheet.classList.remove('on'); veil.classList.remove('on');
    const was = sheetName; sheetName = null;
    setTimeout(() => { if (!sheetName) { sheet.hidden = true; veil.hidden = true; } }, 270);
    if (was === 'help') store.set('howto', 1);
  }
  function closeSheet() { firstGesture(); if (!sheetName) return; history.back(); }   // popstate does the hiding
  window.addEventListener('popstate', () => { if (sheetName) hideSheet(); });
  // Android back button (Capacitor App plugin): close the open sheet first, otherwise leave the app.
  const CapApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (CapApp) CapApp.addListener('backButton', () => {
    if (sheetName) closeSheet(); else if (HOME && mode !== 'home') setMode('home'); else CapApp.exitApp();
  });
  $('sheet-close').onclick = closeSheet; veil.onclick = closeSheet;
  // drag the sheet down to close it
  let dragY = null;
  sheet.addEventListener('touchstart', e => { if (sheet.scrollTop <= 0) dragY = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchmove', e => {
    if (dragY == null) return; const d = e.touches[0].clientY - dragY;
    if (d > 0) { sheet.style.transition = 'none'; sheet.style.transform = `translateY(${d}px)`; }
  }, { passive: true });
  sheet.addEventListener('touchend', e => {
    if (dragY == null) return; const d = e.changedTouches[0].clientY - dragY; dragY = null;
    sheet.style.transition = ''; sheet.style.transform = '';
    if (d > 90) closeSheet();
  });

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function plaques(word, state) {
    return [...word].map(ch => `<div class="dm-tile" data-state="${state}"><span>${esc(ch)}</span></div>`).join('');
  }
  function statsHtml(todayRow) {
    const pct = stats.played ? Math.round(100 * stats.won / stats.played) : 0;
    const max = Math.max(1, ...stats.dist);
    const dist = stats.dist.map((n, i) =>
      `<div class="dist-row"><span>${i + 1}</span><div class="dist-bar${todayRow === i ? ' today' : ''}" style="width:${Math.max(8, 100 * n / max)}%">${n}</div></div>`).join('');
    return `<div class="stats">
        <div class="stat"><b>${stats.played}</b><span>parties</span></div>
        <div class="stat"><b>${pct}%</b><span>victoires</span></div>
        <div class="stat"><b>${currentStreak()}</b><span>série</span></div>
        <div class="stat"><b>${stats.maxStreak}</b><span>record</span></div>
      </div>
      <h3>Nombre d’essais</h3><div class="dist">${dist}</div>`;
  }
  const wiki = w => 'https://fr.wiktionary.org/wiki/' + encodeURIComponent(w.toLowerCase());

  function openResult() {
    if (!g.done) return;
    SND.open();
    const disp = C.displayWord(W, g.len, g.answer);
    const title = g.won ? WIN_TITLES[g.guesses.length - 1] : 'Pas cette fois';
    const lead = g.won ? `Trouvé en ${g.guesses.length} essai${g.guesses.length > 1 ? 's' : ''}.` : 'Le mot à trouver :';
    if (g.kind === 'train') {
      openSheet('result', `<h2>${title}</h2><p class="result-lead">${lead}</p>
        <div class="answer">${plaques(disp, g.won ? 'c' : 'filled')}</div>
        <a class="def-link" href="${wiki(disp)}" target="_blank" rel="noopener">Définition sur le Wiktionnaire</a>
        <p style="margin-top:14px">Parties d’entraînement : <strong>${stats.training}</strong>, dont <strong>${stats.trainingWon}</strong> trouvées.</p>
        <div class="actions"><button class="btn btn-primary" id="r-next">Nouveau mot</button></div>`,
        b => { b.querySelector('#r-next').onclick = () => { closeSheet(); g = newTraining(true); renderAll(); }; });
      return;
    }
    openSheet('result', `<h2>${title}</h2><p class="result-lead">${lead}</p>
      <div class="answer">${plaques(disp, g.won ? 'c' : 'filled')}</div>
      <a class="def-link" href="${wiki(disp)}" target="_blank" rel="noopener">Définition sur le Wiktionnaire</a>
      <h3>Vos statistiques</h3>${statsHtml(g.won ? g.guesses.length - 1 : -1)}
      <div class="countdown">Prochain mot dans <b id="r-count"></b></div>
      <div class="actions"><button class="btn btn-primary" id="r-share">Partager</button>${OPT.training
        ? '<button class="btn btn-ghost" id="r-train">S’entraîner</button>'
        : plugins.filter(p => p.home).map(p => `<button class="btn btn-ghost" data-go="${p.id}">${p.cta || p.tab}</button>`).join('')}</div>`,
      b => {
        const tick = () => { const el = b.querySelector('#r-count'); if (el) el.textContent = hms(C.nextMidnightMs(now())); };
        tick(); sheetTimer = setInterval(tick, 1000);
        b.querySelector('#r-share').onclick = share;
        const go = m => () => { closeSheet(); setTimeout(() => setMode(m), 280); };
        if (b.querySelector('#r-train')) b.querySelector('#r-train').onclick = go('train');
        b.querySelectorAll('[data-go]').forEach(x => x.onclick = go(x.dataset.go));
        if (g.won && currentStreak() > 1) setTimeout(() => SND.streak(), 450);
      });
  }

  async function share() {
    const text = C.shareText({ dayIndex: g.day, evals: g.evals, won: g.won, hard: g.hard, contrast: settings.contrast });
    const Share = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
    try {
      if (Share) { await Share.share({ text }); return; }
      if (navigator.share) { await navigator.share({ text }); return; }
    } catch (e) { if (e && /cancel/i.test(String(e.message || e))) return; }
    try { await navigator.clipboard.writeText(text); UI.toast(body, 'Résultat copié'); }
    catch (e) { UI.toast(body, 'Impossible de partager'); }
  }

  function openStats() {
    SND.open();
    openSheet('stats', `<h2>Statistiques</h2><p>Le mot du jour, depuis votre première partie.</p>${statsHtml(-1)}${OPT.training ? `
      <p style="margin-top:18px">Entraînement : <strong>${stats.training}</strong> parties, <strong>${stats.trainingWon}</strong> mots trouvés.</p>` : ''}`);
  }

  function exampleRow(word, states) {
    const host = document.createElement('div'); host.className = 'ex';
    const b = UI.createBoard(host, { len: word.length, rows: 1 });
    b.paintRow(0, word, states);
    return host;
  }
  function openHelp() {
    SND.open();
    openSheet('help', `<h2>Comment jouer</h2>
      <p>Trouvez le mot de cinq lettres en six essais. Chaque essai doit être un mot du dictionnaire. Les accents ne comptent pas : tapez E pour É, È ou Ê.</p>
      <h3>Après chaque essai, les plaques changent de couleur</h3>
      <div id="ex1"></div><p><strong>R</strong> est dans le mot, à la bonne place.</p>
      <div id="ex2"></div><p><strong>A</strong> est dans le mot, mais ailleurs.</p>
      <div id="ex3"></div><p>Aucune de ces lettres n’est dans le mot.</p>
      <h3>Un mot par jour</h3>
      <p>Le mot du jour est le même pour tout le monde et change à minuit.${OPT.training ? ' En entraînement, vous jouez autant que vous voulez, avec des mots de 5, 6 ou 7 lettres.' : ''}</p>
      <div class="actions"><button class="btn btn-primary" id="h-go">Jouer</button></div>`,
      b => {
        b.querySelector('#ex1').replaceWith(exampleRow('ROUTE', ['c', 'a', 'a', 'a', 'a']));
        b.querySelector('#ex2').replaceWith(exampleRow('PLAGE', ['a', 'a', 'p', 'a', 'a']));
        b.querySelector('#ex3').replaceWith(exampleRow('BIJOU', ['a', 'a', 'a', 'a', 'a']));
        b.querySelector('#h-go').onclick = closeSheet;
      });
  }

  function openSettings() {
    SND.open();
    const dailyStarted = g.kind === 'daily' && g.guesses.length > 0 && !g.done;
    const sw = (id, on, dis) => `<button class="switch" role="switch" id="${id}" aria-checked="${on}"${dis ? ' disabled' : ''}></button>`;
    openSheet('settings', `<h2>Réglages</h2>
      <div class="setting"><div><b>Sons</b><small>Touches, plaques, victoire</small></div>${sw('s-sfx', SND._sfxOn)}</div>
      <div class="setting"><div><b>Musique</b><small>Une boucle calme en fond</small></div>${sw('s-music', SND._musicOn)}</div>
      <div class="setting"><div><b>Mode difficile</b><small>${dailyStarted ? 'Changera au prochain mot du jour' : 'Les lettres trouvées doivent être réutilisées'}</small></div>${sw('s-hard', settings.hard)}</div>
      <div class="setting"><div><b>Contraste élevé</b><small>Orange et bleu, avec une marque sur chaque plaque</small></div>${sw('s-hc', settings.contrast)}</div>
      <div class="setting setting-stack"><div><b>Clavier</b><small id="s-kbd-note"></small></div>
        <div class="seg seg-wide" role="group" id="s-kbd">${['auto', 'azerty', 'qwertz', 'qwerty'].map(k =>
          `<button data-kbd="${k}" aria-pressed="${settings.keyboard === k}">${k === 'auto' ? 'Auto' : KBD_NAMES[k]}</button>`).join('')}</div></div>
      ${OPT.training ? `<div class="setting"><div><b>Entraînement</b><small>Longueur des mots</small></div>
        <div class="seg" role="group">${[5, 6, 7].map(n => `<button data-len="${n}" aria-pressed="${settings.trainLen === n}">${n}</button>`).join('')}</div></div>` : ''}
      <p class="about">${OPT.about || 'Devine-moi ' + VERSION}. Sans publicité, sans compte, sans connexion.<br>
      Les mots des deux jeux, et les échelles du mot brouillé, viennent de Lexique 3.83 (New, Pallier, Brysbaert, Ferrand, lexique.org, licence CC BY-SA 4.0) ; les formes acceptées au mot du jour, aussi du dictionnaire Dicollecte (MPL 2.0).
      Sons : Kenney (CC0). Musique : « Lofi Hip Hop Loop » d’omfgdude (CC0). Police : Fraunces (OFL).<br>
      © 2026 Pierre Gallaz, licence MIT. <a href="https://github.com/funkypitt/devine-moi" target="_blank" rel="noopener">Code source</a></p>`,
      b => {
        const flip = (id, fn) => { const el = b.querySelector('#' + id); el.onclick = () => { const v = el.getAttribute('aria-checked') !== 'true'; el.setAttribute('aria-checked', v); fn(v); SND.key(); }; };
        flip('s-sfx', v => SND.sfxToggle(v));
        flip('s-music', v => { SND.musicToggle(v); syncMusicBtn(); });
        flip('s-hard', v => { settings.hard = v; saveSettings(); if (g.guesses.length === 0 || g.kind === 'train') { g.hard = v; renderHeader(); } });
        flip('s-hc', v => { settings.contrast = v; saveSettings(); document.body.classList.toggle('dm-hc', v); });
        const kbdNote = () => { b.querySelector('#s-kbd-note').textContent = settings.keyboard === 'auto'
          ? `Comme le téléphone (${phoneLocale()}) : ${KBD_NAMES[layoutFor('auto')]}` : 'Choisi à la main'; };
        kbdNote();
        b.querySelectorAll('#s-kbd button').forEach(btn => btn.onclick = () => {
          settings.keyboard = btn.dataset.kbd; saveSettings(); SND.key();
          b.querySelectorAll('#s-kbd button').forEach(x => x.setAttribute('aria-pressed', x === btn));
          kb.setLayout(layoutFor(settings.keyboard)); kbdNote();
          plugins.forEach(p => p._mounted && p.setLayout && p.setLayout(layoutFor(settings.keyboard)));
        });
        b.querySelectorAll('.seg button[data-len]').forEach(btn => btn.onclick = () => {
          settings.trainLen = +btn.dataset.len; saveSettings(); SND.key();
          b.querySelectorAll('.seg button[data-len]').forEach(x => x.setAttribute('aria-pressed', x === btn));
          if (g.kind === 'train' && g.guesses.length === 0 && g.len !== settings.trainLen) { g = newTraining(true); renderAll(); }
        });
      });
  }
  $('btn-help').onclick = () => (activePlugin && activePlugin.openHelp ? activePlugin.openHelp() : openHelp());
  $('btn-stats').onclick = () => (activePlugin && activePlugin.openStats ? activePlugin.openStats() : openStats());
  $('btn-settings').onclick = openSettings;
  function syncMusicBtn() { $('btn-music').classList.toggle('off', !SND._musicOn); $('btn-music').setAttribute('aria-pressed', SND._musicOn); }
  $('btn-music').onclick = () => { started = true; SND.musicToggle(); syncMusicBtn(); };

  // ---------- day change, background ----------
  let shownDay = today();
  setInterval(() => {
    const d = today();
    if (d !== shownDay) {
      shownDay = d;
      plugins.forEach(p => p._mounted && p.onDayChange && p.onDayChange(d));
      if (mode === 'home') renderHome();
      if (mode === 'daily' && g.day !== d) {
        if (g.done || g.guesses.length === 0) { g = newDaily(d); renderAll(); }
        else $('newday').hidden = false;
      }
    }
    if (mode === 'home') { const el = $('home-count'); if (el) el.textContent = hms(C.nextMidnightMs(now())); }
  }, 1000);
  $('newday-btn').onclick = () => { $('newday').hidden = true; mode = 'daily'; g = newDaily(today()); renderAll(); SND.open(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) SND.suspend(); else { SND.resume(); kb.setLayout(layoutFor(settings.keyboard)); } });
  window.addEventListener('languagechange', () => kb.setLayout(layoutFor(settings.keyboard)));

  const pluginApi = {
    kbdHost: pluginKbd, store, now, today, dateOfIndex: i => C.dateOfIndex(i, EPOCH), longDate, hms, confetti,
    openSheet, closeSheet, toast: (msg, ms) => UI.toast(activePlugin ? pluginHost : stage, msg, ms),
    firstGesture, layout: () => layoutFor(settings.keyboard), get contrast() { return settings.contrast; },
    setHeader(num, sub) { if (activePlugin) { $('plaque-num').textContent = num; $('subline').textContent = sub; } },
    isActive: p => activePlugin === p,
    refresh: syncTabs,                                     // a game changed state (finished): update the tab marks
  };

  // ---------- start ----------
  g = newDaily(today());
  syncMusicBtn();
  renderAll();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  if (HOME) { mode = 'home'; document.body.classList.add('at-home'); renderHome(); }
  else if (!store.get('howto', 0)) setTimeout(openHelp, 400);
  else if (g.done) setTimeout(openResult, 500);
  window.__dm = { get g() { return g; }, stats, settings };   // inspection from DevTools
})();
