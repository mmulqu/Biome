// Iconic taxa from iNaturalist
export type IconicTaxon =
  | 'Plantae'
  | 'Aves'
  | 'Fungi'
  | 'Insecta'
  | 'Mammalia'
  | 'Amphibia'
  | 'Reptilia'
  | 'Mollusca'
  | 'Arachnida'
  | 'Actinopterygii'
  | 'Animalia'
  | 'unknown';

// Biome types (based on Copernicus Global Land Cover)
export type BiomeType =
  | 'forest'      // Closed forests (111-116)
  | 'woodland'    // Open forests (121-126)
  | 'shrubland'   // Shrubs (20)
  | 'grassland'   // Herbaceous vegetation (30)
  | 'wetland'     // Herbaceous wetland (90)
  | 'tundra'      // Moss and lichen (100)
  | 'urban'       // Built up (50)
  | 'agricultural'// Cultivated (40)
  | 'desert'      // Bare/sparse vegetation (60)
  | 'polar'       // Snow and ice (70)
  | 'freshwater'  // Permanent water bodies (80)
  | 'ocean'       // Oceans and seas (200)
  | 'unknown';    // No data (0)

// Player data
export interface Player {
  id: string;
  username: string;
  display_name: string;
  pfp_url: string;
  total_points: number;
  tiles_owned: number;
  observation_count: number;
  unique_species: number;
  data_deserts_pioneered: number;
}

// Observation from iNaturalist
export interface Observation {
  id: string;
  player_id: string;
  username: string;
  pfp_url?: string;
  h3_index: string;
  taxon_id: number | null;
  iconic_taxon: IconicTaxon;
  species_name: string | null;
  common_name: string | null;
  observed_at: string;
  latitude: number;
  longitude: number;
  is_research_grade: boolean;
  photo_url: string | null;
  inat_url: string;
  base_points: number;
  taxa_multiplier: number;
  data_gap_multiplier: number;
  research_grade_bonus: number;
  total_points: number;
}

// H3 Tile data
export interface Tile {
  h3_index: string;
  resolution: number;  // H3 resolution (4, 6, or 9)
  biome_type: BiomeType;
  center_lat: number;
  center_lng: number;
  total_observations: number;
  unique_observers: number;
  owner_id: string | null;
  owner_username?: string;
  owner_pfp?: string;
  owner_points: number;
  is_rare: boolean;
  // Pre-computed boundary for rendering
  boundary?: [number, number][];
  // Grid bucket for spatial indexing
  grid_bucket?: string;
  // For hierarchical tiles: count of child tiles owned
  child_tiles_owned?: number;
  child_tiles_total?: number;
}

// Tile score entry
export interface TileScore {
  h3_index: string;
  player_id: string;
  username: string;
  pfp_url?: string;
  total_points: number;
  observation_count: number;
}

// Leaderboard entry
export interface LeaderboardEntry {
  rank: number;
  id: string;
  username: string;
  display_name: string;
  pfp_url?: string;
  total_points: number;
  tiles_owned?: number;
  observation_count?: number;
}

// Map bounds for viewport queries
export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

// iNaturalist API response types
export interface INatObservation {
  id: number;
  observed_on_string: string;
  quality_grade: 'research' | 'needs_id' | 'casual';
  location: string | null;
  uri: string;
  taxon?: {
    id: number;
    iconic_taxon_name: string;
    name: string;
    preferred_common_name?: string;
  };
  photos?: Array<{
    url: string;
  }>;
  user: {
    id: number;
    login: string;
    name?: string;
    icon_url?: string;
  };
}

export interface INatObservationsResponse {
  total_results: number;
  page: number;
  per_page: number;
  results: INatObservation[];
}

// Scoring constants
export const SCORING = {
  BASE_POINTS: 10,
  RESEARCH_GRADE_BONUS: 1.25,
  TAXA_MATCH_MULTIPLIER: 1.5,
  DATA_GAP_THRESHOLDS: [
    { max: 0, multiplier: 3.0 },
    { max: 10, multiplier: 2.0 },
    { max: 50, multiplier: 1.5 },
    { max: 200, multiplier: 1.2 },
    { max: 500, multiplier: 1.0 },
    { max: Infinity, multiplier: 0.8 }
  ]
} as const;

// Taxa colors for UI
export const TAXA_COLORS: Record<IconicTaxon, string> = {
  Plantae: '#73AC13',
  Aves: '#1E90FF',
  Fungi: '#9932CC',
  Insecta: '#FF8C00',
  Mammalia: '#DC143C',
  Amphibia: '#20B2AA',
  Reptilia: '#228B22',
  Mollusca: '#4169E1',
  Arachnida: '#8B4513',
  Actinopterygii: '#00CED1',
  Animalia: '#1E90FF',
  unknown: '#808080'
};

