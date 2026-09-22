import re, base64, json, sys, os

SRC = "/root/.claude/uploads/834bf1d9-bdf2-5caf-8d20-e47536c942a3/23d3e8fe-orion.html"
OUT = "/tmp/claude-0/-home-user-logiciel-linux/834bf1d9-bdf2-5caf-8d20-e47536c942a3/scratchpad/orion-icons"
os.makedirs(OUT, exist_ok=True)

with open(SRC, "r", encoding="utf-8") as f:
    html = f.read()

# manifest data URI -> decode JSON -> extract each icon's own base64 payload
m = re.search(r'rel="manifest" href="data:application/manifest\+json;base64,([^"]+)"', html)
manifest_json = base64.b64decode(m.group(1)).decode("utf-8")
manifest = json.loads(manifest_json)
print("manifest name:", manifest.get("name"), "| short_name:", manifest.get("short_name"))
print("theme_color:", manifest.get("theme_color"), "background_color:", manifest.get("background_color"))

for icon in manifest.get("icons", []):
    sizes = icon["sizes"]
    purpose = icon.get("purpose", "any")
    data_uri = icon["src"]
    b64 = data_uri.split(",", 1)[1]
    png = base64.b64decode(b64)
    fname = f"manifest-{sizes}-{purpose}.png"
    with open(os.path.join(OUT, fname), "wb") as out:
        out.write(png)
    print("wrote", fname, len(png), "bytes")

# standalone <link rel="icon"> and apple-touch-icon
for rel, outname in [("icon", "link-icon.png"), ("apple-touch-icon", "link-apple-touch-icon.png")]:
    mm = re.search(r'rel="' + rel + r'"[^>]*href="data:image/png;base64,([^"]+)"', html)
    if mm:
        png = base64.b64decode(mm.group(1))
        with open(os.path.join(OUT, outname), "wb") as out:
            out.write(png)
        print("wrote", outname, len(png), "bytes")

with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
print("wrote manifest.json")
