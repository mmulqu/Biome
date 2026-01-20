import { useEffect, useMemo, useState, useCallback } from 'react';
import { MapContainer, TileLayer, useMapEvents, Polygon, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import * as h3 from 'h3-js';
import type { Observation, Tile, IconicTaxon } from '../types';
import { TAXA_COLORS, BIOME_COLORS, H3_RESOLUTION } from '../types';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icon issue with bundlers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

interface GameMapProps {
  observations: Observation[];
  tiles: Tile[];
  selectedTile: string | null;
  onTileSelect: (h3Index: string | null) => void;
  onBoundsChange: (bounds: { north: number; south: number; east: number; west: number }) => void;
  currentPlayerId?: string;
  initialCenter?: [number, number];
  initialZoom?: number;
}

// Get hexagon boundary coordinates for Leaflet
function getHexBoundary(h3Index: string): [number, number][] {
  const boundary = h3.cellToBoundary(h3Index);
  return boundary.map(([lat, lng]) => [lat, lng] as [number, number]);
}

// Map event handler component
function MapEventHandler({
  onBoundsChange
}: {
  onBoundsChange: (bounds: { north: number; south: number; east: number; west: number }) => void
}) {
  const map = useMapEvents({
    moveend: () => {
      const bounds = map.getBounds();
      onBoundsChange({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest()
      });
    },
    zoomend: () => {
      const bounds = map.getBounds();
      onBoundsChange({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest()
      });
    }
  });

  // Emit initial bounds
  useEffect(() => {
    const bounds = map.getBounds();
    onBoundsChange({
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest()
    });
  }, [map, onBoundsChange]);

  return null;
}

// Component to fly to a location
function MapController({ center, zoom }: { center?: [number, number]; zoom?: number }) {
  const map = useMap();

  useEffect(() => {
    if (center) {
      map.flyTo(center, zoom || map.getZoom(), { duration: 1 });
    }
  }, [map, center, zoom]);

  return null;
}

// Hexagon tile component
function HexTile({
  tile,
  isSelected,
  onClick
}: {
  tile: Tile;
  isSelected: boolean;
  onClick: () => void;
}) {
  const boundary = useMemo(() => getHexBoundary(tile.h3_index), [tile.h3_index]);

  const fillColor = tile.owner_id
    ? '#73AC13' // Owned tiles are green
    : BIOME_COLORS[tile.biome_type] || BIOME_COLORS.unknown;

  const fillOpacity = tile.total_observations > 0 ? 0.4 : 0.15;

  return (
    <Polygon
      positions={boundary}
      pathOptions={{
        fillColor,
        fillOpacity: isSelected ? 0.7 : fillOpacity,
        color: isSelected ? '#73AC13' : tile.owner_id ? '#73AC13' : 'rgba(255,255,255,0.3)',
        weight: isSelected ? 3 : 1
      }}
      eventHandlers={{
        click: (e) => {
          e.originalEvent.stopPropagation();
          onClick();
        }
      }}
    />
  );
}

// Observation marker component
function ObservationMarker({
  observation,
  isCurrentPlayer
}: {
  observation: Observation;
  isCurrentPlayer: boolean;
}) {
  const taxaColor = TAXA_COLORS[observation.iconic_taxon as IconicTaxon] || TAXA_COLORS.unknown;

  return (
    <CircleMarker
      center={[observation.latitude, observation.longitude]}
      radius={isCurrentPlayer ? 10 : 7}
      pathOptions={{
        fillColor: taxaColor,
        fillOpacity: 0.9,
        color: isCurrentPlayer ? '#73AC13' : 'white',
        weight: isCurrentPlayer ? 3 : 2
      }}
    >
      <Popup>
        <div className="popup-content">
          {observation.photo_url && (
            <img
              src={observation.photo_url}
              alt={observation.species_name || 'Observation'}
              className="popup-image"
            />
          )}

          <div className="popup-details">
            <h3 className="popup-title">
              {observation.common_name || observation.species_name || 'Unknown Species'}
            </h3>

            {observation.species_name && observation.common_name && (
              <p className="popup-species">
                {observation.species_name}
              </p>
            )}

            <span
              className="taxa-pill"
              style={{
                backgroundColor: `${taxaColor}22`,
                color: taxaColor,
                border: `1px solid ${taxaColor}44`
              }}
            >
              {observation.iconic_taxon}
            </span>

            <div className="popup-meta">
              <span className="popup-date">
                {new Date(observation.observed_at).toLocaleDateString()}
              </span>
              <span className="popup-points">
                +{observation.total_points} pts
              </span>
            </div>

            {observation.is_research_grade && (
              <div className="popup-badge">
                <span>✓</span> Research Grade
              </div>
            )}

            <div className="popup-user">
              {observation.pfp_url && (
                <img
                  src={observation.pfp_url}
                  alt={observation.username}
                  className="popup-avatar"
                />
              )}
              <span>@{observation.username}</span>
            </div>

            <a
              href={observation.inat_url}
              target="_blank"
              rel="noopener noreferrer"
              className="popup-link"
            >
              View on iNaturalist →
            </a>
          </div>
        </div>
      </Popup>
    </CircleMarker>
  );
}

// Visible hexagons renderer
function HexagonLayer({
  bounds,
  tiles,
  selectedTile,
  onTileSelect
}: {
  bounds: { north: number; south: number; east: number; west: number } | null;
  tiles: Tile[];
  selectedTile: string | null;
  onTileSelect: (h3Index: string | null) => void;
}) {
  const tileMap = useMemo(() => {
    const map = new Map<string, Tile>();
    tiles.forEach(t => map.set(t.h3_index, t));
    return map;
  }, [tiles]);

  const visibleHexes = useMemo(() => {
    if (!bounds) return [];

    // Use H3's polygonToCells for efficient coverage
    const polygon: [number, number][] = [
      [bounds.north, bounds.west],
      [bounds.north, bounds.east],
      [bounds.south, bounds.east],
      [bounds.south, bounds.west],
      [bounds.north, bounds.west], // Close the polygon
    ];

    try {
      // Get all hexes that intersect with the viewport polygon
      const hexes = h3.polygonToCells(polygon, H3_RESOLUTION, true);

      // Limit to prevent performance issues at low zoom
      if (hexes.length > 500) {
        return hexes.slice(0, 500);
      }
      return hexes;
    } catch (e) {
      // Fallback to sampling if polygonToCells fails (e.g., crosses antimeridian)
      const hexSet = new Set<string>();
      const latRange = bounds.north - bounds.south;
      const lngRange = bounds.east - bounds.west;
      const step = Math.min(latRange, lngRange) / 30;

      for (let lat = bounds.south; lat <= bounds.north; lat += step) {
        for (let lng = bounds.west; lng <= bounds.east; lng += step) {
          const h3Index = h3.latLngToCell(lat, lng, H3_RESOLUTION);
          hexSet.add(h3Index);
          // Also add neighbors to fill gaps
          h3.gridDisk(h3Index, 1).forEach(neighbor => hexSet.add(neighbor));
          if (hexSet.size >= 500) break;
        }
        if (hexSet.size >= 500) break;
      }

      return Array.from(hexSet);
    }
  }, [bounds]);

  return (
    <>
      {visibleHexes.map(h3Index => {
        const tile = tileMap.get(h3Index) || {
          h3_index: h3Index,
          biome_type: 'unknown' as const,
          total_observations: 0,
          center_lat: 0,
          center_lng: 0,
          unique_observers: 0,
          owner_id: null,
          owner_points: 0,
          is_rare: false
        };

        return (
          <HexTile
            key={h3Index}
            tile={tile}
            isSelected={selectedTile === h3Index}
            onClick={() => onTileSelect(h3Index === selectedTile ? null : h3Index)}
          />
        );
      })}
    </>
  );
}

export default function GameMap({
  observations,
  tiles,
  selectedTile,
  onTileSelect,
  onBoundsChange,
  currentPlayerId,
  initialCenter,
  initialZoom
}: GameMapProps) {
  const [bounds, setBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null);
  const [mapCenter] = useState<[number, number] | undefined>(initialCenter);

  const handleBoundsChange = useCallback((newBounds: typeof bounds) => {
    setBounds(newBounds);
    if (newBounds) {
      onBoundsChange(newBounds);
    }
  }, [onBoundsChange]);

  // Default center: San Francisco (good for demo)
  const defaultCenter: [number, number] = initialCenter || [37.7749, -122.4194];
  const defaultZoom = initialZoom || 14;

  return (
    <MapContainer
      center={defaultCenter}
      zoom={defaultZoom}
      className="game-map"
      zoomControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />

      <MapEventHandler onBoundsChange={handleBoundsChange} />

      {mapCenter && <MapController center={mapCenter} />}

      <HexagonLayer
        bounds={bounds}
        tiles={tiles}
        selectedTile={selectedTile}
        onTileSelect={onTileSelect}
      />

      {observations.map(obs => (
        <ObservationMarker
          key={obs.id}
          observation={obs}
          isCurrentPlayer={obs.player_id === currentPlayerId}
        />
      ))}
    </MapContainer>
  );
}