// Biome colors for map (exact Copernicus Global Land Cover RGB values)
export const BIOME_COLORS: Record<BiomeType, string> = {
  forest: '#009900',      // Closed forest evergreen broad (0, 153, 0)
  woodland: '#8DB400',    // Open forest evergreen broad (141, 180, 0)
  shrubland: '#FFBB22',   // Shrubs (255, 187, 34)
  grassland: '#FFFF4C',   // Herbaceous vegetation (255, 255, 76)
  wetland: '#0096A0',     // Herbaceous wetland (0, 150, 160)
  tundra: '#FAE6A0',      // Moss and lichen (250, 230, 160)
  urban: '#FA0000',       // Urban/built up (250, 0, 0)
  agricultural: '#F096FF',// Cultivated/cropland (240, 150, 255)
  desert: '#B4B4B4',      // Bare/sparse vegetation (180, 180, 180)
  polar: '#F0F0F0',       // Snow and ice (240, 240, 240)
  freshwater: '#0032C8',  // Permanent water bodies (0, 50, 200)
  ocean: '#000080',       // Open sea (0, 0, 128)
  unknown: '#282828'      // No data (40, 40, 40)
};

// Land cover code to biome type mapping
export const LANDCOVER_TO_BIOME: Record<number, BiomeType> = {
  0: 'unknown',
  20: 'shrubland',
  30: 'grassland',
  40: 'agricultural',
  50: 'urban',
  60: 'desert',
  70: 'polar',
  80: 'freshwater',
  90: 'wetland',
  100: 'tundra',
  111: 'forest',
  112: 'forest',
  113: 'forest',
  114: 'forest',
  115: 'forest',
  116: 'forest',
  121: 'woodland',
  122: 'woodland',
  123: 'woodland',
  124: 'woodland',
  125: 'woodland',
  126: 'woodland',
  200: 'ocean',
};

// Biome bonus taxa
export const BIOME_BONUS_TAXA: Record<BiomeType, IconicTaxon[]> = {
  forest: ['Plantae', 'Fungi', 'Aves', 'Insecta', 'Mammalia'],
  woodland: ['Plantae', 'Aves', 'Insecta', 'Fungi', 'Mammalia'],
  shrubland: ['Reptilia', 'Aves', 'Insecta', 'Plantae'],
  grassland: ['Plantae', 'Insecta', 'Aves', 'Mammalia'],
  wetland: ['Amphibia', 'Aves', 'Plantae', 'Insecta'],
  tundra: ['Plantae', 'Fungi', 'Aves', 'Mammalia'],
  urban: ['Aves', 'Insecta', 'Plantae', 'Mammalia'],
  agricultural: ['Aves', 'Insecta', 'Plantae'],
  desert: ['Reptilia', 'Arachnida', 'Plantae', 'Insecta'],
  polar: ['Aves', 'Mammalia'],
  freshwater: ['Amphibia', 'Actinopterygii', 'Aves', 'Plantae', 'Insecta'],
  ocean: ['Actinopterygii', 'Mollusca'],
  unknown: []
};

// H3 resolutions for hierarchical tiles
// Reference areas per resolution:
// Res 3: ~12,392 km²  | Res 4: ~1,770 km²  | Res 5: ~252 km²
// Res 6: ~36 km²      | Res 7: ~5.16 km²   | Res 8: ~0.74 km²
// Res 9: ~0.105 km²
export const H3_RESOLUTIONS = {
  REGIONAL: 3,    // ~12,392 km² - visible at zoom 0-6 (country/state scale)
  LOCAL: 5,       // ~252 km² - visible at zoom 7-10 (county/city scale)
  SUPER_LOCAL: 7  // ~5.16 km² - visible at zoom 11+ (neighborhood scale)
} as const;

// Legacy export for backward compatibility
export const H3_RESOLUTION = H3_RESOLUTIONS.SUPER_LOCAL;

// Tile resolution type
export type TileResolution = 'regional' | 'local' | 'super_local';

// Map zoom to appropriate H3 resolution
export function getResolutionForZoom(zoom: number): { resolution: number; type: TileResolution } {
  if (zoom <= 6) {
    return { resolution: H3_RESOLUTIONS.REGIONAL, type: 'regional' };
  } else if (zoom <= 10) {
    return { resolution: H3_RESOLUTIONS.LOCAL, type: 'local' };
  } else {
    return { resolution: H3_RESOLUTIONS.SUPER_LOCAL, type: 'super_local' };
  }
}

// Minimum zoom to show observations (points markers)
export const MIN_ZOOM_FOR_OBSERVATIONS = 14;
