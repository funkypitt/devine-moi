#!/usr/bin/env python3
"""Le mot brouillé: one ladder of anagrams per day, from Lexique 3.83 (CC BY-SA 4.0).

A ladder is six words of 4, 5, 6, 7, 8 and 9 letters; each one is written with the letters of the
previous one plus one new letter. The words of 4 to 8 letters are the game, the 9-letter word is the bonus.

Output: brouille-data.js
  window.BROUILLE = { days: [ { w: [six words as displayed], ok: [six lists of other accepted anagrams] } ] }
The order of `days` is the order of the calendar. A new run reshuffles it: pin in PINNED the days already played.

    python3 tools/make_brouille.py            # writes the file
    python3 tools/make_brouille.py --dry      # statistics and a sample only
"""
import csv, json, math, os, random, re, sys, unicodedata
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEX = os.path.join(ROOT, "data", "Lexique383.tsv")
OUT = os.path.join(ROOT, "brouille-data.js")
SEED = 20261118
# a word to find must be common: frequency floor (per million, films or books) by length
FLOOR = {4: 4.0, 5: 3.0, 6: 2.0, 7: 1.5, 8: 0.8, 9: 0.4}
INFLECTED = 0.5            # plurals and feminines are allowed but a base form is preferred (log10 units)
MIN_SCORE = -0.4           # weakest word of a ladder, after the penalty (-0.2 gave 416 ladders, -0.4 gives 18 months)
# never a word to find (still accepted when typed): slang, crude or foreign words that slipped past the floors
VETO = set("""SERTAO PESETAS PESETA SEULABRE DURAILLE SALINGUE PETE ERECTION MIRETTE MIRETTES STERLING MEETINGS MEDIA
CASH TARO MANDORE TAULIER FOUTAISE CAME CRETIN CRETINS TEAM MEGA SIDA POGNES CHIALER PITAINE SIGNORA JEUNOTS
CRAIGNOS RATICHES RENAUDER TAULIERE CRETONNE COLTINER FRINGUES GLAVIOTER BRAIMENTS COUCHERIE APARTHEID ESTRAPADE
CHANFREIN BOUSE MATER""".split())
# a day that was already played keeps its ladder: calendar index -> its six words
PINNED = {19: "ORNE NOIRE REGION SOIGNER ORGANISE AGRESSION"}
REUSE = {8: 0, 7: 2, 6: 4, 5: 8, 4: 20}     # how many other days may share the same set of letters


def norm(s):
    s = s.replace("œ", "oe").replace("æ", "ae")
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").upper()
    return s if re.fullmatch(r"[A-Z]+", s) else ""


def sig(a):
    return "".join(sorted(a))


def load():
    blk = json.load(open(os.path.join(ROOT, "tools", "blocklist_fr.json")))
    insults = {norm(w) for w in blk["insults"]}
    ugly = {norm(w) for w in blk["ugly"]}
    words = {}
    for row in csv.DictReader(open(LEX, encoding="utf-8"), delimiter="\t"):
        o = row["ortho"].strip()
        if not o or not o.islower():
            continue
        a = norm(o)
        if not 4 <= len(a) <= 9 or a in insults:
            continue
        fr = max(float(row["freqfilms2"] or 0), float(row["freqlivres"] or 0))
        cg, inf = row["cgram"], row["infover"]
        # words worth finding: nouns, adjectives, adverbs, infinitives and past participles
        good = cg in ("NOM", "ADJ", "ADV") or (cg == "VER" and ("inf" in inf or "par:pas" in inf))
        o = o.replace("œ", "oe").replace("æ", "ae")          # one tile per letter
        e = words.setdefault(a, {"gf": 0.0, "d": o, "df": -1.0, "lem": set(), "base": False})
        if good:
            e["gf"] += fr
            e["lem"].add(norm(row["lemme"]))
            e["base"] = e["base"] or o == row["lemme"] or "inf" in inf
            if fr > e["df"]:
                e["df"], e["d"] = fr, o
    return words, ugly


