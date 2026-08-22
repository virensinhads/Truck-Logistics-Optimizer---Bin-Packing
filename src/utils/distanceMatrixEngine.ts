import { DistanceMatrixData, LocationPoint, DistanceMatrixEntry } from '../types';
import { computeHaversineDistanceKm, estimateDrivingDurationMin } from './haversine';
import * as XLSX from 'xlsx';

// Local storage key for persisting distance matrix across tabs/sessions
export const DISTANCE_MATRIX_STORAGE_KEY = 'LOGISTICS_DISTANCE_MATRIX_CACHE';

/**
 * Generates a unique key for a coordinate pair
 */
export function getLocationKey(lat: number, lon: number, name?: string): string {
  const roundedLat = Math.round(lat * 10000) / 10000;
  const roundedLon = Math.round(lon * 10000) / 10000;
  return `${roundedLat},${roundedLon}`;
}

/**
 * Extracts unique location points from orders or coordinate array
 */
export function extractUniqueLocations(
  items: Array<{ dest?: string; lat: number; lon: number }>
): LocationPoint[] {
  const map = new Map<string, LocationPoint>();

  for (const item of items) {
    if (typeof item.lat !== 'number' || typeof item.lon !== 'number' || isNaN(item.lat) || isNaN(item.lon)) {
      continue;
    }
    const key = getLocationKey(item.lat, item.lon);
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: item.dest?.trim() || `Location (${item.lat.toFixed(3)}, ${item.lon.toFixed(3)})`,
        lat: item.lat,
        lon: item.lon,
      });
    }
  }

  return Array.from(map.values());
}

/**
 * Helper to call OSM Table API for a batch of locations
 */
async function fetchOsmTableApiBatch(
  locations: LocationPoint[],
  timeoutMs = 4000
): Promise<{
  distances?: (number | null)[][];
  durations?: (number | null)[][];
  success: boolean;
}> {
  try {
    const coordsParam = locations.map((loc) => `${loc.lon},${loc.lat}`).join(';');
    const url = `https://routing.openstreetmap.de/routed-car/table/v1/driving/${coordsParam}?annotations=distance,duration`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { success: false };
    }

    const data = await res.json();
    if (data.code === 'Ok' && Array.isArray(data.distances)) {
      return {
        distances: data.distances,
        durations: data.durations,
        success: true,
      };
    }
    return { success: false };
  } catch (err) {
    return { success: false };
  }
}

/**
 * Helper to call OSM Route API for a single coordinate pair
 */
