"""
Export Zonal Statistics tables from ArcGIS Geodatabase to CSV/JSON for D1 upload.

This script extracts tables matching the pattern 'ZStatsTable_h3_res*' from a geodatabase
and exports them to CSV files organized by resolution.

Usage:
    python export_geodatabase.py

Requirements:
    - ArcGIS Pro with arcpy (preferred)
    - OR: pip install fiona pandas (alternative, limited gdb support)
"""

import os
import re
import json
import csv
from pathlib import Path
from datetime import datetime

# Configuration
GDB_PATH = r"C:\Users\mmulq\Projects\Biome\Biome.gdb"
OUTPUT_DIR = Path(__file__).parent.parent / "data" / "exports"
TABLE_PATTERN = r"ZStatsTable_h3_res(\d+)_part(\d+)"

# Column mapping from geodatabase to our schema
COLUMN_MAP = {
    "OBJECTID": None,  # Skip, we'll use auto-increment
    "h3_index": "h3_index",
    "ZONE_CODE": "zone_code",
    "COUNT": "count",
    "AREA": "area",
    "MAJORITY": "majority"
}


def setup_output_dirs():
    """Create output directory structure."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for res in range(5, 10):  # res5 through res9
        (OUTPUT_DIR / f"res{res}").mkdir(exist_ok=True)
    print(f"Output directory: {OUTPUT_DIR}")


def export_with_arcpy():
    """Export using ArcGIS arcpy (recommended for .gdb files)."""
    try:
        import arcpy
    except ImportError:
        print("arcpy not available. Try running in ArcGIS Pro Python environment.")
        return False

    arcpy.env.workspace = GDB_PATH
    tables = arcpy.ListTables()

    if not tables:
        print(f"No tables found in {GDB_PATH}")
        return False

    # Filter to zonal stats tables
    zstats_tables = []
    for table in tables:
        match = re.match(TABLE_PATTERN, table)
        if match:
            resolution = int(match.group(1))
            part = int(match.group(2))
            zstats_tables.append((table, resolution, part))

    print(f"Found {len(zstats_tables)} zonal statistics tables")

    # Group by resolution
    by_resolution = {}
    for table, res, part in zstats_tables:
        if res not in by_resolution:
            by_resolution[res] = []
        by_resolution[res].append((table, part))

    # Export each resolution
    for resolution, tables_list in sorted(by_resolution.items()):
        print(f"\nProcessing resolution {resolution}: {len(tables_list)} tables")

        all_records = []
        for table_name, part in sorted(tables_list, key=lambda x: x[1]):
            # Get field names
            fields = [f.name for f in arcpy.ListFields(table_name)]

            # Map to our schema
            field_indices = {}
            for orig, mapped in COLUMN_MAP.items():
                if mapped and orig in fields:
                    field_indices[mapped] = fields.index(orig)

            # Read records
            with arcpy.da.SearchCursor(table_name, fields) as cursor:
                count = 0
                for row in cursor:
                    record = {
                        "h3_index": row[fields.index("h3_index")] if "h3_index" in fields else None,
                        "zone_code": row[fields.index("ZONE_CODE")] if "ZONE_CODE" in fields else None,
                        "count": row[fields.index("COUNT")] if "COUNT" in fields else None,
                        "area": row[fields.index("AREA")] if "AREA" in fields else None,
                        "majority": row[fields.index("MAJORITY")] if "MAJORITY" in fields else None,
                        "source_part": f"part{part}"
                    }
                    all_records.append(record)
                    count += 1
                print(f"  {table_name}: {count} records")

        # Write combined CSV for this resolution
        output_file = OUTPUT_DIR / f"res{resolution}" / f"zonal_stats_res{resolution}.csv"
        with open(output_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=['h3_index', 'zone_code', 'count', 'area', 'majority', 'source_part'])
            writer.writeheader()
            writer.writerows(all_records)

        print(f"  Exported {len(all_records)} total records to {output_file}")

        # Also write as JSON for D1 import
        json_file = OUTPUT_DIR / f"res{resolution}" / f"zonal_stats_res{resolution}.json"
        with open(json_file, 'w', encoding='utf-8') as f:
            json.dump(all_records, f)
        print(f"  Also exported to {json_file}")

    return True


def export_with_fiona():
    """Alternative export using fiona/geopandas (limited .gdb support)."""
    try:
        import fiona
        import pandas as pd
    except ImportError:
        print("fiona/pandas not available. Install with: pip install fiona pandas")
        return False

    print("Note: fiona has limited support for .gdb files. arcpy is recommended.")

    # List layers in geodatabase
    layers = fiona.listlayers(GDB_PATH)
    print(f"Found {len(layers)} layers")

    # Filter to zonal stats tables
    zstats_layers = []
    for layer in layers:
        match = re.match(TABLE_PATTERN, layer)
        if match:
            resolution = int(match.group(1))
            part = int(match.group(2))
            zstats_layers.append((layer, resolution, part))

    print(f"Found {len(zstats_layers)} zonal statistics tables")

    # Group and export by resolution
    by_resolution = {}
    for layer, res, part in zstats_layers:
        if res not in by_resolution:
            by_resolution[res] = []
        by_resolution[res].append((layer, part))

    for resolution, layers_list in sorted(by_resolution.items()):
        print(f"\nProcessing resolution {resolution}: {len(layers_list)} tables")

        all_dfs = []
        for layer_name, part in sorted(layers_list, key=lambda x: x[1]):
            with fiona.open(GDB_PATH, layer=layer_name) as src:
                records = [dict(rec['properties']) for rec in src]
                df = pd.DataFrame(records)
                df['source_part'] = f"part{part}"
                all_dfs.append(df)
                print(f"  {layer_name}: {len(df)} records")

        # Combine all parts
        combined = pd.concat(all_dfs, ignore_index=True)

        # Rename columns to match schema
        combined = combined.rename(columns={
            'ZONE_CODE': 'zone_code',
            'COUNT': 'count',
            'AREA': 'area',
            'MAJORITY': 'majority'
        })

        # Select only needed columns
        columns = ['h3_index', 'zone_code', 'count', 'area', 'majority', 'source_part']
        combined = combined[[c for c in columns if c in combined.columns]]

        # Export
        output_file = OUTPUT_DIR / f"res{resolution}" / f"zonal_stats_res{resolution}.csv"
        combined.to_csv(output_file, index=False)
        print(f"  Exported {len(combined)} total records to {output_file}")

        json_file = OUTPUT_DIR / f"res{resolution}" / f"zonal_stats_res{resolution}.json"
        combined.to_json(json_file, orient='records')
        print(f"  Also exported to {json_file}")

    return True


def generate_manifest():
    """Generate a manifest of exported files for the upload script."""
    manifest = {
        "exported_at": datetime.now().isoformat(),
        "source": GDB_PATH,
        "resolutions": {}
    }

    for res_dir in OUTPUT_DIR.iterdir():
        if res_dir.is_dir() and res_dir.name.startswith("res"):
            res = int(res_dir.name[3:])
            csv_file = res_dir / f"zonal_stats_res{res}.csv"
            if csv_file.exists():
                # Count records
                with open(csv_file, 'r') as f:
                    record_count = sum(1 for _ in f) - 1  # minus header

                manifest["resolutions"][res] = {
                    "csv_file": str(csv_file),
                    "json_file": str(res_dir / f"zonal_stats_res{res}.json"),
                    "record_count": record_count
                }

    manifest_file = OUTPUT_DIR / "manifest.json"
    with open(manifest_file, 'w') as f:
        json.dump(manifest, f, indent=2)

    print(f"\nManifest written to {manifest_file}")
    return manifest


def main():
    print("=" * 60)
    print("Biome Zonal Statistics Export")
    print("=" * 60)
    print(f"Source: {GDB_PATH}")
    print(f"Output: {OUTPUT_DIR}")
    print()

    setup_output_dirs()

    # Try arcpy first, fall back to fiona
    success = export_with_arcpy()
    if not success:
        print("\nTrying fiona as fallback...")
        success = export_with_fiona()

    if success:
        manifest = generate_manifest()
        print("\n" + "=" * 60)
        print("Export Summary")
        print("=" * 60)
        for res, info in sorted(manifest.get("resolutions", {}).items()):
            print(f"Resolution {res}: {info['record_count']:,} records")
        print("\nNext step: Run upload_to_d1.py to push to Cloudflare D1")
    else:
        print("\nExport failed. Please ensure you have either:")
        print("  1. ArcGIS Pro Python environment (for arcpy)")
        print("  2. fiona and pandas installed (pip install fiona pandas)")


if __name__ == "__main__":
    main()