def main():
    dry = "--dry" in sys.argv
    words, ugly = load()
    ugly |= {a + "S" for a in ugly} | VETO
    elig = {a: e for a, e in words.items() if e["gf"] >= FLOOR[len(a)] and a not in ugly}
    value = {a: math.log10(e["gf"]) - (0 if e["base"] else INFLECTED) for a, e in elig.items()}
    target = {}                                   # letters -> the word to find
    for a in elig:
        s = sig(a)
        if s not in target or value[a] > value[target[s]]:
            target[s] = a
    accepted = defaultdict(list)                  # letters -> every word of the dictionary
    for a in words:
        accepted[sig(a)].append(a)

    def below(s):
        seen = set()
        for i in range(len(s)):
            t = s[:i] + s[i + 1:]
            if t in target and t not in seen:
                seen.add(t)
                yield t

    def compatible(a, chain):
        """No free step: never the previous word with a letter stuck on, never twice the same family."""
        la = elig[a]["lem"]
        for b in chain:
            if b in a or a in b or la & elig[b]["lem"]:
                return False
        return True

    used = defaultdict(int)

    def best(top):
        """Best ladder down from a 9-letter set: the weakest word as high as possible, little reuse."""
        found = [None, -1e9]

        def walk(chain_sigs, chain_words, low, total):
            s = chain_sigs[-1]
            if len(s) == 4:
                score = low + 0.1 * total
                if score > found[1]:
                    found[0], found[1] = list(chain_sigs), score
                return
            for t in below(s):
                a = target[t]
                if used[t] > REUSE[len(t)] or not compatible(a, chain_words):
                    continue
                v = value[a] - 0.4 * used[t]
                if min(low, v) + 0.1 * (total + v) + 0.1 * 6 * 4 < found[1]:   # cannot beat the best so far
                    continue
                walk(chain_sigs + [t], chain_words + [a], min(low, v), total + v)

        a = target[top]
        walk([top], [a], value[a], value[a])
        return found

    tops = sorted((s for s in target if len(s) == 9), key=lambda s: -value[target[s]])
    ladders, top_lemmas = [], set()
    pinned = {index: [sig(a) for a in line.split()] for index, line in PINNED.items()}
    for chain in pinned.values():
        assert all(s in target for s in chain), chain
        for s in chain[:-1]:
            used[s] += 1
        top_lemmas |= elig[target[chain[-1]]]["lem"]
    for top in tops:
        if elig[target[top]]["lem"] & top_lemmas:
            continue
        chain, score = best(top)
        if not chain or min(value[target[s]] for s in chain) < MIN_SCORE:
            continue
        for s in chain[1:]:
            used[s] += 1
        top_lemmas |= elig[target[top]]["lem"]
        ladders.append(chain[::-1])

    # calendar order: shuffled once, then the same four starting letters never twice within ten days
    rnd = random.Random(SEED)
    rnd.shuffle(ladders)
    for i in range(len(ladders)):
        recent = {l[0] for l in ladders[max(0, i - 10):i]}
        if ladders[i][0] in recent:
            for j in range(i + 1, len(ladders)):
                if ladders[j][0] not in recent:
                    ladders[i], ladders[j] = ladders[j], ladders[i]
                    break

    for index in sorted(pinned):
        ladders.insert(index, pinned[index])

    days = []
    for chain in ladders:
        w = [elig[target[s]]["d"].upper() for s in chain]
        ok = [sorted(a for a in accepted[s] if a != target[s]) for s in chain]
        days.append({"w": w, "ok": ok})

    print(f"{len(days)} ladders ({len(days) / 365.25:.1f} years)", file=sys.stderr)
    base = sum(1 for chain in ladders for s in chain if elig[target[s]]["base"])
    print(f"base forms: {100 * base / (6 * len(ladders)):.0f} %", file=sys.stderr)
    for d in days[:25]:
        print("  " + " > ".join(d["w"]), file=sys.stderr)
    if dry:
        return
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// Generated by tools/make_brouille.py from Lexique 3.83 (CC BY-SA 4.0, lexique.org). Do not edit by hand.\n")
        f.write("// The order of `days` is the order of the calendar: never reshuffle it.\n")
        f.write("window.BROUILLE = " + json.dumps({"days": days}, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"{OUT}: {os.path.getsize(OUT) // 1024} KB", file=sys.stderr)


if __name__ == "__main__":
    main()
