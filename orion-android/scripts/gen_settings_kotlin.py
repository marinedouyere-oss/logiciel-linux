import json

SRC = "/tmp/claude-0/-home-user-logiciel-linux/834bf1d9-bdf2-5caf-8d20-e47536c942a3/scratchpad/settings.json"
OUT = "/home/user/logiciel-linux/orion-android/app/src/main/java/com/marinedouyere/orion/data/SettingsSchema.kt"

with open(SRC, encoding="utf-8") as f:
    data = json.load(f)


def kstr(s: str) -> str:
    escaped = s.replace("\\", "\\\\").replace("\"", "\\\"").replace("$", "\\$")
    return f'"{escaped}"'


def kval(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return f"{float(v)}"
    if isinstance(v, str):
        return kstr(v)
    raise TypeError(f"unsupported default value type: {type(v)} = {v!r}")


lines = []
lines.append("package com.marinedouyere.orion.data")
lines.append("")
lines.append("// Generated from the original orion.html SETTINGS_SCHEMA / DEFAULTS via")
lines.append("// scripts/extract_settings.js + scripts/gen_settings_kotlin.py — do not hand-edit,")
lines.append("// regenerate from the source instead so the ~150 machine parameters stay exact.")
lines.append("")
lines.append("data class SettingsField(")
lines.append("    val id: String,")
lines.append("    val label: String,")
lines.append("    val unit: String = \"\",")
lines.append("    val isText: Boolean = false,")
lines.append("    val active: Boolean = false,")
lines.append(")")
lines.append("")
lines.append("data class SettingsSection(")
lines.append("    val section: String,")
lines.append("    val fields: List<SettingsField>,")
lines.append(")")
lines.append("")
lines.append("val SETTINGS_SCHEMA: List<SettingsSection> = listOf(")
for sec in data["schema"]:
    lines.append(f"    SettingsSection({kstr(sec['section'])}, listOf(")
    for f in sec["fields"]:
        is_text = f.get("type") == "text"
        unit = f.get("unit", "")
        active = bool(f.get("active", False))
        lines.append(
            f"        SettingsField({kstr(f['id'])}, {kstr(f['label'])}, "
            f"unit = {kstr(unit)}, isText = {str(is_text).lower()}, active = {str(active).lower()}),"
        )
    lines.append("    )),")
lines.append(")")
lines.append("")
lines.append("// Material profile key -> (field id -> default value). Values are Double, String or")
lines.append("// null exactly as in the source (JS has a single numeric type; we normalize all")
lines.append("// numeric defaults to Double). A missing key for a profile means that field does not")
lines.append("// apply to it (mirrors `vals[f.id] !== undefined` filtering in the original UI).")
lines.append("val SETTINGS_DEFAULTS: Map<String, Map<String, Any?>> = mapOf(")
for profile in ("strat", "agglo"):
    lines.append(f"    {kstr(profile)} to mapOf(")
    for key, value in data["defaults"][profile].items():
        lines.append(f"        {kstr(key)} to {kval(value)},")
    lines.append("    ),")
lines.append(")")
lines.append("")

with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")

print("wrote", OUT)
print("lines:", len(lines))
