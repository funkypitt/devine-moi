#!/usr/bin/env python3
"""Build words-fr.js for Devine-moi from Lexique 3.83 and the Plume inventory.

answers : everyday French words (Lexique, base forms, frequency threshold), shuffled ONCE
          with a fixed seed. The published order must never change (see PLAN §A.3, D6).
allowed : every form of the right length from Lexique + the Plume inventory
          (Lexique + LanguageTool/Dicollecte forms, conjugations included).

Usage
  python3 tools/build_words.py              # first build (refuses if words-fr.js exists)
  python3 tools/build_words.py --append     # keep published order, add new answers at the end,
                                            # drop blocklisted ones in place (replaced by a fresh word)
  python3 tools/build_words.py --force      # rebuild from scratch (prints what moves in the next 365 days)
  python3 tools/build_words.py --selftest
Stdlib only.
"""
import csv, gzip, json, os, random, re, sys, unicodedata
from collections import defaultdict
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEXIQUE = os.path.join(ROOT, "data", "Lexique383.tsv")
INVENTAIRE = os.path.join(ROOT, "data", "inventaire_fr.tsv.gz")
BLOCKLIST = os.path.join(ROOT, "tools", "blocklist_fr.json")
OUT = os.path.join(ROOT, "words-fr.js")
EPOCH = "2026-10-30"
LENGTHS = (5, 6, 7)
SEEDS = {5: 20261101, 6: 20261102, 7: 20261103}
THRESHOLD = {5: 2.0, 6: 2.5, 7: 2.5}   # max(freqfilms2, freqlivres) per million
VOWELS = set("AEIOUY")
RESERVE_FACTOR = 0.6                 # words between 0.6×threshold and threshold replace removed answers
ABREV_EXCLUDE = {"MONSR", "HUMMM", "HMMMM"}


def norm(s):
    """'élève' -> 'ELEVE', 'cœur' -> 'COEUR', anything not A-Z after folding -> ''."""
    s = s.replace("œ", "oe").replace("Œ", "OE").replace("æ", "ae").replace("Æ", "AE")
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    s = s.upper()
    return s if re.fullmatch(r"[A-Z]+", s) else ""


def load_blocklist():
    with open(BLOCKLIST, encoding="utf-8") as f:
        d = json.load(f)
    insults = {norm(w) for w in d.get("insults", [])}
    ugly = {norm(w) for w in d.get("ugly", [])}
    return insults, insults | ugly


def fnum(x):
    try:
        return float(x or 0)
    except ValueError:
        return 0.0


