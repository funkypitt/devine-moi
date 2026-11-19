const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../devine-core.js');

const box = { window: {} };
vm.runInNewContext(fs.readFileSync(__dirname + '/../brouille-data.js', 'utf8'), box);
const days = box.window.BROUILLE.days;
const letters = w => [...C.norm(w)].sort().join('');

test('mot brouillé: more than a year of ladders', () => {
  assert.ok(days.length > 366);
});

test('mot brouillé: six words of 4 to 9 letters, each the previous one plus a letter', () => {
  days.forEach((d, i) => {
    assert.equal(d.w.length, 6, 'day ' + i);
    assert.equal(d.ok.length, 6, 'day ' + i);
    d.w.forEach((w, k) => {
      const a = C.norm(w);
      assert.equal(a.length, k + 4, `day ${i}: ${w}`);
      assert.match(a, /^[A-Z]+$/, `day ${i}: ${w}`);
      if (k) {
        const prev = [...C.norm(d.w[k - 1])], rest = [...a];
        prev.forEach(c => { const j = rest.indexOf(c); assert.ok(j >= 0, `day ${i}: ${d.w[k - 1]} > ${w}`); rest.splice(j, 1); });
        assert.equal(rest.length, 1, `day ${i}: ${d.w[k - 1]} > ${w}`);
      }
      d.ok[k].forEach(o => assert.equal(letters(o), letters(w), `day ${i}: ${o} is not an anagram of ${w}`));
    });
  });
});

test('mot brouillé: a ladder never comes twice', () => {
  assert.equal(new Set(days.map(d => d.w.join(' '))).size, days.length);
});
