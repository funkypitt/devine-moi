#!/usr/bin/env python3
"""Print the 5-letter answers (sorted) and the next 90 words of the day, for a human review.
A word to remove goes into tools/blocklist_fr.json ("ugly"), then: python3 tools/build_words.py --append
(it is replaced at the same position, so the other days do not move)."""
import json, os, re, sys
from datetime import date, timedelta
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.loads(re.search(r"= (\{.*\});", open(os.path.join(ROOT, "words-fr.js"), encoding="utf-8").read(), re.S).group(1))
epoch = date.fromisoformat(d["epoch"])
start = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else max(date.today(), epoch)
for L in ("5", "6", "7"):
    print(f"{L} letters: {len(d[L]['answers'].split())} answers, {len(d[L]['allowed'].split())} allowed guesses")
disp = d["5"]["display"].split()
print("\nNext 90 words of the day:")
for k in range(90):
    day = start + timedelta(days=k)
    i = (day - epoch).days
    print(f"  {day.isoformat()}  n°{i + 1:<4} {disp[i % len(disp)]}")
print("\nAll 5-letter answers:")
s = sorted(disp)
for k in range(0, len(s), 12):
    print("  " + " ".join(f"{w:6}" for w in s[k:k + 12]))