def read_lexique():
    """yields rows with ascii form."""
    with open(LEXIQUE, encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            o = row["ortho"].strip()
            if not o or not o.islower():
                continue
            a = norm(o)
            if a:
                yield a, o, row


FUNCTION_CATS = {"PRE", "CON", "PRO:dem", "ADJ:dem", "ADJ:num", "ADJ:pos", "PRO:ind", "ADJ:ind"}
INTERJECTIONS = {"adieu", "bravo", "halte", "merci", "salut", "hélas", "mince", "basta"}


def is_base_form(ortho, row):
    """What a hand-picked list of answers would keep, in French:
    - headwords: singular noun, masculine singular adjective, infinitive, adverb (ortho == lemme);
      past participles only when Lexique also lists them as adjectives (BLASÉ), never bare (MANGÉ);
    - singular function words: CETTE, CELUI, SELON, PARMI, TROIS, AUCUN…;
    - irregular feminines (BELLE, DOUCE, SÈCHE) and -x plurals (CIEUX, VOEUX): the French
      counterpart of GEESE/FUNGI in English. Regular feminines (NOIRE) and -s plurals stay out."""
    cg, lem, g, n = row["cgram"], row["lemme"].strip(), row["genre"], row["nombre"]
    if cg == "ONO":
        return ortho in INTERJECTIONS
    if cg in FUNCTION_CATS:
        return ortho == lem and (cg == "ADJ:num" or not ortho.endswith("s"))
    if cg == "NOM" and n == "p" and ortho.endswith("x") and ortho not in (lem, lem + "s", lem + "x"):
        return True                     # CHOUX, CIEUX, ÉGAUX — not BATEAUX (bateau + x is regular)
    if cg == "ADJ" and g == "f" and n == "s" and ortho != lem + "e" and norm(ortho) != norm(lem + "e"):
        return True
    if ortho != lem:
        return False
    if cg == "VER":
        return "inf" in row["infover"]
    return cg in ("NOM", "ADJ", "ADV")


def build_lists():
    insults, blocked_answers = load_blocklist()
    allowed = {L: set() for L in LENGTHS}
    answer_freq = {L: {} for L in LENGTHS}
    display = {}                      # ascii -> (freq, accented form)
    for a, o, row in read_lexique():
        L = len(a)
        if L not in LENGTHS:
            continue
        allowed[L].add(a)
        fr = max(fnum(row["freqfilms2"]), fnum(row["freqlivres"]))
        if not is_base_form(o, row):
            continue
        # the accented spelling shown at the end comes from the row that makes it an answer
        if fr > display.get(a, (-1, ""))[0]:
            display[a] = (fr, o)
        if fr >= THRESHOLD[L] * RESERVE_FACTOR and fr > answer_freq[L].get(a, 0):
            answer_freq[L][a] = fr
    with gzip.open(INVENTAIRE, "rt", encoding="utf-8") as f:
        for line in f:
            w = line.split("\t", 1)[0]
            if not w.islower():
                continue
            a = norm(w)
            if a and len(a) in LENGTHS:
                allowed[len(a)].add(a)
    out = {}
    for L in LENGTHS:
        al = {w for w in allowed[L] if w not in insults}
        ans = {w: fr for w, fr in answer_freq[L].items()
               if w not in blocked_answers and w not in ABREV_EXCLUDE and set(w) & VOWELS and w in al}
        out[L] = {"allowed": al,
                  "answers": {w: fr for w, fr in ans.items() if fr >= THRESHOLD[L]},
                  "reserve": sorted((w for w, fr in ans.items() if fr < THRESHOLD[L]), key=lambda w: -ans[w])}
    return out, display


def shuffled(words, seed, gap=5):
    """Deterministic shuffle; no initial letter repeats within `gap` consecutive days
    (greedy: take the first remaining word whose initial is not among the last `gap` ones)."""
    pool = sorted(words)
    random.Random(seed).shuffle(pool)
    out = []
    while pool:
        recent = {w[0] for w in out[-gap:]}
        k = next((i for i, w in enumerate(pool) if w[0] not in recent), 0)
        out.append(pool.pop(k))
    return out


def read_existing():
    if not os.path.exists(OUT):
        return None
    src = open(OUT, encoding="utf-8").read()
    m = re.search(r"window\.DEVINE_WORDS = (\{.*\});", src, re.S)
    return json.loads(m.group(1))


def render(data):
    js = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    js = js.replace(',"5":', ',\n"5":').replace(',"6":', ',\n"6":').replace(',"7":', ',\n"7":')
    return ("// Generated by tools/build_words.py on %s from Lexique 3.83 (CC BY-SA 4.0, lexique.org)\n"
            "// and the Plume inventory (Lexique + Dicollecte/LanguageTool forms, MPL 2.0). Do not edit by hand.\n"
            "// The order of `answers` is the order of the words of the day: never reshuffle it.\n"
            "window.DEVINE_WORDS = %s;\n" % (date.today().isoformat(), js))


def main():
    args = set(sys.argv[1:])
    if "--selftest" in args:
        return selftest()
    lists, display = build_lists()
    old = read_existing()
    if old and not (args & {"--append", "--force"}):
        sys.exit("words-fr.js exists: use --append (keeps the published order) or --force (reshuffles!)")
    data = {"v": 1, "epoch": EPOCH}
    for L in LENGTHS:
        ans = lists[L]["answers"]
        if old and "--append" in args:
            prev = old[str(L)]["answers"].split()
            fresh = shuffled(set(ans) - set(prev), SEEDS[L] + 7)
            reserve = [w for w in lists[L]["reserve"] if w not in prev]
            order = []
            for w in prev:          # a word removed from the answers is replaced in place
                if w in ans:
                    order.append(w)
                else:
                    rep = fresh.pop() if fresh else reserve.pop(0)
                    print(f"[{L}] {w} -> {rep} at n°{len(order) + 1}", file=sys.stderr)
                    order.append(rep)
            order += [w for w in fresh if w not in order]
        else:
            order = shuffled(ans, SEEDS[L])
            if old and "--force" in args and L == 5:
                prev = old["5"]["answers"].split()
                moved = sum(1 for i in range(min(365, len(prev))) if i >= len(order) or prev[i] != order[i])
                print(f"[--force] {moved} of the next 365 words of the day change", file=sys.stderr)
        data[str(L)] = {
            "answers": " ".join(order),
            "display": " ".join(display[w][1].upper() for w in order),
            "allowed": " ".join(sorted(lists[L]["allowed"])),
        }
        print(f"[{L}] answers {len(order)}  allowed {len(lists[L]['allowed'])}", file=sys.stderr)
    open(OUT, "w", encoding="utf-8").write(render(data))
    print(f"wrote {OUT} ({os.path.getsize(OUT)//1024} KB)", file=sys.stderr)


def selftest():
    assert norm("élève") == "ELEVE"
    assert norm("cœur") == "COEUR"
    assert norm("aujourd'hui") == ""
    assert norm("Été") == "ETE"
    assert norm("porte-clé") == ""
    d = read_existing()
    assert d, "words-fr.js missing"
    insults, blocked = load_blocklist()
    for L in LENGTHS:
        ans = d[str(L)]["answers"].split()
        disp = d[str(L)]["display"].split()
        al = set(d[str(L)]["allowed"].split())
        assert len(ans) == len(disp) == len(set(ans)), L
        assert all(len(w) == L and re.fullmatch(r"[A-Z]+", w) for w in ans), L
        assert all(norm(x) == w for x, w in zip(disp, ans)), L
        assert all(w in al for w in ans), L
        assert not (set(ans) & blocked), sorted(set(ans) & blocked)
        assert not (al & insults), L
        assert all(len(w) == L for w in al)
    print("selftest ok:", {L: len(d[str(L)]["answers"].split()) for L in LENGTHS})


if __name__ == "__main__":
    main()
