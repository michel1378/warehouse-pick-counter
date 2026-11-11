"""Compile reviewed owner data, without conversation text, into the picker snapshot.

Usage: python3 scripts/prepare-reviewed-sizes.py /absolute/path/michelle_sizes_draft.json
The source stays outside the repository. Re-run only after reviewing new owner corrections.
"""
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
draft = json.loads(Path(sys.argv[1]).read_text())
ids = {
    "alpaca-striped-no-buttons": "60bb838a-f0b7-4242-9d2c-2df8da9a1c1f",
    "margiela-striped-pants": "7bc3067f-d34b-4080-be07-39bf2ab2afab",
    "samurai-shirt": "a2bbcd7b-60d3-4248-934f-82ca1072c0f1",
}
fit_names = {"tight": "closer", "fitted": "closer", "slim": "closer", "smaller": "closer", "closer": "closer", "loose": "relaxed", "relaxed": "relaxed", "oversize": "relaxed", "slightly_oversized": "relaxed"}
measure_names = {"shoulders_cm": "shoulders", "chest_width_cm": "chest", "half_waist_cm": "halfWaist", "half_waist_relaxed_cm": "halfWaist", "length_cm": "length", "sleeve_cm": "sleeve"}
all_cases = [case for batch in draft["calibration"]["reviewed_batches"] for case in batch.get("cases", [])]
all_cases += draft["calibration"]["cases"]
products = []
for p in draft["products"]:
    key = p["local_id"]
    rows = []
    for grid in p.get("size_grids", []):
        for row in grid["rows"]:
            measures = { {"half_waist": "halfWaist"}.get(k, k): v for k, v in row.items() if k in ["shoulders", "chest", "length", "sleeve", "half_waist"] }
            if "half_waist_relaxed_cm" in row:
                measures["halfWaist"] = [row["half_waist_relaxed_cm"]] * 2
            rows.append({"tag": row["tag"], "measures": measures, "estimated": row.get("measurement_status") == "estimated", **({"relaxedWaist": row["half_waist_relaxed_cm"], "stretchedWaist": row["half_waist_stretched_cm"]} if "half_waist_relaxed_cm" in row else {})})
    variants = [{"id": v["id"], "name": v["name"]} for v in p.get("color_variants", [])]
    if not variants:
        variants = [{"id": "all", "name": "Оба цвета" if p.get("color_variants_count") == 2 else "Размер"}]
    if key == "alpaca-striped-buttons":
        variants = [{"id": "dark-gray", "name": "Тёмно-серый", "aliases": ["темный серый"]}, {"id": "light-gray", "name": "Светло-серый"}, {"id": "light-beige", "name": "Светло-бежевый", "aliases": ["бежевый", "светлый бежевый"]}]
    selected = {}
    for x in all_cases:
        status = x.get("status", "")
        if x.get("product_id") != key or x.get("current_applicability"):
            continue
        special_guard = status == "needs_regular_fit_choice_after_conditional_M"
        if not (status.startswith("owner_") or special_guard) or status in ["owner_mentioned_without_explicit_size", "owner_size_accepted_profile_needs_clarification"]:
            continue
        ref = {measure_names[k]: v for k, v in (x.get("reference_garment") or {}).items() if k in measure_names and isinstance(v, (int, float))}
        raw_fit = x.get("requested_body_fit")
        if not raw_fit or raw_fit == "unspecified": raw_fit = x.get("requested_fit")
        if x.get("requested_size_preference") == "smaller_than_regular": raw_fit = "closer"
        fit = fit_names.get(raw_fit, "regular")
        length = "cropped" if x.get("requested_length") == "cropped" else "standard"
        size = x.get("owner_confirmed_size") or x.get("owner_preferred_size") or x.get("owner_provisional_size") or x.get("proposed_size")
        manual = special_guard or "manual_sleeve" in status or "measurement_conflict" in status or size is None
        reason = None
        if special_guard:
            size = None
            reason = "Для этих мерок M согласован при посадке ближе к телу. Обычную посадку нужно уточнить."
        elif "manual_sleeve" in status:
            size = None
            reason = "Проверьте рукав конкретной рубашки: увеличение бирки не гарантирует нужную длину."
        elif "measurement_conflict" in status:
            reason = "Выбор магазина — 3XL, но грудь по сетке меньше любимой рубашки. Проверьте вещь застёгнутой перед отправкой."
        elif size is None:
            reason = "Подходящий размер не подтверждён. Нужен замер конкретной вещи перед отправкой."
        rule = {"id": x["id"], "height": x["height_cm"], "weight": x["weight_kg"], "fit": fit, "lengthPreference": length, "colors": x.get("color_ids", []), "reference": ref, "size": size, "manual": manual}
        if reason: rule["reason"] = reason
        def save(r):
            signature = json.dumps([r["height"], r["weight"], r["fit"], r["lengthPreference"], sorted(r["colors"]), r["reference"]], sort_keys=True)
            selected[signature] = r
        save(rule)
        for condition in x.get("conditional_recommendations", []):
            conditional = dict(rule)
            conditional.update(id=x["id"] + "-conditional", size=condition["size"], fit=fit_names.get(condition["required_body_fit"], "regular"), manual=False)
            conditional.pop("reason", None)
            save(conditional)
    if key == "alpaca-striped-no-buttons": stretch = "moderate"
    elif key == "margiela-striped-pants": stretch = "none"
    elif key == "samurai-shirt": stretch = "none"
    else: stretch = (p.get("fabric") or {}).get("stretch") or "none"
    sizes = list(dict.fromkeys(r["tag"] for r in rows)) or p.get("owner_confirmed_sizes") or p.get("existing_catalog_sizes") or []
    if key == "black-cold-gray-longsleeve":
        # This product's source distinguishes measured S/M/L from calculated XL–5XL.
        for row in rows:
            if row["tag"] not in ["S", "M", "L"]: row["estimated"] = True
    products.append({"id": p.get("catalog_product_id") or ids[key], "key": key, "name": p["card_title"], "kind": "pants" if p.get("product_type") == "pants" or key == "margiela-striped-pants" else "top", "variants": variants, "sizes": sizes, "unavailableSizes": p.get("unavailable_sizes", ["S"] if key == "margiela-striped-pants" else []), "stretch": stretch if stretch in ["none", "low", "moderate"] else "moderate", "buttoned": key in ["samurai-shirt", "best-distress-shirt", "old-textured-collar-shirt"], "rows": rows, "rules": list(selected.values()), "checkWaistBeforeShipping": key == "huge-pants"})
output = {"version": 42, "products": products}
dest = root / "src/lib/detailed-size-data.json"
dest.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"products": len(products), "rules": sum(len(p["rules"]) for p in products), "output": str(dest)}))
