#!/usr/bin/env python3
r"""
Export H3 land cover data from ArcGIS geodatabase to JSON for Cloudflare D1 import.

Usage:
    python export_landcover.py <gdb_path> <output_dir>

Example (Windows):
    python export_landcover.py "C:\Users\mmulq\Projects\Biome\Biome.gdb" "./landcover_export"

Example (Mac/Linux):
    python export_landcover.py "/path/to/Biome.gdb" "./landcover_export"

Requirements:
    pip install arcpy  (or use ArcGIS Pro Python environment)
    # OR for non-ArcGIS:
    pip install geopandas fiona
"""

import os
import sys
import json
import glob
from pathlib import Path

# Try arcpy first, fall back to geopandas
try:
    import arcpy
    USE_ARCPY = True
    print("Using arcpy for geodatabase access")
except ImportError:
    USE_ARCPY = False
    try:
        import geopandas as gpd
        import fiona
        print("Using geopandas/fiona for geodatabase access")
    except ImportError:
        print("ERROR: Neither arcpy nor geopandas available.")
        print("Install with: pip install geopandas fiona")
        sys.exit(1)


# Copernicus Global Land Cover class codes
# https://land.copernicus.eu/global/products/lc
LANDCOVER_CLASSES = {
    0: {"name": "unknown", "color": "#808080", "biome": "unknown"},
    20: {"name": "shrubs", "color": "#ccb35c", "biome": "shrubland"},
    30: {"name": "herbaceous", "color": "#b8e05c", "biome": "grassland"},
    40: {"name": "cultivated", "color": "#e9d35f", "biome": "agricultural"},
    50: {"name": "urban", "color": "#e60000", "biome": "urban"},
    60: {"name": "bare_sparse", "color": "#c4b79f", "biome": "desert"},
    70: {"name": "snow_ice", "color": "#f0f0f0", "biome": "polar"},
    80: {"name": "water", "color": "#0064c8", "biome": "freshwater"},
    90: {"name": "wetland", "color": "#009696", "biome": "wetland"},
    100: {"name": "moss_lichen", "color": "#7dd67d", "biome": "tundra"},
    111: {"name": "forest_evergreen_needle", "color": "#006400", "biome": "forest"},
    112: {"name": "forest_evergreen_broad", "color": "#00a000", "biome": "forest"},
    113: {"name": "forest_deciduous_needle", "color": "#aac800", "biome": "forest"},
    114: {"name": "forest_deciduous_broad", "color": "#68c800", "biome": "forest"},
    115: {"name": "forest_mixed", "color": "#00c800", "biome": "forest"},
    116: {"name": "forest_unknown", "color": "#32c832", "biome": "forest"},
    121: {"name": "forest_open_evergreen_needle", "color": "#88a000", "biome": "woodland"},
    122: {"name": "forest_open_evergreen_broad", "color": "#78c800", "biome": "woodland"},
    123: {"name": "forest_open_deciduous_needle", "color": "#a0c000", "biome": "woodland"},
    124: {"name": "forest_open_deciduous_broad", "color": "#90c800", "biome": "woodland"},
    125: {"name": "forest_open_mixed", "color": "#78c864", "biome": "woodland"},
    126: {"name": "forest_open_unknown", "color": "#6bc864", "biome": "woodland"},
    200: {"name": "ocean", "color": "#000080", "biome": "ocean"},
}


def get_biome_info(majority_code):
    """Get biome info from land cover code."""
    code = int(majority_code) if majority_code else 0
    return LANDCOVER_CLASSES.get(code, LANDCOVER_CLASSES[0])


def export_table_arcpy(gdb_path, table_name, output_file):
    """Export a single table using arcpy."""
    table_path = os.path.join(gdb_path, table_name)

    records = []
    fields = ["h3_index", "MAJORITY"]

    with arcpy.da.SearchCursor(table_path, fields) as cursor:
        for row in cursor:
            h3_index, majority = row
            if h3_index:
                biome_info = get_biome_info(majority)
                records.append({
                    "h3": h3_index,
                    "code": int(majority) if majority else 0,
                    "biome": biome_info["biome"]
                })

    return records


