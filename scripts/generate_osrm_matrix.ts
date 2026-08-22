/**
 * ==============================================================================================
 * LOCAL OSRM DISTANCE MATRIX GENERATOR SCRIPT
 * ==============================================================================================
 * 
 * DESCRIPTION:
 * Reads a Sales Register (Excel/CSV) or location list, extracts unique destination coordinates (lon, lat),
 * constructs all coordinates in OSRM Table format, and queries your local OSRM instance:
 * 
 * URL pattern:
 * http://localhost:5001/table/v1/driving/{lon1},{lat1};{lon2},{lat2};...;{lonN},{latN}?annotations=distance,duration&sources={i}
 * 
 * It rotates the source index `sources=0` to `sources=n-1` to calculate the full NxN distance matrix,
 * then generates an Excel file formatted with 'Pairwise Distances' and 'Distance Matrix (km)' sheets,
 * which can be directly uploaded into the web app's "Upload Distance Matrix" feature!
 * 
 * ----------------------------------------------------------------------------------------------
 * HOW TO EXECUTE THIS SCRIPT:
 * ----------------------------------------------------------------------------------------------
 * 
 * Prerequisites:
 * 1. Node.js (v18 or higher installed).
 * 2. Local OSRM server running (default: http://localhost:5001).
 * 
 * Execution Syntax:
 * 
 * Option A (Using npx tsx directly - RECOMMENDED):
 *   npx tsx scripts/generate_osrm_matrix.ts <path-to-sales-register.xlsx> [output-matrix.xlsx] [osrm-url]
 * 
 * Option B (Using node if compiled):
 *   node scripts/generate_osrm_matrix.mjs <path-to-sales-register.xlsx>
 * 
 * Examples:
 *   npx tsx scripts/generate_osrm_matrix.ts ./sales_register.xlsx
 *   npx tsx scripts/generate_osrm_matrix.ts ./sales_register.xlsx ./my_distance_matrix.xlsx
 *   npx tsx scripts/generate_osrm_matrix.ts ./sales_register.xlsx ./my_distance_matrix.xlsx http://localhost:5001
 * 
 * ==============================================================================================
 */

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

interface LocationPoint {
  key: string;
  name: string;
  lat: number;
  lon: number;
}

// Helper to normalize location key
function getLocationKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

// Fallback Haversine formula with 1.3x road circuity factor
function computeHaversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightDist = R * c;
  return straightDist * 1.3; // 1.3x circuity factor
}

// Read and parse input file (Excel or CSV)
function parseLocationsFromInput(filePath: string): LocationPoint[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input file not found at path: ${filePath}`);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  if (!rows || rows.length === 0) {
    throw new Error(`No data rows found in sheet "${sheetName}".`);
  }

  const locationMap = new Map<string, LocationPoint>();

  for (const row of rows) {
    // Find Lat & Lon columns
    const latKeys = ['Destination Lat', 'Dest Lat', 'Latitude', 'Lat', 'lat', 'LAT', 'From Lat', 'To Lat'];
    const lonKeys = ['Destination Long', 'Dest Lon', 'Longitude', 'Long', 'Lon', 'lon', 'LON', 'From Lon', 'To Lon'];
    const nameKeys = ['Destination Name', 'Destination', 'Dest', 'City', 'Location', 'Dealer Name', 'From Location', 'To Location'];

    let rawLat: any = undefined;
    let rawLon: any = undefined;
    let name: string = '';

    for (const k of latKeys) {
      if (row[k] !== undefined && row[k] !== '') {
        rawLat = row[k];
        break;
      }
    }
    for (const k of lonKeys) {
      if (row[k] !== undefined && row[k] !== '') {
        rawLon = row[k];
        break;
      }
    }
    for (const k of nameKeys) {
      if (row[k] !== undefined && row[k] !== '') {
        name = String(row[k]).trim();
        break;
      }
    }

    const lat = parseFloat(String(rawLat));
    const lon = parseFloat(String(rawLon));

    if (!isNaN(lat) && !isNaN(lon)) {
      const key = getLocationKey(lat, lon);
      if (!locationMap.has(key)) {
        locationMap.set(key, {
          key,
          name: name || `Loc (${lat.toFixed(3)}, ${lon.toFixed(3)})`,
          lat,
          lon,
        });
      }
    }
  }

  return Array.from(locationMap.values());
}

// Call local OSRM instance
async function queryLocalOSRM(
  osrmBaseUrl: string,
  locations: LocationPoint[],
  sourceIndex: number
): Promise<{ distances: number[]; durations: number[]; isSuccess: boolean }> {
  // Format coordinate string: lon1,lat1;lon2,lat2;...;lonN,latN
  const coordsParam = locations.map((loc) => `${loc.lon},${loc.lat}`).join(';');
  const cleanBase = osrmBaseUrl.replace(/\/+$/, '');
  const url = `${cleanBase}/table/v1/driving/${coordsParam}?annotations=distance,duration&sources=${sourceIndex}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: any = await response.json();
    if (data.code === 'Ok' && data.distances && data.distances[0]) {
      // OSRM returns distances in meters and durations in seconds
      const rowMeters: (number | null)[] = data.distances[0];
      const rowSeconds: (number | null)[] = (data.durations && data.durations[0]) ? data.durations[0] : [];

      const distancesKm = rowMeters.map((m, idx) => {
        if (m === null || m === undefined || isNaN(m)) {
          // Haversine fallback for unreachable single pair
          const orig = locations[sourceIndex];
          const dest = locations[idx];
          return Math.round(computeHaversineDistanceKm(orig.lat, orig.lon, dest.lat, dest.lon) * 100) / 100;
        }
        return Math.round((m / 1000) * 100) / 100;
      });

      const durationsMin = rowSeconds.map((s, idx) => {
        if (s === null || s === undefined || isNaN(s)) {
          return Math.round((distancesKm[idx] / 40) * 60);
        }
        return Math.round((s / 60) * 10) / 10;
      });

      return { distances: distancesKm, durations: durationsMin, isSuccess: true };
    } else {
      throw new Error(`OSRM code: ${data.code || 'Unknown'}`);
    }
  } catch (err: any) {
    // Return fallback computed via Haversine
    const origin = locations[sourceIndex];
    const distancesKm = locations.map((dest) =>
      Math.round(computeHaversineDistanceKm(origin.lat, origin.lon, dest.lat, dest.lon) * 100) / 100
    );
    const durationsMin = distancesKm.map((d) => Math.round((d / 40) * 60));
    return { distances: distancesKm, durations: durationsMin, isSuccess: false };
  }
}

