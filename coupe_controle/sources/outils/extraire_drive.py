# Retrouve dans le journal de session les fichiers Drive reçus en ligne (base64) et les écrit.
import sys, json, base64, os
journal, dest = sys.argv[1], sys.argv[2]
dossiers = dict(a.split("=", 1) for a in sys.argv[3:])  # titre=sous-dossier
def contenus(o):
    if isinstance(o, dict):
        if "content" in o and "title" in o and "mimeType" in o and isinstance(o["content"], str): yield o
        for v in o.values(): yield from contenus(v)
    elif isinstance(o, list):
        for v in o: yield from contenus(v)
    elif isinstance(o, str) and o.startswith('{"content":'):
        try: yield from contenus(json.loads(o))
        except Exception: pass
for ligne in open(journal, encoding="utf-8"):
    if '"title"' not in ligne or "UEsDB" not in ligne: continue
    for d in contenus(json.loads(ligne)):
        t = d["title"]
        if t in dossiers:
            os.makedirs(os.path.join(dest, dossiers[t]), exist_ok=True)
            octets = base64.b64decode(d["content"])
            open(os.path.join(dest, dossiers[t], t), "wb").write(octets)
            print(len(octets), dossiers[t], t)