def export_table_geopandas(gdb_path, table_name, output_file):
    """Export a single table using geopandas/fiona."""
    # List layers in gdb
    layers = fiona.listlayers(gdb_path)

    if table_name not in layers:
        print(f"  Warning: {table_name} not found in geodatabase")
        return []

    gdf = gpd.read_file(gdb_path, layer=table_name)

    records = []
    for _, row in gdf.iterrows():
        h3_index = row.get('h3_index')
        majority = row.get('MAJORITY')

        if h3_index:
            biome_info = get_biome_info(majority)
            records.append({
                "h3": h3_index,
                "code": int(majority) if majority else 0,
                "biome": biome_info["biome"]
            })

    return records


def find_tables(gdb_path, pattern):
    """Find all tables matching a pattern in the geodatabase."""
    if USE_ARCPY:
        arcpy.env.workspace = gdb_path
        tables = arcpy.ListTables(pattern) or []
        feature_classes = arcpy.ListFeatureClasses(pattern) or []
        return tables + feature_classes
    else:
        layers = fiona.listlayers(gdb_path)
        import fnmatch
        return [l for l in layers if fnmatch.fnmatch(l, pattern)]


def export_resolution(gdb_path, output_dir, resolution, pattern):
    """Export all tables for a given resolution."""
    print(f"\nExporting resolution {resolution} tables matching '{pattern}'...")

    tables = find_tables(gdb_path, pattern)
    print(f"  Found {len(tables)} tables")

    if not tables:
        print(f"  Warning: No tables found matching pattern '{pattern}'")
        return

    all_records = []

    for i, table_name in enumerate(tables):
        print(f"  Processing {table_name} ({i+1}/{len(tables)})...")

        if USE_ARCPY:
            records = export_table_arcpy(gdb_path, table_name, None)
        else:
            records = export_table_geopandas(gdb_path, table_name, None)

        all_records.extend(records)
        print(f"    Extracted {len(records)} records (total: {len(all_records)})")

    # Write to JSON lines format (easier for streaming upload)
    output_file = os.path.join(output_dir, f"landcover_res{resolution}.jsonl")
    with open(output_file, 'w') as f:
        for record in all_records:
            f.write(json.dumps(record) + '\n')

    print(f"  Wrote {len(all_records)} records to {output_file}")

    # Also write a summary JSON with biome color mappings
    summary = {
        "resolution": resolution,
        "total_tiles": len(all_records),
        "biome_colors": {
            info["biome"]: info["color"]
            for info in LANDCOVER_CLASSES.values()
        }
    }

    summary_file = os.path.join(output_dir, f"landcover_res{resolution}_summary.json")
    with open(summary_file, 'w') as f:
        json.dump(summary, f, indent=2)

    return all_records


def main():
    if len(sys.argv) < 3:
        print("Usage: python export_landcover.py <gdb_path> <output_dir>")
        print("\nExample:")
        print('  python export_landcover.py "C:\\Users\\mmulq\\Projects\\Biome\\Biome.gdb" "./landcover_export"')
        sys.exit(1)

    gdb_path = sys.argv[1]
    output_dir = sys.argv[2]

    # Create output directory
    os.makedirs(output_dir, exist_ok=True)

    print(f"Geodatabase: {gdb_path}")
    print(f"Output directory: {output_dir}")

    # Export each resolution
    # Resolution 3: ZStatsAsTable_h3_res3_part01 through part37
    export_resolution(gdb_path, output_dir, 3, "ZStatsAsTable_h3_res3_part*")

    # Resolution 5: ZStatsTable_h3_res5_part001 through part453
    export_resolution(gdb_path, output_dir, 5, "ZStatsTable_h3_res5_part*")

    # Resolution 7: ZStatsAsTable_Out_h3_res7_chunk_*
    export_resolution(gdb_path, output_dir, 7, "*h3_res7_chunk*")

    # Write biome color mapping for frontend
    biome_colors_file = os.path.join(output_dir, "biome_colors.json")
    with open(biome_colors_file, 'w') as f:
        json.dump({
            "classes": LANDCOVER_CLASSES,
            "biome_to_color": {
                info["biome"]: info["color"]
                for info in LANDCOVER_CLASSES.values()
            }
        }, f, indent=2)

    print(f"\nDone! Files written to {output_dir}")
    print(f"Biome color mapping: {biome_colors_file}")
    print("\nNext steps:")
    print("1. Upload the .jsonl files to your server or Cloudflare R2")
    print("2. Run the D1 import script to populate the tile_biomes table")


if __name__ == "__main__":
    main()
