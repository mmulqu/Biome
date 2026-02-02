-- Cloudflare D1 Schema for Biome Zonal Statistics
-- Each resolution gets its own table for optimal query performance

-- Resolution 5 (~252km² hexagons)
CREATE TABLE IF NOT EXISTS zonal_stats_res5 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    h3_index TEXT NOT NULL,
    zone_code INTEGER NOT NULL,
    count INTEGER NOT NULL,
    area REAL NOT NULL,
    majority INTEGER,
    source_part TEXT,  -- tracks which original table this came from
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_res5_h3 ON zonal_stats_res5(h3_index);
CREATE INDEX IF NOT EXISTS idx_res5_zone ON zonal_stats_res5(zone_code);

-- Resolution 6 (~36km² hexagons)
CREATE TABLE IF NOT EXISTS zonal_stats_res6 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    h3_index TEXT NOT NULL,
    zone_code INTEGER NOT NULL,
    count INTEGER NOT NULL,
    area REAL NOT NULL,
    majority INTEGER,
    source_part TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_res6_h3 ON zonal_stats_res6(h3_index);
CREATE INDEX IF NOT EXISTS idx_res6_zone ON zonal_stats_res6(zone_code);

-- Resolution 7 (~5.16km² hexagons)
CREATE TABLE IF NOT EXISTS zonal_stats_res7 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    h3_index TEXT NOT NULL,
    zone_code INTEGER NOT NULL,
    count INTEGER NOT NULL,
    area REAL NOT NULL,
    majority INTEGER,
    source_part TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_res7_h3 ON zonal_stats_res7(h3_index);
CREATE INDEX IF NOT EXISTS idx_res7_zone ON zonal_stats_res7(zone_code);

-- Resolution 8 (~0.74km² hexagons)
CREATE TABLE IF NOT EXISTS zonal_stats_res8 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    h3_index TEXT NOT NULL,
    zone_code INTEGER NOT NULL,
    count INTEGER NOT NULL,
    area REAL NOT NULL,
    majority INTEGER,
    source_part TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_res8_h3 ON zonal_stats_res8(h3_index);
CREATE INDEX IF NOT EXISTS idx_res8_zone ON zonal_stats_res8(zone_code);

-- Resolution 9 (~0.11km² hexagons)
CREATE TABLE IF NOT EXISTS zonal_stats_res9 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    h3_index TEXT NOT NULL,
    zone_code INTEGER NOT NULL,
    count INTEGER NOT NULL,
    area REAL NOT NULL,
    majority INTEGER,
    source_part TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_res9_h3 ON zonal_stats_res9(h3_index);
CREATE INDEX IF NOT EXISTS idx_res9_zone ON zonal_stats_res9(zone_code);

-- Metadata table to track upload progress
CREATE TABLE IF NOT EXISTS upload_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resolution INTEGER NOT NULL,
    source_table TEXT NOT NULL,
    record_count INTEGER NOT NULL,
    uploaded_at TEXT DEFAULT (datetime('now')),
    UNIQUE(resolution, source_table)
);
