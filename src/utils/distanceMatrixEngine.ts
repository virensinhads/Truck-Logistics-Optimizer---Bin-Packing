import { DistanceMatrixData, LocationPoint, DistanceMatrixEntry } from '../types';
import { computeHaversineDistanceKm, estimateDrivingDurationMin } from './haversine';
import * as XLSX from 'xlsx';

export const DEFAULT_OSRM_URL = 'https://specializing-marvel-configuration-but.trycloudflare.com';
export const FALLBACK_PUBLIC_OSM_URL = 'https://routing.openstreetmap.de/routed-car';

// Local storage keys for persisting distance matrix and custom OSRM endpoint
export const DISTANCE_MATRIX_STORAGE_KEY = 'LOGISTICS_DISTANCE_MATRIX_CACHE';
export const OSRM_URL_STORAGE_KEY = 'LOGISTICS_OSRM_BASE_URL';

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

export interface OsrmSourceQueryResult {
  distances: number[];
  durations: number[];
  isSuccess: boolean;
  tier: 'osrm-table' | 'osm-table' | 'haversine';
  queriedUrl: string;
  errorMessage?: string;
}

/**
 * Queries OSRM /table/v1/driving/ endpoint for a specific source index (sources={i})
 * Format: {osrmBaseUrl}/table/v1/driving/{lon1},{lat1};{lon2},{lat2};...?annotations=distance,duration&sources={sourceIndex}
 * Following the exact methodology of scripts/generate_osrm_matrix.ts
 */
