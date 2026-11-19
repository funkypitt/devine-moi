// Le mot brouillé du jour — the second daily game of Devine-moi, written as a plugin of app.js.
// Data: window.BROUILLE = { days: [ { w: [six words, 4 to 9 letters, as displayed], ok: [six lists of other anagrams] } ] }
// Each word is written with the letters of the previous one plus a new letter. The words of 4 to 8 letters are
// the game; the 9-letter word is a bonus. Any word of the dictionary made of all the letters is accepted.
(function () {
  'use strict';
  const C = DevineCore, DATA = window.BROUILLE;
  if (!DATA || !DATA.days || !DATA.days.length) return;
  const P = 'br:', MAIN = 5, ALL = 6;           // five words to find, then the bonus
  let api, root, ladderEl, capEl, trayEl, toolsEl;
  let day = 0, Z = null, S = null;              // the day's puzzle, saved state
  let tickTimer = null, running = false, lastTick = 0, active = false, busy = false;

  // ---------- model ----------
  const puzzleOf = d => {
    const n = DATA.days.length, p = DATA.days[((d % n) + n) % n];
    return { w: p.w, n: p.w.map(C.norm), ok: p.ok.map(l => new Set(l)) };
  };
  const sig = d => puzzleOf(d).w.join('');
  // the same shuffle for everyone on the same day
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function shuffled(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const isWord = (k, word) => word === Z.n[k] || Z.ok[k].has(word);
  // lay the letters of step k on the tray, never in the order of a word
  function deal(k) {
    const word = Z.n[k], rand = rng((day + 1) * 97 + k * 13);
    let fresh = null;
    if (k > 0) { const left = [...Z.n[k - 1]]; for (let i = 0; i < word.length; i++) { const j = left.indexOf(word[i]); if (j < 0) { fresh = i; break; } left.splice(j, 1); } }
    let tray = [...word].map((c, id) => ({ c, id }));
    for (let n = 0; n < 30; n++) { tray = shuffled(tray, rand); if (!isWord(k, tray.map(t => t.c).join(''))) break; }
    S.tray = tray; S.fresh = fresh;
    S.slots = new Array(word.length).fill(null); S.locked = new Array(word.length).fill(false);
  }

  // ---------- persistence ----------
  const blank = d => ({ step: 0, found: [], tray: null, slots: [], locked: [], fresh: null, hints: 0, hintsBy: [0, 0, 0, 0, 0, 0],
    t: 0, done: false, bonus: false, sig: sig(d) });
  const load = d => { const s = api.store.get(P + 'day:' + d, null); return s && s.sig === sig(d) ? Object.assign(blank(d), s) : blank(d); };
  const save = () => api.store.set(P + 'day:' + day, S);
  const stats = () => Object.assign({ done: 0, clean: 0, bonus: 0, streak: 0, maxStreak: 0, lastDay: -9, best: 0 }, api.store.get(P + 'stats', {}));

  // ---------- chrono (runs until the fifth word; the bonus is not timed) ----------
  const clock = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmt = ms => { const s = Math.round(ms / 1000), m = Math.floor(s / 60); return m ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`; };
  const elapsed = () => S.t + (running ? Date.now() - lastTick : 0);
  function header() {
    if (!api.isActive(plugin)) return;
    const date = api.longDate(api.dateOfIndex(day)), t = S.t || running ? ', ' + clock(elapsed()) : '';
    // one line even on a narrow phone
    api.setHeader('brouillé n°' + (day + 1), S.done ? `Fini en ${clock(S.t)}, le ${date}` : 'Le mot brouillé du ' + date + t);
  }
  function startClock() {
    if (running || S.done || !active || document.hidden) return;
    running = true; lastTick = Date.now(); tickTimer = setInterval(header, 1000);
  }
  function stopClock() {
    if (!running) return;
    S.t += Date.now() - lastTick; running = false; clearInterval(tickTimer); save();
  }

  // ---------- rendering ----------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tile = (ch, state, extra) => `<div class="dm-tile${extra || ''}"${state ? ` data-state="${state}"` : ''}><span>${esc(ch || '')}</span></div>`;
  const shown = k => (S.found[k] === Z.n[k] ? Z.w[k] : S.found[k]);          // with its accents when it is the day's word
  const letterOf = id => S.tray.find(t => t.id === id).c;
  const finished = () => S.step >= ALL;
  function render() {
    const rows = S.done ? ALL : MAIN, longest = rows + 3;
    const st = root.querySelector('.br-stage').getBoundingClientRect();
    const size = Math.max(24, Math.floor(Math.min((st.width - 24 - 5 * (longest - 1)) / longest, (st.height - 8 - 7 * (rows - 1)) / rows, 54)));
    ladderEl.style.setProperty('--tile', size + 'px');
    let h = '';
    for (let k = 0; k < rows; k++) {
      const len = k + 4;
      if (k < S.step) h += `<div class="br-row br-found" aria-label="${esc(shown(k))}">${[...shown(k)].map(c => tile(c, 'c')).join('')}</div>`;
      else if (k === S.step) h += `<div class="br-row br-cur" data-k="${k}">${S.slots.map((id, i) =>
        `<button class="dm-tile br-slot${S.locked[i] ? ' br-lock' : ''}" data-i="${i}"${id == null ? '' : ` data-state="${S.locked[i] ? 'c' : 'filled'}"`} aria-label="${id == null ? 'case vide' : letterOf(id)}"><span>${id == null ? '' : letterOf(id)}</span></button>`).join('')}</div>`;
      else h += `<div class="br-row br-later" aria-hidden="true">${tile('', '').repeat(len)}</div>`;
    }
    ladderEl.innerHTML = h;

    const over = finished(), n = over ? 0 : S.tray.length;
    capEl.textContent = over ? '' : S.step === 0 ? 'Un mot de 4 lettres' : S.step === MAIN ? 'Le mot bonus : 9 lettres'
      : `Un mot de ${n} lettres, avec la nouvelle lettre`;
    trayEl.hidden = over; capEl.hidden = over;
    if (!over) {
      const per = n <= 6 ? n : Math.ceil(n / 2), w = root.getBoundingClientRect().width;
      const ts = Math.max(34, Math.floor(Math.min(58, (w - 32 - 8 * (per - 1)) / per)));
      trayEl.style.setProperty('--tile', ts + 'px');
      trayEl.style.width = (per * ts + (per - 1) * 8) + 'px';
      const placed = new Set(S.slots.filter(x => x != null));
      trayEl.innerHTML = S.tray.map(t =>
        `<button class="dm-tile br-t${placed.has(t.id) ? ' br-used' : ''}" data-id="${t.id}" data-state="${t.id === S.fresh ? 'p' : 'filled'}"${placed.has(t.id) ? ' disabled aria-hidden="true"' : ''} aria-label="${t.c}${t.id === S.fresh ? ', nouvelle lettre' : ''}"><span>${t.c}</span></button>`).join('');
    }
    toolsEl.innerHTML = over
      ? `<span class="br-next">Prochain mot brouillé dans <b>${api.hms(C.nextMidnightMs(api.now()))}</b></span><button data-a="result">Voir le résultat</button>`
      : `<button data-a="shuffle">Mélanger</button><button data-a="clear">Effacer</button><button data-a="hint">Indice</button>${S.done ? '<button data-a="result">Résultat</button>' : ''}`;
  }

  // ---------- playing ----------
  function place(id) {
    if (busy || finished()) return;
    api.firstGesture(); startClock();
    if (S.slots.includes(id)) return;
    const i = S.slots.indexOf(null); if (i < 0) return;
    S.slots[i] = id; SND.key(); save(); render();
    const el = ladderEl.querySelector(`.br-slot[data-i="${i}"]`); if (el) el.classList.add('dm-pop');
    if (!S.slots.includes(null)) validate();
  }
  function takeBack(i) {
    if (busy || finished() || S.locked[i] || S.slots[i] == null) return;
    api.firstGesture(); S.slots[i] = null; SND.erase(); save(); render();
  }
  function clearRow() {
    if (busy || finished()) return;
    api.firstGesture();
    if (!S.slots.some((id, i) => id != null && !S.locked[i])) return;
    S.slots = S.slots.map((id, i) => (S.locked[i] ? id : null)); SND.erase(); save(); render();
  }
  function shuffle() {
    if (busy || finished()) return;
    api.firstGesture(); startClock();
    const before = S.tray.map(t => t.id).join();
    for (let n = 0; n < 8 && S.tray.map(t => t.id).join() === before; n++) S.tray = shuffled(S.tray, Math.random);
    SND.key(); save(); render();
    trayEl.querySelectorAll('.br-t:not(.br-used)').forEach(el => el.classList.add('dm-pop'));
  }
  function hint() {
    if (busy || finished()) return;
    api.firstGesture(); startClock();
    const k = S.step, i = S.locked.indexOf(false); if (i < 0) return;
    const need = Z.n[k][i];
    if (S.slots[i] == null || letterOf(S.slots[i]) !== need) {
      S.slots[i] = null;
      const free = S.tray.find(t => t.c === need && !S.slots.includes(t.id));
      if (free) S.slots[i] = free.id;
      else { const j = S.slots.findIndex((id, x) => id != null && !S.locked[x] && letterOf(id) === need); S.slots[i] = S.slots[j]; S.slots[j] = null; }
    }
    S.locked[i] = true; S.hints++; S.hintsBy[k]++;
    SND.tilePresent(); save(); render();
    if (!S.slots.includes(null)) validate();
  }
  function validate() {
    const k = S.step, word = S.slots.map(letterOf).join('');
    if (!isWord(k, word)) {
      SND.invalid(); api.toast('Ce mot n’est pas dans le dictionnaire');
      const row = ladderEl.querySelector('.br-cur'); if (row) { row.classList.remove('dm-shake'); void row.offsetWidth; row.classList.add('dm-shake'); }
      return;
    }
    // commit before the animation, so leaving the app mid-reveal never loses the word
    busy = true;
    S.found[k] = word; S.step = k + 1;
    if (k === MAIN - 1) { stopClock(); S.done = true; record(); }
    if (k === MAIN) { S.bonus = true; const st = stats(); st.bonus++; api.store.set(P + 'stats', st); }
    if (S.step < ALL) deal(S.step); else { S.tray = null; S.slots = []; S.locked = []; }
    save();
    const tiles = [...ladderEl.querySelectorAll('.br-cur .dm-tile')], disp = shown(k);
    tiles.forEach((el, i) => setTimeout(() => {
      el.dataset.state = 'c'; el.classList.remove('dm-pop'); el.classList.add('dm-flip-in'); el.firstChild.textContent = disp[i]; SND.tileCorrect(i);
    }, 70 * i));
    const after = 70 * tiles.length + 380;
    if (k >= MAIN - 1) setTimeout(() => { SND.win(!S.hints); api.confetti(ladderEl.querySelector('.br-cur')); header(); }, after - 200);
    setTimeout(() => {
      busy = false; render(); header();
      if (k >= MAIN - 1) { if (api.refresh) api.refresh(); setTimeout(openResult, 700); }
      else { const el = trayEl.querySelector(`[data-id="${S.fresh}"]`); if (el) el.classList.add('dm-bounce'); }
    }, after);
  }
  function record() {
    const st = stats();
    if (day !== api.today() || st.lastDay >= day) return;
    st.done++; if (!S.hints) st.clean++;
    st.streak = st.lastDay === day - 1 ? st.streak + 1 : 1; st.lastDay = day;
    st.maxStreak = Math.max(st.maxStreak, st.streak);
    if (!S.hints && (!st.best || S.t < st.best)) st.best = S.t;
    api.store.set(P + 'stats', st);
  }

  // ---------- sheets ----------
  const wiki = w => 'https://fr.wiktionary.org/wiki/' + encodeURIComponent(w.toLowerCase());
  const helpsText = () => (!S.hints ? 'sans indice' : S.hints === 1 ? 'avec un indice' : `avec ${S.hints} indices`);
  function statsBlock(st) {
    const streak = st.lastDay >= api.today() - 1 ? st.streak : 0;
    return `<div class="stats">
      <div class="stat"><b>${st.done}</b><span>jours</span></div>
      <div class="stat"><b>${streak}</b><span>série</span></div>
      <div class="stat"><b>${st.bonus}</b><span>bonus</span></div>
      <div class="stat"><b>${st.best ? clock(st.best) : '–'}</b><span>chrono</span></div></div>`;
  }
  function openResult() {
    if (!S.done) return;
    SND.open();
    const title = S.bonus ? 'Tout trouvé !' : !S.hints ? (S.t < 90000 ? 'Éclair !' : 'Bravo !') : 'C’est fait';
    const rows = S.found.map((f, k) => `<div><span>${k === MAIN ? 'Bonus' : (k + 4) + ' lettres'}</span>
      <a href="${wiki(shown(k))}" target="_blank" rel="noopener">${esc(shown(k))}</a></div>`).join('');
    api.openSheet('br-result', `<h2>${title}</h2>
      <p class="result-lead">Les cinq mots en <strong>${fmt(S.t)}</strong>, ${helpsText()}${S.bonus ? ', et le mot bonus' : ''}.</p>
      ${statsBlock(stats())}
      <h3>Vos mots</h3><div class="br-sol">${rows}</div>
      <div class="actions">${S.bonus ? '' : '<button class="btn btn-primary" id="br-bonus">Le mot bonus</button>'}
        <button class="btn ${S.bonus ? 'btn-primary' : 'btn-ghost'}" id="br-share">Partager</button></div>`,
      b => {
        b.querySelector('#br-share').onclick = share;
        const go = b.querySelector('#br-bonus'); if (go) go.onclick = api.closeSheet;
      });
  }
  async function share() {
    const marks = S.found.slice(0, MAIN).map((_, k) => (S.hintsBy[k] ? '🟨' : '🟩')).join('') + (S.bonus ? (S.hintsBy[MAIN] ? ' 🟨' : ' ⭐') : '');
    const text = `Le mot brouillé n°${day + 1}\n${marks}\n${clock(S.t)}, ${helpsText()}`;
    const Share = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
    try { if (Share) return await Share.share({ text }); if (navigator.share) return await navigator.share({ text }); } catch (e) { return; }
    try { await navigator.clipboard.writeText(text); api.toast('Résultat copié'); } catch (e) {}
  }
  function openStats() {
    SND.open();
    api.openSheet('br-stats', `<h2>Le mot brouillé</h2>
      <p>La série compte les jours où les cinq mots ont été trouvés. Le chrono est le meilleur temps sans indice.</p>${statsBlock(stats())}`);
  }
  function openHelp() {
    SND.open();
    api.openSheet('br-help', `<h2>Le mot brouillé</h2>
      <p>Remettez les lettres dans l’ordre pour former un mot. Touchez une lettre pour la poser, touchez-la dans le mot pour la reprendre.</p>
      <p>À chaque mot trouvé, une lettre de plus arrive, en jaune : il faut alors un mot plus long, avec toutes les lettres. On part de quatre lettres et on monte jusqu’à huit.</p>
      <p>Tout mot du dictionnaire fait de ces lettres est accepté. Les accents ne comptent pas.</p>
      <h3>Les aides</h3>
      <p><strong>Mélanger</strong> change l’ordre des lettres, pour les voir autrement. <strong>Indice</strong> pose la lettre suivante du mot à sa place ; les indices sont notés dans le résultat.</p>
      <h3>Le mot bonus</h3>
      <p>Après le mot de huit lettres, un dernier mot de neuf lettres vous attend. Il ne compte ni dans le temps ni dans la série.</p>
      <div class="actions"><button class="btn btn-primary" id="br-go">Jouer</button></div>`, b => b.querySelector('#br-go').onclick = api.closeSheet);
  }

  // ---------- day switching ----------
  function open(d) {
    if (running) stopClock();
    day = d; Z = puzzleOf(d); S = load(d); busy = false;
    if (!finished() && !S.tray) { deal(S.step); }
    render(); header();
  }

  // ---------- plugin ----------
  const plugin = {
    id: 'brouille', tab: 'Mot brouillé', cta: 'Faire le mot brouillé',
    home(a, d) {
      api = api || a;
      const s = load(d);
      return { title: 'Le mot brouillé', done: s.done,
        status: s.done ? `Fini en ${fmt(s.t)}` + (s.bonus ? ', bonus trouvé' : '') : s.step || s.t ? `En cours, ${s.step} mot${s.step > 1 ? 's' : ''} sur ${MAIN}` : 'À faire',
        art: `<div class="br-home-art" aria-hidden="true">${[2, 3, 4].map((n, r) => `<span>${(r < Math.ceil(s.step * 3 / MAIN) ? '<i class="on"></i>' : '<i></i>').repeat(n)}</span>`).join('')}</div>` };
    },
    mount(h, a) {
      api = a;
      root = document.createElement('div'); root.className = 'br';
      root.innerHTML = `<div class="br-stage"><div class="br-ladder" aria-label="Les mots trouvés"></div></div>
        <p class="br-cap" role="status" aria-live="polite"></p><div class="br-tray" role="group" aria-label="Les lettres"></div>
        <div class="br-tools"></div>`;
      h.appendChild(root);
      ladderEl = root.querySelector('.br-ladder'); capEl = root.querySelector('.br-cap');
      trayEl = root.querySelector('.br-tray'); toolsEl = root.querySelector('.br-tools');
      trayEl.addEventListener('pointerdown', e => { const b = e.target.closest('.br-t'); if (b && !b.disabled) { e.preventDefault(); place(+b.dataset.id); } });
      ladderEl.addEventListener('pointerdown', e => { const b = e.target.closest('.br-slot'); if (b) { e.preventDefault(); takeBack(+b.dataset.i); } });
      toolsEl.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        ({ shuffle, clear: clearRow, hint, result: openResult })[b.dataset.a]();
      });
      window.addEventListener('resize', () => { if (active && !busy) render(); });
      document.addEventListener('visibilitychange', () => { if (document.hidden) stopClock(); });
      setInterval(() => { if (active && finished()) { const el = toolsEl.querySelector('.br-next b'); if (el) el.textContent = api.hms(C.nextMidnightMs(api.now())); } }, 1000);
      day = api.today();
      api.store.keys().forEach(k => { const m = k.match(/br:day:(-?\d+)$/); if (m && +m[1] < day - 30) api.store.del(P + 'day:' + m[1]); });
      if (!api.store.get(P + 'howto', 0)) { api.store.set(P + 'howto', 1); setTimeout(openHelp, 350); }
    },
    activate() { active = true; root.hidden = false; open(day); },
    deactivate() { active = false; root.hidden = true; stopClock(); },
    onKeydown(e) {
      if (busy || finished()) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        let i = S.slots.length - 1; while (i >= 0 && (S.slots[i] == null || S.locked[i])) i--;
        if (i >= 0) takeBack(i);
      } else if (e.key === ' ') { e.preventDefault(); shuffle(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (!S.slots.includes(null)) validate(); }
      else {
        const ch = C.norm(e.key); if (ch.length !== 1) return;
        const t = S.tray.find(x => x.c === ch && !S.slots.includes(x.id));
        if (t) place(t.id);
      }
    },
    openHelp, openStats,
    onDayChange(d) { if (!S || S.done || (!S.step && !S.t)) { if (active) open(d); else day = d; } },
  };
  (window.DM_PLUGINS = window.DM_PLUGINS || []).push(plugin);
}());
