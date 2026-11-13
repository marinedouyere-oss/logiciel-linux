"""Écrit PolicesPdf.java et 02b_actifs_charte.js (métriques des polices, polices et logo en base64 pour la page web).

Usage : generer_polices_pdf.py dossier_out_charte PolicesPdf.java actifs.js
"""
import base64, json, os, sys

out, java, js = sys.argv[1:4]
m = json.load(open(os.path.join(out, "pdf", "metriques.json")))
logo = json.load(open(os.path.join(out, "pdf", "logo.json")))
ORDRE = ["raleway_bold", "lato_regular", "lato_bold", "lato_italic"]

def tableau(v, indent):
    lignes, ligne = [], []
    for x in v:
        ligne.append(str(x))
        if len(ligne) == 28:
            lignes.append(", ".join(ligne)); ligne = []
    if ligne: lignes.append(", ".join(ligne))
    return (",\n" + indent).join(lignes)

j = ["package com.marinedouyere.sentinelle.moteur;", "",
     "/** Polices de la charte Laisné Industrie intégrées aux PDF (fichier généré : métriques en millièmes de la taille). */",
     "final class PolicesPdf {", "", "    private PolicesPdf() {}", ""]
j.append("    /** Ordre : Raleway Bold (titres), Lato Regular (texte), Lato Bold, Lato Italic. */")
j.append("    static final String[] FICHIERS = {" + ", ".join(f'"{c}.ttf"' for c in ORDRE) + "};")
j.append("    static final String[] NOMS = {" + ", ".join(f'"{m[c]["nom"]}"' for c in ORDRE) + "};")
j.append("    static final boolean[] ITALIQUE = {" + ", ".join("true" if m[c]["italique"] else "false" for c in ORDRE) + "};")
j.append("    static final int[][] BBOX = {" + ", ".join("{" + ", ".join(map(str, m[c]["bbox"])) + "}" for c in ORDRE) + "};")
j.append("    /** Ascent, descent, hauteur des capitales, angle d'italique. */")
j.append("    static final int[][] METRIQUES = {" + ", ".join("{%d, %d, %d, %d}" % (m[c]["ascent"], m[c]["descent"], m[c]["capHeight"], round(m[c]["italicAngle"])) for c in ORDRE) + "};")
j.append("    /** Largeurs des caractères 32 à 255 (codage WinAnsi). */")
j.append("    static final int[][] LARGEURS = {")
for c in ORDRE:
    j.append("        {" + tableau(m[c]["largeurs"], "            ") + "},")
j.append("    };")
j.append(f"    static final int LOGO_LARGEUR = {logo['largeur']};")
j.append(f"    static final int LOGO_HAUTEUR = {logo['hauteur']};")
j.append("}")
open(java, "w").write("\n".join(j) + "\n")

b64 = lambda chemin: base64.b64encode(open(chemin, "rb").read()).decode()
s = ["// ---- Charte Laisné Industrie : polices des PDF (Raleway, Lato) et logo (fichier généré) ----", ""]
s.append("const POLICES_PDF = [")
for c in ORDRE:
    d = m[c]
    s.append("  {")
    s.append(f'    nom: "{d["nom"]}",')
    s.append(f'    italique: {"true" if d["italique"] else "false"},')
    s.append(f'    bbox: {json.dumps(d["bbox"])},')
    s.append(f'    metriques: [{d["ascent"]}, {d["descent"]}, {d["capHeight"]}, {round(d["italicAngle"])}],')
    s.append(f'    largeurs: {json.dumps(d["largeurs"])},')
    s.append(f'    ttf: "{b64(os.path.join(out, "pdf", c + ".ttf"))}",')
    s.append("  },")
s.append("];")
s.append(f'const LOGO_PDF = {{ largeur: {logo["largeur"]}, hauteur: {logo["hauteur"]}, jpeg: "{b64(os.path.join(out, "pdf", "logo.jpg"))}" }};')
s.append(f'const LOGO_COULEUR_PNG = "data:image/png;base64,{open(os.path.join(out, "web", "logo_couleur.b64")).read()}";')
s.append(f'const LOGO_BLANC_PNG = "data:image/png;base64,{open(os.path.join(out, "web", "logo_blanc.b64")).read()}";')
open(js, "w").write("\n".join(s) + "\n")
print("ok", os.path.getsize(java), os.path.getsize(js))