export async function queryOsrmTableForSource(
  osrmBaseUrl: string,
  locations: LocationPoint[],
  sourceIndex: number,
  timeoutMs = 8000
): Promise<OsrmSourceQueryResult> {
  const coordsParam = locations.map((loc) => `${loc.lon},${loc.lat}`).join(';');
  const cleanBase = (osrmBaseUrl || DEFAULT_OSRM_URL).replace(/\/+$/, '');
  const url = `${cleanBase}/table/v1/driving/${coordsParam}?annotations=distance,duration&sources=${sourceIndex}`;

  const origin = locations[sourceIndex];

  // Helper for single row fallback
  const getFallbackRow = (tier: 'osm-table' | 'haversine' = 'haversine') => {
    const distances = locations.map((dest) => {
      if (origin.key === dest.key) return 0;
      return Math.round(computeHaversineDistanceKm(origin.lat, origin.lon, dest.lat, dest.lon, true) * 100) / 100;
    });
    const durations = distances.map((d) => estimateDrivingDurationMin(d));
    return { distances, durations, isSuccess: false, tier, queriedUrl: url };
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data: any = await res.json();
    if (data.code === 'Ok' && Array.isArray(data.distances) && data.distances[0]) {
      const rowMeters: (number | null)[] = data.distances[0];
      const rowSeconds: (number | null)[] = data.durations && data.durations[0] ? data.durations[0] : [];

      const distancesKm = rowMeters.map((m, idx) => {
        if (m === null || m === undefined || isNaN(m) || m < 0) {
          const dest = locations[idx];
          if (origin.key === dest.key) return 0;
          return Math.round(computeHaversineDistanceKm(origin.lat, origin.lon, dest.lat, dest.lon, true) * 100) / 100;
        }
        return Math.round((m / 1000) * 100) / 100;
      });

      const durationsMin = rowSeconds.map((s, idx) => {
        if (s === null || s === undefined || isNaN(s) || s < 0) {
          return estimateDrivingDurationMin(distancesKm[idx]);
        }
        return Math.round((s / 60) * 10) / 10;
      });

      const isCustomOsrm = !cleanBase.includes('openstreetmap.de');
      return {
        distances: distancesKm,
        durations: durationsMin,
        isSuccess: true,
        tier: isCustomOsrm ? 'osrm-table' : 'osm-table',
        queriedUrl: url,
      };
    } else {
      throw new Error(`OSRM response code: ${data.code || 'Unknown'}`);
    }
  } catch (err: any) {
    // If custom OSRM fails (e.g. CORS/mixed-content from browser), try public OSM endpoint as bridge fallback
    if (!cleanBase.includes('openstreetmap.de')) {
      try {
        const publicUrl = `${FALLBACK_PUBLIC_OSM_URL}/table/v1/driving/${coordsParam}?annotations=distance,duration&sources=${sourceIndex}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const pubRes = await fetch(publicUrl, { signal: controller.signal, headers: { Accept: 'application/json' } });
        clearTimeout(timer);

        if (pubRes.ok) {
          const pubData = await pubRes.json();
          if (pubData.code === 'Ok' && Array.isArray(pubData.distances) && pubData.distances[0]) {
            const rowM = pubData.distances[0];
            const rowS = pubData.durations?.[0] || [];
            const distancesKm = rowM.map((m: any, idx: number) => {
              if (m == null || isNaN(m)) {
                const dest = locations[idx];
                return Math.round(computeHaversineDistanceKm(origin.lat, origin.lon, dest.lat, dest.lon, true) * 100) / 100;
              }
              return Math.round((m / 1000) * 100) / 100;
            });
            const durationsMin = rowS.map((s: any, idx: number) => {
              if (s == null || isNaN(s)) return estimateDrivingDurationMin(distancesKm[idx]);
              return Math.round((s / 60) * 10) / 10;
            });
            return {
              distances: distancesKm,
              durations: durationsMin,
              isSuccess: true,
              tier: 'osm-table',
              queriedUrl: publicUrl,
            };
          }
        }
      } catch (pubErr) {
        // Fall through to Haversine
      }
    }

    // Infallible 1.3x Haversine fallback
    return {
      ...getFallbackRow('haversine'),
      errorMessage: err?.message || 'Connection failed',
    };
  }
}

// In-memory cache for fetched pairwise road route segments by coordinate key string
const singleLegRoadGeometryCache = new Map<string, {
  coordinates: [number, number][];
  distanceKm: number;
  durationMin: number;
  source: 'osrm-road' | 'fallback';
}>();

/**
 * Fetches actual road network route geometry for a single leg between 2 points (from -> to)
 */
export async function fetchSingleLegRoadGeometry(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  baseUrl?: string,
  timeoutMs = 7000
): Promise<{ coordinates: [number, number][]; distanceKm: number; durationMin: number; source: 'osrm-road' | 'fallback' }> {
  const cacheKey = `${from.lat.toFixed(6)},${from.lon.toFixed(6)}->${to.lat.toFixed(6)},${to.lon.toFixed(6)}`;
  const cached = singleLegRoadGeometryCache.get(cacheKey);
  if (cached) return cached;

  const activeBase = (baseUrl || loadOsrmBaseUrlFromStorage() || DEFAULT_OSRM_URL).trim().replace(/\/+$/, '');
  const coordsParam = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const primaryUrl = `${activeBase}/route/v1/driving/${coordsParam}?overview=full&geometries=geojson`;

  // 1. Try Primary OSRM Endpoint
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(primaryUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    if (res.ok) {
      const data: any = await res.json();
      if (data.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
        const rawCoords: [number, number][] = data.routes[0].geometry.coordinates;
        const result = {
          coordinates: rawCoords.map(([lon, lat]) => [lat, lon] as [number, number]),
          distanceKm: Math.round(((data.routes[0].distance || 0) / 1000) * 100) / 100,
          durationMin: Math.round(((data.routes[0].duration || 0) / 60) * 10) / 10,
          source: 'osrm-road' as const,
        };
        singleLegRoadGeometryCache.set(cacheKey, result);
        return result;
      }
    }
  } catch {
    // Primary failed, continue to fallback
  }

  // 2. Try Public OSRM router fallback if different from primary
  if (!activeBase.includes('project-osrm.org')) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const publicUrl = `https://router.project-osrm.org/route/v1/driving/${coordsParam}?overview=full&geometries=geojson`;
      const pubRes = await fetch(publicUrl, { signal: controller.signal, headers: { Accept: 'application/json' } });
      clearTimeout(timer);

      if (pubRes.ok) {
        const pubData: any = await pubRes.json();
        if (pubData.code === 'Ok' && pubData.routes?.[0]?.geometry?.coordinates) {
          const rawCoords: [number, number][] = pubData.routes[0].geometry.coordinates;
          const result = {
            coordinates: rawCoords.map(([lon, lat]) => [lat, lon] as [number, number]),
            distanceKm: Math.round(((pubData.routes[0].distance || 0) / 1000) * 100) / 100,
            durationMin: Math.round(((pubData.routes[0].duration || 0) / 60) * 10) / 10,
            source: 'osrm-road' as const,
          };
          singleLegRoadGeometryCache.set(cacheKey, result);
          return result;
        }
      }
    } catch {
      // Fallback failed
    }
  }

  // 3. Fallback straight line
  const dKm = computeHaversineDistanceKm(from.lat, from.lon, to.lat, to.lon);
  const fallbackResult = {
    coordinates: [
      [from.lat, from.lon] as [number, number],
      [to.lat, to.lon] as [number, number],
    ],
    distanceKm: Math.round(dKm * 100) / 100,
    durationMin: Math.round(((dKm / 40) * 60) * 10) / 10,
    source: 'fallback' as const,
  };
  singleLegRoadGeometryCache.set(cacheKey, fallbackResult);
  return fallbackResult;
}

export interface RouteLegDetail {
  fromIndex: number;
  toIndex: number;
  fromDest?: string;
  toDest?: string;
  coordinates: [number, number][];
  distanceKm: number;
  durationMin: number;
  source: 'osrm-road' | 'fallback';
}

/**
 * Fetches actual road network route geometry for a multi-stop sequence.
 * Rather than clubbing all points into a single multi-waypoint request (which can produce unwanted U-turns/detours),
 * this executes N-1 pairwise point-to-point road queries (Leg 1: S1->S2, Leg 2: S2->S3, ...) in parallel,
 * resulting in optimal path accuracy matching direct point-to-point navigation.
 */
export async function fetchRoadRouteGeometry(
  stops: { lat: number; lon: number; dest?: string }[],
  baseUrl?: string,
  timeoutMs = 8000
): Promise<{
  coordinates: [number, number][];
  distanceKm: number;
  durationMin: number;
  source: 'osrm-road' | 'fallback';
  legs: RouteLegDetail[];
} | null> {
  if (!stops || stops.length < 2) return null;

  // Build N - 1 pairwise leg promises
  const legPromises: Promise<RouteLegDetail>[] = [];

  for (let i = 0; i < stops.length - 1; i++) {
    const fromStop = stops[i];
    const toStop = stops[i + 1];

    legPromises.push(
      fetchSingleLegRoadGeometry(fromStop, toStop, baseUrl, timeoutMs).then((res) => ({
        fromIndex: i + 1,
        toIndex: i + 2,
        fromDest: fromStop.dest,
        toDest: toStop.dest,
        coordinates: res.coordinates,
        distanceKm: res.distanceKm,
        durationMin: res.durationMin,
        source: res.source,
      }))
    );
  }

  const legs = await Promise.all(legPromises);

  // Merge coordinates without duplicate boundary vertices
  const combinedCoordinates: [number, number][] = [];
  let totalDistanceKm = 0;
  let totalDurationMin = 0;
  let hasRoadSource = false;

  legs.forEach((leg, idx) => {
    totalDistanceKm += leg.distanceKm;
    totalDurationMin += leg.durationMin;
    if (leg.source === 'osrm-road') hasRoadSource = true;

    if (idx === 0) {
      combinedCoordinates.push(...leg.coordinates);
    } else {
      // Avoid duplicating the junction point
      if (leg.coordinates.length > 1) {
        combinedCoordinates.push(...leg.coordinates.slice(1));
      } else {
        combinedCoordinates.push(...leg.coordinates);
      }
    }
  });

  return {
    coordinates: combinedCoordinates,
    distanceKm: Math.round(totalDistanceKm * 100) / 100,
    durationMin: Math.round(totalDurationMin * 10) / 10,
    source: hasRoadSource ? 'osrm-road' : 'fallback',
    legs,
  };
}

/**
 * Tests connection to a given OSRM base URL using a sample 2-point driving table query
 */
export async function testOsrmEndpoint(
  baseUrl: string,
  timeoutMs = 6000
): Promise<{ success: boolean; message: string; latencyMs?: number; code?: string }> {
  const cleanBase = (baseUrl || DEFAULT_OSRM_URL).trim().replace(/\/+$/, '');
  const testUrl = `${cleanBase}/table/v1/driving/92.2072,23.946;92.74221,24.689?annotations=distance,duration&sources=0`;
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(testUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return {
        success: false,
        message: `HTTP ${res.status}: ${res.statusText}`,
        latencyMs,
      };
    }

    const data: any = await res.json();
    if (data.code === 'Ok' && Array.isArray(data.distances) && data.distances.length > 0) {
      return {
        success: true,
        message: `Connected successfully (${latencyMs}ms)! OSRM Table API is active and responsive.`,
        latencyMs,
        code: data.code,
      };
    }

    return {
      success: false,
      message: `OSRM returned code: "${data.code || 'Unknown'}"`,
      latencyMs,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    if (err.name === 'AbortError') {
      return {
        success: false,
        message: `Connection timed out after ${timeoutMs / 1000}s. Check if server is running and reachable.`,
        latencyMs,
      };
    }
    return {
      success: false,
      message: err.message || 'Connection failed. Check network, protocol (http vs https), or CORS.',
      latencyMs,
    };
  }
}

export type MatrixProgressCallback = (progress: {
  percent: number;
  step: string;
  processedPairs: number;
  totalPairs: number;
  currentSourceIndex: number;
  totalSources: number;
  currentSourceLocation?: LocationPoint;
  currentUrl?: string;
  tierCounts: { osrmTable: number; osmTable: number; osmRoute: number; haversine: number };
}) => void;

export interface GenerateDistanceMatrixOptions {
  osrmBaseUrl?: string;
  onProgress?: MatrixProgressCallback;
}

/**
 * Script 1: OSRM Distance Matrix Engine (Matching scripts/generate_osrm_matrix.ts)
 * 
 * Iterates through all unique locations rotating source index `sources=0` to `sources=N-1`:
 * URL Pattern:
 * {osrmBaseUrl}/table/v1/driving/{lon1},{lat1};{lon2},{lat2};...;{lonN},{latN}?annotations=distance,duration&sources={i}
 * 
 * Sample URL:
 * http://192.168.157.174:5001/table/v1/driving/92.2072,23.946;92.74221,24.689?annotations=distance,duration&sources=0
 */
export async function generateDistanceMatrix(
  locations: LocationPoint[],
  optionsOrProgress?: GenerateDistanceMatrixOptions | MatrixProgressCallback
): Promise<DistanceMatrixData> {
  const options: GenerateDistanceMatrixOptions =
    typeof optionsOrProgress === 'function'
      ? { onProgress: optionsOrProgress }
      : optionsOrProgress || {};

  const osrmBaseUrl = options.osrmBaseUrl || loadOsrmBaseUrlFromStorage() || DEFAULT_OSRM_URL;
  const onProgress = options.onProgress;

  const n = locations.length;
  const totalPairs = n * n;

  const matrix: Record<string, Record<string, number>> = {};
  const durations: Record<string, Record<string, number>> = {};
  const sources: Record<string, Record<string, 'osrm-table' | 'osm-table' | 'osm-route' | 'haversine' | 'manual'>> = {};

  // Initialize data structures
  for (const loc1 of locations) {
    matrix[loc1.key] = {};
    durations[loc1.key] = {};
    sources[loc1.key] = {};
    for (const loc2 of locations) {
      if (loc1.key === loc2.key) {
        matrix[loc1.key][loc2.key] = 0;
        durations[loc1.key][loc2.key] = 0;
        sources[loc1.key][loc2.key] = 'osrm-table';
      }
    }
  }

  let osrmTablePairs = 0;
  let osmTablePairs = 0;
  let osmRoutePairs = 0;
  let haversinePairs = 0;
  let processedPairs = 0;

  // Handle empty or single location
  if (n <= 1) {
    const result: DistanceMatrixData = {
      locations,
      matrix,
      durations,
      sources,
      generatedAt: new Date().toISOString(),
      stats: {
        totalPairs,
        osrmTablePairs: n,
        osmTablePairs: 0,
        osmRoutePairs: 0,
        haversinePairs: 0,
        manualPairs: 0,
      },
    };
    saveDistanceMatrixToStorage(result);
    return result;
  }

  onProgress?.({
    percent: 5,
    step: `Initializing OSRM Matrix Engine for ${n} locations (${totalPairs} road pairs)...`,
    processedPairs: 0,
    totalPairs,
    currentSourceIndex: 0,
    totalSources: n,
    currentSourceLocation: locations[0],
    currentUrl: `${osrmBaseUrl}/table/v1/driving/...&sources=0`,
    tierCounts: { osrmTable: 0, osmTable: 0, osmRoute: 0, haversine: 0 },
  });

  // Evaluate each of the sources N times (sources=0 to sources=N-1)
  for (let i = 0; i < n; i++) {
    const origin = locations[i];
    const currentPercent = Math.round(((i) / n) * 90) + 5;

    onProgress?.({
      percent: currentPercent,
      step: `Evaluating source ${i + 1}/${n}: ${origin.name} (${origin.lon}, ${origin.lat})...`,
      processedPairs,
      totalPairs,
      currentSourceIndex: i,
      totalSources: n,
      currentSourceLocation: origin,
      currentUrl: `${osrmBaseUrl}/table/v1/driving/...&sources=${i}`,
      tierCounts: { osrmTable: osrmTablePairs, osmTable: osmTablePairs, osmRoute: osmRoutePairs, haversine: haversinePairs },
    });

    const result = await queryOsrmTableForSource(osrmBaseUrl, locations, i);

    for (let j = 0; j < n; j++) {
      const dest = locations[j];
      const dist = origin.key === dest.key ? 0 : result.distances[j];
      const dur = origin.key === dest.key ? 0 : result.durations[j];

      matrix[origin.key][dest.key] = dist;
      durations[origin.key][dest.key] = dur;

      if (origin.key === dest.key) {
        sources[origin.key][dest.key] = result.tier;
      } else {
        sources[origin.key][dest.key] = result.tier;
      }

      if (result.tier === 'osrm-table') {
        osrmTablePairs++;
      } else if (result.tier === 'osm-table') {
        osmTablePairs++;
      } else {
        haversinePairs++;
      }
      processedPairs++;
    }

    onProgress?.({
      percent: Math.round(((i + 1) / n) * 95),
      step: `Processed source ${i + 1}/${n} [${result.tier.toUpperCase()}] (${processedPairs}/${totalPairs} pairs completed)`,
      processedPairs,
      totalPairs,
      currentSourceIndex: i + 1,
      totalSources: n,
      currentSourceLocation: origin,
      currentUrl: result.queriedUrl,
      tierCounts: { osrmTable: osrmTablePairs, osmTable: osmTablePairs, osmRoute: osmRoutePairs, haversine: haversinePairs },
    });
  }

  const result: DistanceMatrixData = {
    locations,
    matrix,
    durations,
    sources,
    generatedAt: new Date().toISOString(),
    stats: {
      totalPairs,
      osrmTablePairs,
      osmTablePairs,
      osmRoutePairs,
      haversinePairs,
      manualPairs: 0,
    },
  };

  saveDistanceMatrixToStorage(result);

  onProgress?.({
    percent: 100,
    step: `Distance Matrix generated successfully for ${n} locations (${totalPairs} pairs)`,
    processedPairs: totalPairs,
    totalPairs,
    currentSourceIndex: n,
    totalSources: n,
    tierCounts: { osrmTable: osrmTablePairs, osmTable: osmTablePairs, osmRoute: osmRoutePairs, haversine: haversinePairs },
  });

  return result;
}

/**
 * Saves OSRM base URL to local storage
 */
export function saveOsrmBaseUrlToStorage(url: string): void {
  try {
    localStorage.setItem(OSRM_URL_STORAGE_KEY, url);
  } catch (err) {
    console.warn('Could not persist OSRM base URL:', err);
  }
}

/**
 * Loads OSRM base URL from local storage
 */
export function loadOsrmBaseUrlFromStorage(): string | null {
  try {
    return localStorage.getItem(OSRM_URL_STORAGE_KEY);
  } catch (err) {
    return null;
  }
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
        'Calculation Tier':
          src === 'osrm-table'
            ? 'Tier 1 (OSRM Table Engine)'
            : src === 'osm-table'
            ? 'Tier 1 (Public OSM Table API)'
            : src === 'osm-route'
            ? 'Tier 2 (OSM Route API)'
            : src === 'manual'
            ? 'Manual Override / Upload'
            : 'Tier 3 (1.3x Haversine Fallback)',
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
    { Property: 'OSRM Table Engine Pairs', Value: data.stats.osrmTablePairs ?? 0 },
    { Property: 'Public OSM Table Pairs', Value: data.stats.osmTablePairs },
    { Property: 'OSM Route API Pairs', Value: data.stats.osmRoutePairs },
    { Property: '1.3x Haversine Fallback Pairs', Value: data.stats.haversinePairs },
    { Property: 'User Manual / Uploaded Pairs', Value: data.stats.manualPairs ?? 0 },
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
