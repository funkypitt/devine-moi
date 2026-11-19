const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../devine-core.js');
const ev = (g, a) => C.evaluate(g, a).join(' ');

test('evaluate: double letters', () => {
  assert.equal(ev('ALLEE', 'ELLES'), 'a c c c p');
  assert.equal(ev('SELLE', 'ELLES'), 'p p c p p');
  assert.equal(ev('ESSES', 'TASSE'), 'p p c a a');
  assert.equal(ev('NAINS', 'PANNE'), 'p c a c a');
  assert.equal(ev('PANNE', 'PANNE'), 'c c c c c');
  assert.equal(ev('BOUCH', 'ZESTA'), 'a a a a a');
  assert.equal(ev('EEEEE', 'ELEVE'), 'c a c a c');
});

test('isWin', () => {
  assert.ok(C.isWin(['c', 'c', 'c', 'c', 'c']));
  assert.ok(!C.isWin(['c', 'c', 'p', 'c', 'c']));
});

test('keyboardStates: c > p > a', () => {
  const g = ['ROUTE', 'TERRE'], e = [C.evaluate('ROUTE', 'TERRE'), C.evaluate('TERRE', 'TERRE')];
  const s = C.keyboardStates(g, e);
  assert.equal(s.T, 'c'); assert.equal(s.R, 'c'); assert.equal(s.O, 'a'); assert.equal(s.E, 'c');
  const s2 = C.keyboardStates(['ABCDE', 'FGAHI'], [['p', 'a', 'a', 'a', 'a'], ['a', 'a', 'a', 'a', 'a']]);
  assert.equal(s2.A, 'p', 'a grey never overwrites a yellow');
});

test('hardModeViolation', () => {
  const g = ['ROUTE'], e = [C.evaluate('ROUTE', 'TORSE')];   // R p, O c, U a, T p, E c
  assert.equal(C.hardModeViolation('BASSE', g, e), 'La 2e lettre doit être O');
  assert.equal(C.hardModeViolation('POMME', g, e), 'Le mot doit contenir R');
  assert.equal(C.hardModeViolation('TORSE', g, e), null);
  assert.equal(C.hardModeViolation('XYZAB', [], []), null);
  assert.equal(C.hardModeViolation('ARBRE', ['ABCDE'], [['c','a','a','a','a']]), null);
  assert.equal(C.hardModeViolation('BRBRE', ['ABCDE'], [['c','a','a','a','a']]), 'La 1re lettre doit être A');
});

test('dayIndex: local midnights, DST-proof', () => {
  const E = '2026-10-30';
  assert.equal(C.dayIndex(new Date(2026, 9, 30, 0, 1), E), 0);
  assert.equal(C.dayIndex(new Date(2026, 9, 30, 23, 59), E), 0);
  assert.equal(C.dayIndex(new Date(2026, 9, 31, 0, 0), E), 1);
  assert.equal(C.dayIndex(new Date(2026, 10, 1), E), 2);
  assert.equal(C.dayIndex(new Date(2027, 2, 28), E), 149);
  assert.equal(C.dayIndex(new Date(2027, 2, 29), E), 150);
  assert.equal(C.dayIndex(new Date(2026, 9, 29), E), -1);
  for (let i = -3; i < 800; i += 37) assert.equal(C.dayIndex(C.dateOfIndex(i, E), E), i);
  const ms = C.nextMidnightMs(new Date(2026, 9, 30, 23, 0, 0));
  assert.equal(ms, 3600000);
});

test('norm matches the Python builder', () => {
  assert.equal(C.norm('élève'), 'ELEVE');
  assert.equal(C.norm('cœur'), 'COEUR');
  assert.equal(C.norm("aujourd'hui"), '');
  assert.equal(C.norm('Été'), 'ETE');
  assert.equal(C.norm('porte-clé'), '');
});

