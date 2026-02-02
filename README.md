# Biome Zonal Statistics

Cloudflare D1-backed storage for H3-indexed zonal statistics data.

## Architecture

```
Geodatabase (local)          Cloudflare D1
┌─────────────────────┐      ┌─────────────────────────────────┐
│ ZStatsTable_h3_res5 │      │ biome-zonal-stats database      │
│   _part1            │      │                                 │
│   _part2            │ ───► │  zonal_stats_res5 (combined)    │
│   _part...          │      │  zonal_stats_res6               │
│   _part450          │      │  zonal_stats_res7               │
│                     │      │  ...                            │
│ ZStatsTable_h3_res7 │      │                                 │
│   _part1            │ ───► │  Indexed by h3_index            │
│   _part...          │      │                                 │
└─────────────────────┘      └─────────────────────────────────┘
```

**Key decisions:**
- Parts within same resolution → combined into single table
- Different resolutions → separate tables
- Each table indexed on `h3_index` for fast lookups

## Setup

### 1. Install dependencies

```bash
npm install
npm install -g wrangler  # if not already installed
wrangler login           # authenticate with Cloudflare
```

### 2. Create D1 database

```bash
npm run db:create
# Copy the database_id from output and update wrangler.toml
```

### 3. Apply schema

```bash
npm run db:schema
```

## Uploading Data

### Step 1: Export from Geodatabase

Run on your Windows machine with ArcGIS Pro:

```bash
# In ArcGIS Pro Python environment
python scripts/export_geodatabase.py
```

This creates CSV/JSON files in `data/exports/` organized by resolution.

### Step 2: Upload to D1

```bash
npm run db:upload
# or for specific resolution:
node scripts/upload_to_d1.js --resolution 5
```

## Schema

Each resolution table has this structure:

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| h3_index | TEXT | H3 cell identifier |
| zone_code | INTEGER | Zone identifier |
| count | INTEGER | Pixel count |
| area | REAL | Area in units |
| majority | INTEGER | Majority class value |
| source_part | TEXT | Original source table |

## Querying

```bash
# Query via wrangler
wrangler d1 execute biome-zonal-stats --command "SELECT * FROM zonal_stats_res5 WHERE h3_index = '858a48b3fffffff'"

# Count records per resolution
wrangler d1 execute biome-zonal-stats --command "SELECT 'res5' as res, COUNT(*) FROM zonal_stats_res5 UNION ALL SELECT 'res7', COUNT(*) FROM zonal_stats_res7"
```

## File Structure

```
Biome/
├── wrangler.toml           # Cloudflare Workers config
├── schema.sql              # D1 database schema
├── package.json            # npm scripts
├── scripts/
│   ├── export_geodatabase.py   # Export from ArcGIS .gdb
│   ├── upload_to_d1.js         # Upload to D1 (Node.js)
│   └── upload_to_d1.sh         # Upload to D1 (bash)
├── data/
│   └── exports/            # Exported data (not in git)
│       ├── manifest.json
│       ├── res5/
│       │   ├── zonal_stats_res5.csv
│       │   └── zonal_stats_res5.json
│       └── res7/
│           └── ...
└── src/                    # API worker (future)
    └── index.ts
```

## D1 Limits

- Max database size: 10GB
- Max databases per account: 500
- Recommended batch insert size: 500 records

For datasets exceeding these limits, consider R2 + Parquet files with DuckDB WASM.
