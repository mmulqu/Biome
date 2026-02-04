-- Migration: Add tile_biomes table for land cover data
-- This stores the pre-computed majority land cover class for each H3 tile

-- Tile biomes lookup table (h3_index -> biome_code)
CREATE TABLE IF NOT EXISTS tile_biomes (
    h3_index TEXT PRIMARY KEY,
    resolution INTEGER NOT NULL,
    landcover_code INTEGER NOT NULL DEFAULT 0,
    biome_type TEXT NOT NULL DEFAULT 'unknown',
    created_at TEXT DEFAULT (datetime('now'))
);

-- Index for resolution-based queries
CREATE INDEX IF NOT EXISTS idx_tile_biomes_resolution ON tile_biomes(resolution);

-- Index for biome type queries
CREATE INDEX IF NOT EXISTS idx_tile_biomes_biome ON tile_biomes(biome_type);

-- Land cover class reference table
CREATE TABLE IF NOT EXISTS landcover_classes (
    code INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    biome_type TEXT NOT NULL,
    color TEXT NOT NULL,
    description TEXT
);

-- Insert Copernicus Global Land Cover classes
INSERT OR REPLACE INTO landcover_classes (code, name, biome_type, color, description) VALUES
    (0, 'unknown', 'unknown', '#808080', 'Unknown or no data'),
    (20, 'shrubs', 'shrubland', '#ccb35c', 'Shrubland'),
    (30, 'herbaceous', 'grassland', '#b8e05c', 'Herbaceous vegetation / Grassland'),
    (40, 'cultivated', 'agricultural', '#e9d35f', 'Cultivated and managed vegetation'),
    (50, 'urban', 'urban', '#e60000', 'Urban / built up'),
    (60, 'bare_sparse', 'desert', '#c4b79f', 'Bare / sparse vegetation'),
    (70, 'snow_ice', 'polar', '#f0f0f0', 'Snow and ice'),
    (80, 'water', 'freshwater', '#0064c8', 'Permanent water bodies'),
    (90, 'wetland', 'wetland', '#009696', 'Herbaceous wetland'),
    (100, 'moss_lichen', 'tundra', '#7dd67d', 'Moss and lichen'),
    (111, 'forest_evergreen_needle', 'forest', '#006400', 'Closed forest, evergreen needle leaf'),
    (112, 'forest_evergreen_broad', 'forest', '#00a000', 'Closed forest, evergreen broad leaf'),
    (113, 'forest_deciduous_needle', 'forest', '#aac800', 'Closed forest, deciduous needle leaf'),
    (114, 'forest_deciduous_broad', 'forest', '#68c800', 'Closed forest, deciduous broad leaf'),
    (115, 'forest_mixed', 'forest', '#00c800', 'Closed forest, mixed'),
    (116, 'forest_unknown', 'forest', '#32c832', 'Closed forest, not matching any definition'),
    (121, 'forest_open_evergreen_needle', 'woodland', '#88a000', 'Open forest, evergreen needle leaf'),
    (122, 'forest_open_evergreen_broad', 'woodland', '#78c800', 'Open forest, evergreen broad leaf'),
    (123, 'forest_open_deciduous_needle', 'woodland', '#a0c000', 'Open forest, deciduous needle leaf'),
    (124, 'forest_open_deciduous_broad', 'woodland', '#90c800', 'Open forest, deciduous broad leaf'),
    (125, 'forest_open_mixed', 'woodland', '#78c864', 'Open forest, mixed'),
    (126, 'forest_open_unknown', 'woodland', '#6bc864', 'Open forest, not matching any definition'),
    (200, 'ocean', 'ocean', '#000080', 'Oceans and seas');
