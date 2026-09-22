"""Extract WOODSTORE_BASE from the source orion.html into a clean JSON asset,
without ever loading the 619-row payload through the assistant's own context.
Source: single JS line `const WOODSTORE_BASE = {"cols": [...], "rows": [[...], ...]};`
"""
import re
import json

SRC = "/root/.claude/uploads/834bf1d9-bdf2-5caf-8d20-e47536c942a3/23d3e8fe-orion.html"
OUT = "/home/user/logiciel-linux/orion-android/app/src/main/assets/woodstore_base.json"

with open(SRC, "r", encoding="utf-8") as f:
    for line in f:
        if line.lstrip().startswith("const WOODSTORE_BASE ="):
            src_line = line
            break
    else:
        raise SystemExit("WOODSTORE_BASE line not found")

# Strip `const WOODSTORE_BASE = ` prefix and trailing `;`
json_text = src_line.split("=", 1)[1].strip()
if json_text.endswith(";"):
    json_text = json_text[:-1]

data = json.loads(json_text)
assert data["cols"] == ["id", "mat", "L", "W", "ep", "cat", "fil", "grp", "desc", "type", "flag", "fam"]
print("columns:", data["cols"])
print("row count:", len(data["rows"]))

# Expand rows (cols[i] -> row[i]) into objects, exactly like expandLib() in the
# original app, so the Android asset is ready to load directly as a row list.
rows = [dict(zip(data["cols"], row)) for row in data["rows"]]

# Sanity: families present, and how many rows per family (mirrors FAM_PROFILE keys)
fams = {}
for r in rows:
    fams[r.get("fam")] = fams.get(r.get("fam"), 0) + 1
print("families:", fams)

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))

print("wrote", OUT)
import os
print("size bytes:", os.path.getsize(OUT))