// Main execution function
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
==================================================================================
LOCAL OSRM DISTANCE MATRIX GENERATOR
==================================================================================
Usage:
  npx tsx scripts/generate_osrm_matrix.ts <inputFile> [outputFile] [osrmBaseUrl]

Arguments:
  <inputFile>    : Path to Sales Register Excel (.xlsx, .xls) or CSV
  [outputFile]   : Optional output file path (default: ./distanceMatrix_OSRM.xlsx)
  [osrmBaseUrl]  : Optional OSRM Server URL (default: http://localhost:5001)

Examples:
  npx tsx scripts/generate_osrm_matrix.ts sales_register.xlsx
  npx tsx scripts/generate_osrm_matrix.ts sales_register.xlsx my_matrix.xlsx http://localhost:5001
==================================================================================
`);
    process.exit(0);
  }

  const inputFilePath = path.resolve(process.cwd(), args[0]);
  const outputFilePath = args[1]
    ? path.resolve(process.cwd(), args[1])
    : path.resolve(process.cwd(), 'distanceMatrix_OSRM.xlsx');
  const osrmBaseUrl = args[2] || 'http://localhost:5001';

  console.log(`\n==================================================================================`);
  console.log(`🚀 STARTING LOCAL OSRM DISTANCE MATRIX GENERATION`);
  console.log(`==================================================================================`);
  console.log(`📁 Input file   : ${inputFilePath}`);
  console.log(`💾 Output file  : ${outputFilePath}`);
  console.log(`🌐 OSRM Endpoint: ${osrmBaseUrl}`);
  console.log(`==================================================================================\n`);

  // Step 1: Extract Unique Locations
  console.log(`⏳ [1/4] Reading input file and extracting unique coordinates...`);
  const locations = parseLocationsFromInput(inputFilePath);
  const n = locations.length;
  console.log(`✅ Found ${n} unique destination locations (${n * n} pairwise road combinations).\n`);

  if (n === 0) {
    console.error(`❌ Error: No valid coordinates found in ${inputFilePath}.`);
    process.exit(1);
  }

  // Step 2: Query Local OSRM for Each Source index 0 to n-1
  console.log(`⏳ [2/4] Querying local OSRM table endpoint rotating sources 0 to ${n - 1}...`);
  const matrix: Record<string, Record<string, number>> = {};
  const durations: Record<string, Record<string, number>> = {};
  const sourcesTier: Record<string, Record<string, string>> = {};

  let osrmSuccessCount = 0;
  let haversineFallbackCount = 0;

  for (let i = 0; i < n; i++) {
    const origin = locations[i];
    process.stdout.write(`  ▶ [${i + 1}/${n}] Querying source index ${i}: ${origin.name} (${origin.lon}, ${origin.lat})... `);

    const result = await queryLocalOSRM(osrmBaseUrl, locations, i);

    if (!matrix[origin.key]) matrix[origin.key] = {};
    if (!durations[origin.key]) durations[origin.key] = {};
    if (!sourcesTier[origin.key]) sourcesTier[origin.key] = {};

    for (let j = 0; j < n; j++) {
      const dest = locations[j];
      const dist = origin.key === dest.key ? 0 : result.distances[j];
      const dur = origin.key === dest.key ? 0 : result.durations[j];

      matrix[origin.key][dest.key] = dist;
      durations[origin.key][dest.key] = dur;
      sourcesTier[origin.key][dest.key] = result.isSuccess
        ? (origin.key === dest.key ? 'Exact Same Location' : 'Local OSRM Engine (http://localhost:5001)')
        : 'Haversine 1.3x Fallback';
    }

    if (result.isSuccess) {
      osrmSuccessCount++;
      console.log(`✅ OK (Local OSRM)`);
    } else {
      haversineFallbackCount++;
      console.log(`⚠️ Failed to reach OSRM - used Haversine 1.3x fallback`);
    }
  }

  console.log(`\n==================================================================================`);
  console.log(`📊 OSRM QUERY SUMMARY:`);
  console.log(`  - Total Source Queries  : ${n}`);
  console.log(`  - OSRM Successful Rows  : ${osrmSuccessCount}`);
  console.log(`  - Fallback Rows (Offline): ${haversineFallbackCount}`);
  console.log(`==================================================================================\n`);

  // Step 3: Format Data for Excel
  console.log(`⏳ [3/4] Formatting Excel workbook with Pairwise Distances & Matrix Grid...`);
  const wb = XLSX.utils.book_new();

  // Sheet 1: Pairwise Distances List
  const pairwiseRows: any[] = [];
  for (let i = 0; i < n; i++) {
    const origin = locations[i];
    for (let j = 0; j < n; j++) {
      const dest = locations[j];
      pairwiseRows.push({
        'From Location': origin.name,
        'From Coordinates': origin.key,
        'From Lat': origin.lat,
        'From Lon': origin.lon,
        'To Location': dest.name,
        'To Coordinates': dest.key,
        'To Lat': dest.lat,
        'To Lon': dest.lon,
        'Distance (km)': matrix[origin.key][dest.key],
        'Est. Duration (min)': durations[origin.key][dest.key],
        'Calculation Tier': sourcesTier[origin.key][dest.key],
      });
    }
  }
  const wsPairwise = XLSX.utils.json_to_sheet(pairwiseRows);
  XLSX.utils.book_append_sheet(wb, wsPairwise, 'Pairwise Distances');

  // Sheet 2: Distance Matrix Grid (N x N)
  const headerRow = ['Origin \\ Destination', ...locations.map((l) => `${l.name} (${l.key})`)];
  const gridRows: any[][] = [headerRow];

  for (let i = 0; i < n; i++) {
    const origin = locations[i];
    const row: any[] = [`${origin.name} (${origin.key})`];
    for (let j = 0; j < n; j++) {
      const dest = locations[j];
      row.push(matrix[origin.key][dest.key]);
    }
    gridRows.push(row);
  }
  const wsGrid = XLSX.utils.aoa_to_sheet(gridRows);
  XLSX.utils.book_append_sheet(wb, wsGrid, 'Distance Matrix (km)');

  // Sheet 3: Locations Reference
  const locRows = locations.map((loc, idx) => ({
    'Index (Source ID)': idx,
    'Location Name': loc.name,
    'Coordinates': loc.key,
    'Latitude': loc.lat,
    'Longitude': loc.lon,
  }));
  const wsLocs = XLSX.utils.json_to_sheet(locRows);
  XLSX.utils.book_append_sheet(wb, wsLocs, 'Unique Locations');

  // Step 4: Write to Disk
  console.log(`⏳ [4/4] Writing output to ${outputFilePath}...`);
  XLSX.writeFile(wb, outputFilePath);

  console.log(`\n🎉 SUCCESS! Distance matrix generated successfully.`);
  console.log(`📄 Saved file: ${outputFilePath}`);
  console.log(`💡 You can now open the web app, go to "Script 1: Distance Matrix Engine", and click "Upload Distance Matrix" to load this file directly!\n`);
}

main().catch((err) => {
  console.error(`\n❌ Fatal Execution Error:`, err);
  process.exit(1);
});
