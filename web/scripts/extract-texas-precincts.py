from __future__ import annotations

import gzip
import json
from pathlib import Path


WEB_ROOT = Path(__file__).resolve().parents[1]
ROOT = WEB_ROOT.parent
RAW = ROOT / "data" / "raw" / "nyt-precincts-with-results.topojson.gz"
OUT = ROOT / "data" / "processed" / "texas-precincts.geojson"


def decode_arc(arcs: list, transform: dict, index: int) -> list[list[float]]:
    if index < 0:
        points = decode_arc(arcs, transform, ~index)
        return list(reversed(points))

    scale_x, scale_y = transform["scale"]
    translate_x, translate_y = transform["translate"]
    x = 0
    y = 0
    coords = []

    for dx, dy in arcs[index]:
        x += dx
        y += dy
        coords.append([x * scale_x + translate_x, y * scale_y + translate_y])

    return coords


def stitch_ring(arcs: list, transform: dict, arc_indexes: list[int]) -> list[list[float]]:
    ring: list[list[float]] = []
    for arc_index in arc_indexes:
        coords = decode_arc(arcs, transform, arc_index)
        if ring and coords and ring[-1] == coords[0]:
            ring.extend(coords[1:])
        else:
            ring.extend(coords)
    return ring


def convert_geometry(geometry: dict, arcs: list, transform: dict) -> dict | None:
    geometry_type = geometry.get("type")
    arc_data = geometry.get("arcs")

    if geometry_type == "Polygon":
        return {
            "type": "Polygon",
            "coordinates": [stitch_ring(arcs, transform, ring) for ring in arc_data],
        }

    if geometry_type == "MultiPolygon":
        return {
            "type": "MultiPolygon",
            "coordinates": [
                [stitch_ring(arcs, transform, ring) for ring in polygon]
                for polygon in arc_data
            ],
        }

    return None


def main() -> None:
    if not RAW.exists():
        raise SystemExit(f"Missing source file: {RAW}")

    OUT.parent.mkdir(parents=True, exist_ok=True)

    with gzip.open(RAW, "rt", encoding="utf-8") as file:
        topology = json.load(file)

    arcs = topology["arcs"]
    transform = topology["transform"]
    geometries = topology["objects"]["tiles"]["geometries"]

    features = []
    for item in geometries:
        props = item.get("properties") or {}
        if props.get("state") != "TX":
            continue

        converted = convert_geometry(item, arcs, transform)
        if not converted:
            continue

        features.append(
            {
                "type": "Feature",
                "geometry": converted,
                "properties": props,
            }
        )

    collection = {"type": "FeatureCollection", "features": features}
    OUT.write_text(json.dumps(collection, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(features):,} Texas precinct features to {OUT}")


if __name__ == "__main__":
    main()