async function fetchOsmRouteApiPair(
  loc1: LocationPoint,
  loc2: LocationPoint,
  timeoutMs = 2500
): Promise<{
  distanceKm?: number;
  durationMin?: number;
  success: boolean;
}> {
  try {
    const url = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${loc1.lon},${loc1.lat};${loc2.lon},${loc2.lat}?overview=false`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { success: false };
    }

    const data = await res.json();
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const distKm = Math.round((route.distance / 1000) * 100) / 100;
      const durMin = Math.round((route.duration / 60) * 10) / 10;
      return {
        distanceKm: distKm,
        durationMin: durMin,
        success: true,
      };
    }
    return { success: false };
  } catch (err) {
    return { success: false };
  }
}

export type MatrixProgressCallback = (progress: {
  percent: number;
  step: string;
  processedPairs: number;
  totalPairs: number;
  tierCounts: { osmTable: number; osmRoute: number; haversine: number };
}) => void;

/**
 * Script 1: 3-Tier Distance Matrix Engine
 * 1. Primary: OSM Table API (batch chunks)
 * 2. Secondary: OSM Route API (individual retry)
 * 3. Tertiary: 1.3x Haversine Formula (instant & infallible fallback)
 */
export async function generateDistanceMatrix(
  locations: LocationPoint[],
  onProgress?: MatrixProgressCallback
): Promise<DistanceMatrixData> {
  const n = locations.length;
  const totalPairs = n * n;

  const matrix: Record<string, Record<string, number>> = {};
  const durations: Record<string, Record<string, number>> = {};
  const sources: Record<string, Record<string, 'osm-table' | 'osm-route' | 'haversine' | 'manual'>> = {};

  // Initialize objects
  for (const loc1 of locations) {
    matrix[loc1.key] = {};
    durations[loc1.key] = {};
    sources[loc1.key] = {};
    for (const loc2 of locations) {
      if (loc1.key === loc2.key) {
        matrix[loc1.key][loc2.key] = 0;
        durations[loc1.key][loc2.key] = 0;
        sources[loc1.key][loc2.key] = 'osm-table';
      }
    }
  }

  let processedPairs = 0;
  let osmTablePairs = 0;
  let osmRoutePairs = 0;
  let haversinePairs = 0;

  // Handle trivial case (empty or 1 location)
  if (n <= 1) {
    const result: DistanceMatrixData = {
      locations,
      matrix,
      durations,
      sources,
      generatedAt: new Date().toISOString(),
      stats: {
        totalPairs,
        osmTablePairs: n,
        osmRoutePairs: 0,
        haversinePairs: 0,
        manualPairs: 0,
      },
    };
    saveDistanceMatrixToStorage(result);
    return result;
  }

  onProgress?.({
    percent: 10,
    step: `Processing ${locations.length} unique coordinates (${totalPairs} total pairs)...`,
    processedPairs: 0,
    totalPairs,
    tierCounts: { osmTable: 0, osmRoute: 0, haversine: 0 },
  });

  // TIER 1: Try OSM Table API in batch or sub-batches (max batch size = 25 for safe URL length)
  const CHUNK_SIZE = 20;
  const isSmallEnoughForSingleTable = n <= CHUNK_SIZE;

  if (isSmallEnoughForSingleTable) {
    onProgress?.({
      percent: 25,
      step: 'Tier 1: Querying OpenStreetMap Table API for all coordinate pairs...',
      processedPairs: 0,
      totalPairs,
      tierCounts: { osmTable: 0, osmRoute: 0, haversine: 0 },
    });

    const tableResult = await fetchOsmTableApiBatch(locations);

    if (tableResult.success && tableResult.distances) {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const loc1 = locations[i];
          const loc2 = locations[j];
          const distMeters = tableResult.distances[i]?.[j];
          const durSeconds = tableResult.durations?.[i]?.[j];

          if (distMeters != null && distMeters >= 0) {
            const distKm = Math.round((distMeters / 1000) * 100) / 100;
            const durMin = durSeconds != null ? Math.round((durSeconds / 60) * 10) / 10 : estimateDrivingDurationMin(distKm);
            matrix[loc1.key][loc2.key] = distKm;
            durations[loc1.key][loc2.key] = durMin;
            sources[loc1.key][loc2.key] = 'osm-table';
            osmTablePairs++;
            processedPairs++;
          }
        }
      }
    }
  }

  // TIER 2 & TIER 3: Fill any remaining or missing pairs
  const missingPairs: Array<{ i: number; j: number; loc1: LocationPoint; loc2: LocationPoint }> = [];

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const loc1 = locations[i];
      const loc2 = locations[j];

      if (loc1.key === loc2.key) {
        if (!matrix[loc1.key][loc2.key]) {
          matrix[loc1.key][loc2.key] = 0;
          durations[loc1.key][loc2.key] = 0;
          sources[loc1.key][loc2.key] = 'osm-table';
          processedPairs++;
        }
        continue;
      }

      if (matrix[loc1.key][loc2.key] === undefined) {
        missingPairs.push({ i, j, loc1, loc2 });
      }
    }
  }

  if (missingPairs.length > 0) {
    onProgress?.({
      percent: 50,
      step: `Tier 2 & 3: Resolving ${missingPairs.length} pending pairs via OSM Route API & Haversine...`,
      processedPairs,
      totalPairs,
      tierCounts: { osmTable: osmTablePairs, osmRoute: osmRoutePairs, haversine: haversinePairs },
    });

    // Try Route API with max concurrency of 3 to respect rate limits
    const BATCH_SIZE = 5;
    for (let k = 0; k < missingPairs.length; k += BATCH_SIZE) {
      const slice = missingPairs.slice(k, k + BATCH_SIZE);

      await Promise.all(
        slice.map(async ({ loc1, loc2 }) => {
          // Tier 2: Route API
          const routeRes = await fetchOsmRouteApiPair(loc1, loc2);

          if (routeRes.success && routeRes.distanceKm !== undefined) {
            matrix[loc1.key][loc2.key] = routeRes.distanceKm;
            durations[loc1.key][loc2.key] = routeRes.durationMin ?? estimateDrivingDurationMin(routeRes.distanceKm);
            sources[loc1.key][loc2.key] = 'osm-route';
            osmRoutePairs++;
          } else {
            // Tier 3: 1.3x Road Circuity Haversine Fallback
            const havDistKm = computeHaversineDistanceKm(loc1.lat, loc1.lon, loc2.lat, loc2.lon, true);
            const havDurMin = estimateDrivingDurationMin(havDistKm);
            matrix[loc1.key][loc2.key] = havDistKm;
            durations[loc1.key][loc2.key] = havDurMin;
            sources[loc1.key][loc2.key] = 'haversine';
            haversinePairs++;
          }
          processedPairs++;
        })
      );

      const currentPercent = Math.min(95, Math.round(50 + (k / missingPairs.length) * 45));
      onProgress?.({
        percent: currentPercent,
        step: `Resolving pairs (${processedPairs}/${totalPairs})...`,
        processedPairs,
        totalPairs,
        tierCounts: { osmTable: osmTablePairs, osmRoute: osmRoutePairs, haversine: haversinePairs },
      });
    }
  }

  const result: DistanceMatrixData = {
    locations,
    matrix,
    durations,
    sources,
    generatedAt: new Date().toISOString(),
    stats: {
      totalPairs,
      osmTablePairs,
      osmRoutePairs,
      haversinePairs,
      manualPairs: 0,
    },
  };

  saveDistanceMatrixToStorage(result);

  onProgress?.({
    percent: 100,
    step: `Distance Matrix generated successfully (${totalPairs} pairs)`,
    processedPairs: totalPairs,
    totalPairs,
    tierCounts: { osmTable: osmTablePairs, osmRoute: osmRoutePairs, haversine: haversinePairs },
  });

  return result;
}

/**
 * Saves distance matrix to local storage for persistent access across runs
 */
export function saveDistanceMatrixToStorage(data: DistanceMatrixData): void {
  try {
    localStorage.setItem(DISTANCE_MATRIX_STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('Could not persist distance matrix to localStorage:', err);
  }
}

/**
 * Loads distance matrix from local storage
 */
export function loadDistanceMatrixFromStorage(): DistanceMatrixData | null {
  try {
    const raw = localStorage.getItem(DISTANCE_MATRIX_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DistanceMatrixData;
  } catch (err) {
    return null;
  }
}

/**
 * Retrieves distance between two coordinate pairs from matrix or computes 1.3x Haversine fallback on the fly
 */
export function getDistanceBetweenPoints(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  cachedMatrix?: DistanceMatrixData | null
): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;

  const key1 = getLocationKey(lat1, lon1);
  const key2 = getLocationKey(lat2, lon2);

  if (cachedMatrix?.matrix?.[key1]?.[key2] !== undefined) {
    return cachedMatrix.matrix[key1][key2];
  }

  // Fallback to Haversine with 1.3x road circuity
  return computeHaversineDistanceKm(lat1, lon1, lat2, lon2, true);
}

/**
 * Exports distance matrix to a structured Excel (.xlsx) file
 */
export function exportDistanceMatrixToExcel(data: DistanceMatrixData, filename = 'distanceMatrix.xlsx'): void {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Matrix Grid (from x to distance in km)
  const headerRow = ['Origin \\ Destination', ...data.locations.map((l) => `${l.name} (${l.key})`)];
  const gridRows: any[][] = [headerRow];

  for (const origin of data.locations) {
    const row: any[] = [`${origin.name} (${origin.key})`];
    for (const dest of data.locations) {
      const dist = data.matrix[origin.key]?.[dest.key] ?? 0;
      row.push(dist);
    }
    gridRows.push(row);
  }

  const wsGrid = XLSX.utils.aoa_to_sheet(gridRows);
  XLSX.utils.book_append_sheet(wb, wsGrid, 'Distance Matrix (km)');

  // Sheet 2: Tabular List of All Pairs with Source Tier and Duration
  const pairsList: any[] = [];
  for (const origin of data.locations) {
    for (const dest of data.locations) {
      const dist = data.matrix[origin.key]?.[dest.key] ?? 0;
      const dur = data.durations[origin.key]?.[dest.key] ?? 0;
      const src = data.sources[origin.key]?.[dest.key] ?? 'haversine';
      pairsList.push({
        'From Location': origin.name,
        'From Coordinates': origin.key,
        'From Lat': origin.lat,
        'From Lon': origin.lon,
        'To Location': dest.name,
        'To Coordinates': dest.key,
        'To Lat': dest.lat,
        'To Lon': dest.lon,
        'Distance (km)': dist,
        'Est. Duration (min)': dur,
        'Calculation Tier': src === 'osm-table' ? 'Tier 1 (OSM Table API)' : src === 'osm-route' ? 'Tier 2 (OSM Route API)' : src === 'manual' ? 'Manual Override' : 'Tier 3 (1.3x Haversine Fallback)',
      });
    }
  }

  const wsPairs = XLSX.utils.json_to_sheet(pairsList);
  XLSX.utils.book_append_sheet(wb, wsPairs, 'Pairwise Distances');

  // Sheet 3: Metadata & Summary Stats
  const metaData = [
    { Property: 'Generated At', Value: data.generatedAt },
    { Property: 'Total Unique Locations', Value: data.locations.length },
    { Property: 'Total Distance Pairs Evaluated', Value: data.stats.totalPairs },
    { Property: 'Tier 1 (OSM Table API) Pairs', Value: data.stats.osmTablePairs },
    { Property: 'Tier 2 (OSM Route API) Pairs', Value: data.stats.osmRoutePairs },
    { Property: 'Tier 3 (1.3x Haversine Fallback) Pairs', Value: data.stats.haversinePairs },
    { Property: 'Road Circuity Factor', Value: '1.3x' },
  ];
  const wsMeta = XLSX.utils.json_to_sheet(metaData);
  XLSX.utils.book_append_sheet(wb, wsMeta, 'Metadata & Stats');

  XLSX.writeFile(wb, filename);
}

/**
 * Exports distance matrix to JSON structured file
 */
export function exportDistanceMatrixToJson(data: DistanceMatrixData, filename = 'distanceMatrix.json'): void {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