test('word data', () => {
  global.window = {};
  require('../words-fr.js');
  const W = C.prepare(window.DEVINE_WORDS);
  for (const L of [5, 6, 7]) {
    assert.ok(W[L].answersArr.length > 1000);
    assert.equal(W[L].answersArr.length, W[L].displayArr.length);
    W[L].answersArr.forEach((a, i) => { assert.equal(a.length, L); assert.equal(C.norm(W[L].displayArr[i]), a); assert.ok(W[L].allowedSet.has(a)); });
  }
  assert.equal(C.dailyAnswer(W, 5, 0), W[5].answersArr[0]);
  assert.equal(C.dailyAnswer(W, 5, -1), W[5].answersArr[W[5].answersArr.length - 1]);
  assert.equal(C.dailyAnswer(W, 5, W[5].answersArr.length), W[5].answersArr[0]);
  assert.ok(C.isAllowed(W, 5, 'ETAIT'));
  assert.ok(!C.isAllowed(W, 5, 'XQZWV'));
  assert.equal(C.displayWord(W, 5, C.norm('élève')), 'ÉLÈVE');
  const rng = C.mulberry32(42), avoid = new Set();
  for (let i = 0; i < 20; i++) { const w = C.randomAnswer(W, 6, rng, avoid); assert.ok(!avoid.has(w)); avoid.add(w); }
});

test('shareText never contains the word', () => {
  const evals = [C.evaluate('ROUTE', 'TERRE'), C.evaluate('TARIR', 'TERRE'), C.evaluate('TERRE', 'TERRE')];
  assert.equal(C.shareText({ dayIndex: 11, evals, won: true }),
    'Devine-moi n°12 3/6\n\n🟨⬛⬛🟨🟩\n🟩⬛🟩⬛🟨\n🟩🟩🟩🟩🟩');
  const lost = Array(6).fill(['a', 'p', 'a', 'a', 'c']);
  const t = C.shareText({ dayIndex: 0, evals: lost, won: false, hard: true, contrast: true });
  assert.ok(t.startsWith('Devine-moi n°1 X/6*\n\n⬛🟦⬛⬛🟧'));
  assert.ok(!t.includes('TERRE'));
});

test('scoreGuess (2-player duel)', () => {
  // NAINS vs PANNE: p c a c a
  let s = C.scoreGuess(C.evaluate('NAINS', 'PANNE'), [], 'NAINS', []);
  assert.deepEqual([s.green, s.yellow, s.points], [2, 1, 5]);
  const g = ['NAINS'], e = [C.evaluate('NAINS', 'PANNE')];
  s = C.scoreGuess(C.evaluate('NAINS', 'PANNE'), e, 'NAINS', g);
  assert.equal(s.points, 0, 'the same row again earns nothing');
  s = C.scoreGuess(C.evaluate('PANNE', 'PANNE'), e, 'PANNE', g);
  assert.deepEqual([s.green, s.yellow, s.win, s.points], [3, 0, true, 11]);
  // a new letter arriving straight in green is worth 2, not 3
  s = C.scoreGuess(C.evaluate('PXXXX', 'PANNE'), [], 'PXXXX', []);
  assert.equal(s.points, 2);
  // same letter yellow twice in one row counts once
  s = C.scoreGuess(C.evaluate('ELLES', 'SELLE'), [], 'ELLES', []);
  assert.deepEqual([s.green, s.yellow, s.points], [1, 3, 5], 'p p c p p: L green once, E L S yellow once each');
});

test('keyboard layout follows the phone locale', () => {
  const k = C.keyboardLayoutFor;
  assert.equal(k('fr-CH'), 'qwertz', 'Swiss French phones type on QWERTZ');
  assert.equal(k('fr-FR'), 'azerty');
  assert.equal(k('fr-BE'), 'azerty');
  assert.equal(k('fr'), 'azerty');
  assert.equal(k('fr-CA'), 'qwerty');
  assert.equal(k('de-CH'), 'qwertz');
  assert.equal(k('de-DE'), 'qwertz');
  assert.equal(k('it-CH'), 'qwertz');
  assert.equal(k('it-IT'), 'qwerty');
  assert.equal(k('rm-CH'), 'qwertz');
  assert.equal(k('en-US'), 'qwerty');
  assert.equal(k('fr_CH'), 'qwertz', 'underscore form');
  assert.equal(k('fr-Latn-CH'), 'qwertz', 'script subtag');
  assert.equal(k(''), 'qwerty');
  assert.equal(k(undefined), 'qwerty');
});
