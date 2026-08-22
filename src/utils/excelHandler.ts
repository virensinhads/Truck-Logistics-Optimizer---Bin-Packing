import * as XLSX from 'xlsx';
import { OrderLineItem, OptimizationResult, DistanceMatrixData, LocationPoint } from '../types';
import { SAMPLE_SALES_REGISTER_ORDERS } from './sampleData';
import { getLocationKey, saveDistanceMatrixToStorage } from './distanceMatrixEngine';
import { computeHaversineDistanceKm } from './haversine';

/**
 * Normalizes column keys to match PRD expectations regardless of minor typos or whitespace variations
 */
function findColumnValue(row: Record<string, any>, possibleKeys: string[]): any {
  const rowKeys = Object.keys(row);
  for (const targetKey of possibleKeys) {
    const directVal = row[targetKey];
    if (directVal !== undefined && directVal !== null && directVal !== '') {
      return directVal;
    }
  }

  // Case-insensitive & trimmed search
  for (const targetKey of possibleKeys) {
    const cleanTarget = targetKey.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const k of rowKeys) {
      const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanK === cleanTarget) {
        return row[k];
      }
    }
  }

  return undefined;
}

/**
 * Parses an uploaded Distance Matrix Excel file.
 * Supports:
 * 1. Pairwise list format (e.g. From Location, From Lat, From Lon / From Coordinates, To Location, To Lat, To Lon / To Coordinates, Distance (km))
 * 2. Matrix grid format (Origin \ Destination headers with coordinate keys/names across top row and first column)
 */
export async function parseDistanceMatrixExcel(file: File): Promise<DistanceMatrixData> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('The uploaded Excel file contains no worksheets.');
  }

  // Look for a sheet named 'Pairwise Distances' or 'Distance Matrix' or use the first sheet
  let chosenSheetName = workbook.SheetNames[0];
  for (const name of workbook.SheetNames) {
    const n = name.toLowerCase();
    if (n.includes('pairwise') || n.includes('pair')) {
      chosenSheetName = name;
      break;
    }
  }

  const worksheet = workbook.Sheets[chosenSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { raw: false, defval: '' });

  if (!rawRows || rawRows.length === 0) {
    throw new Error('The selected sheet has no data rows.');
  }

  // Determine if it's Pairwise List format or Matrix Grid format
  const firstRow = rawRows[0];
  const keys = Object.keys(firstRow);

  const hasFromCol = keys.some((k) => {
    const l = k.toLowerCase();
    return l.includes('from') || l.includes('origin') || l.includes('source');
  });
  const hasToCol = keys.some((k) => {
    const l = k.toLowerCase();
    return l.includes('to') || l.includes('dest') || l.includes('destination');
  });
  const hasDistCol = keys.some((k) => {
    const l = k.toLowerCase();
    return l.includes('dist') || l.includes('km') || l.includes('length');
  });

  const locationMap = new Map<string, LocationPoint>();
  const matrix: Record<string, Record<string, number>> = {};
  const durations: Record<string, Record<string, number>> = {};
  const sources: Record<string, Record<string, 'osm-table' | 'osm-route' | 'haversine' | 'manual'>> = {};

  if (hasFromCol && hasToCol && hasDistCol) {
    // Format A: Pairwise List
    for (const row of rawRows) {
      const fromName = String(findColumnValue(row, ['From Location', 'From', 'Origin', 'Source Location', 'From Name']) || '').trim();
      const toName = String(findColumnValue(row, ['To Location', 'To', 'Destination', 'Dest Location', 'To Name', 'Dest']) || '').trim();

      const fromCoordsRaw = String(findColumnValue(row, ['From Coordinates', 'From Coords', 'Origin Coordinates', 'From Key']) || '').trim();
      const toCoordsRaw = String(findColumnValue(row, ['To Coordinates', 'To Coords', 'Destination Coordinates', 'To Key']) || '').trim();

      let fromLat = parseFloat(String(findColumnValue(row, ['From Lat', 'From Latitude', 'Origin Lat', 'Lat1', 'Source Lat'])));
      let fromLon = parseFloat(String(findColumnValue(row, ['From Lon', 'From Long', 'From Longitude', 'Origin Lon', 'Lon1', 'Source Lon'])));
      let toLat = parseFloat(String(findColumnValue(row, ['To Lat', 'To Latitude', 'Dest Lat', 'Destination Lat', 'Lat2'])));
      let toLon = parseFloat(String(findColumnValue(row, ['To Lon', 'To Long', 'To Longitude', 'Dest Lon', 'Destination Lon', 'Lon2'])));

      // If lat/lon not separate, try parsing from coordinates string (e.g. "27.1234,95.5678")
      if ((isNaN(fromLat) || isNaN(fromLon)) && fromCoordsRaw.includes(',')) {
        const parts = fromCoordsRaw.split(',').map((p) => parseFloat(p.trim()));
        if (!isNaN(parts[0]) && !isNaN(parts[1])) {
          fromLat = parts[0];
          fromLon = parts[1];
        }
      }
      if ((isNaN(toLat) || isNaN(toLon)) && toCoordsRaw.includes(',')) {
        const parts = toCoordsRaw.split(',').map((p) => parseFloat(p.trim()));
        if (!isNaN(parts[0]) && !isNaN(parts[1])) {
          toLat = parts[0];
          toLon = parts[1];
        }
      }

      if (isNaN(fromLat) || isNaN(fromLon) || isNaN(toLat) || isNaN(toLon)) {
        continue; // Skip invalid row
      }

      const fromKey = getLocationKey(fromLat, fromLon);
      const toKey = getLocationKey(toLat, toLon);

      if (!locationMap.has(fromKey)) {
        locationMap.set(fromKey, {
          key: fromKey,
          name: fromName || `Location (${fromLat.toFixed(3)}, ${fromLon.toFixed(3)})`,
          lat: fromLat,
          lon: fromLon,
        });
      }
      if (!locationMap.has(toKey)) {
        locationMap.set(toKey, {
          key: toKey,
          name: toName || `Location (${toLat.toFixed(3)}, ${toLon.toFixed(3)})`,
          lat: toLat,
          lon: toLon,
        });
      }

      const rawDist = findColumnValue(row, ['Distance (km)', 'Distance', 'Dist (km)', 'Distance_km', 'Dist', 'km']);
      const distNum = parseFloat(String(rawDist).replace(/,/g, ''));
      const finalDist = !isNaN(distNum) && distNum >= 0 ? Math.round(distNum * 100) / 100 : Math.round(computeHaversineDistanceKm(fromLat, fromLon, toLat, toLon, true) * 100) / 100;

      const rawDur = findColumnValue(row, ['Est. Duration (min)', 'Duration (min)', 'Duration', 'Time (min)', 'Duration_min']);
      const durNum = parseFloat(String(rawDur).replace(/,/g, ''));
      const finalDur = !isNaN(durNum) && durNum >= 0 ? Math.round(durNum * 10) / 10 : Math.round((finalDist / 40) * 60);

      const rawTier = String(findColumnValue(row, ['Calculation Tier', 'Tier', 'Source', 'Method']) || '').toLowerCase();
      let sourceTier: 'osm-table' | 'osm-route' | 'haversine' | 'manual' = 'manual';
      if (rawTier.includes('osm-table') || rawTier.includes('table')) sourceTier = 'osm-table';
      else if (rawTier.includes('osm-route') || rawTier.includes('route')) sourceTier = 'osm-route';
      else if (rawTier.includes('haversine')) sourceTier = 'haversine';
      else sourceTier = 'manual';

      if (!matrix[fromKey]) matrix[fromKey] = {};
      if (!durations[fromKey]) durations[fromKey] = {};
      if (!sources[fromKey]) sources[fromKey] = {};

      matrix[fromKey][toKey] = finalDist;
      durations[fromKey][toKey] = finalDur;
      sources[fromKey][toKey] = sourceTier;
    }
  } else {
    // Format B: Matrix Grid Table
    // Try to parse headers as destinations
    const sheetDataAOA = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: '' });
    if (sheetDataAOA.length < 2) {
      throw new Error('Matrix grid sheet requires at least a header row and 1 data row.');
    }

    const headerRow = sheetDataAOA[0];
    const destLocs: { key: string; name: string; lat: number; lon: number }[] = [];

    for (let c = 1; c < headerRow.length; c++) {
      const cellStr = String(headerRow[c] || '').trim();
      if (!cellStr) continue;

      // Extract coords like "Ampinagar (23.6358, 91.6247)" or "23.6358, 91.6247"
      const coordMatch = cellStr.match(/([0-9]+\.?[0-9]*)\s*,\s*([0-9]+\.?[0-9]*)/);
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lon = parseFloat(coordMatch[2]);
        const key = getLocationKey(lat, lon);
        const name = cellStr.replace(/\(.*?\)/g, '').trim() || cellStr;
        destLocs.push({ key, name, lat, lon });
      }
    }

    for (let r = 1; r < sheetDataAOA.length; r++) {
      const row = sheetDataAOA[r];
      const originCell = String(row[0] || '').trim();
      if (!originCell) continue;

      const coordMatch = originCell.match(/([0-9]+\.?[0-9]*)\s*,\s*([0-9]+\.?[0-9]*)/);
      if (!coordMatch) continue;

      const oLat = parseFloat(coordMatch[1]);
      const oLon = parseFloat(coordMatch[2]);
      const oKey = getLocationKey(oLat, oLon);
      const oName = originCell.replace(/\(.*?\)/g, '').trim() || originCell;

      if (!locationMap.has(oKey)) {
        locationMap.set(oKey, { key: oKey, name: oName, lat: oLat, lon: oLon });
      }

      if (!matrix[oKey]) matrix[oKey] = {};
      if (!durations[oKey]) durations[oKey] = {};
      if (!sources[oKey]) sources[oKey] = {};

      for (let c = 1; c < row.length; c++) {
        const destLoc = destLocs[c - 1];
        if (!destLoc) continue;

        if (!locationMap.has(destLoc.key)) {
          locationMap.set(destLoc.key, destLoc);
        }

        const rawVal = row[c];
        const distNum = parseFloat(String(rawVal).replace(/,/g, ''));
        const finalDist = !isNaN(distNum) && distNum >= 0
          ? Math.round(distNum * 100) / 100
          : Math.round(computeHaversineDistanceKm(oLat, oLon, destLoc.lat, destLoc.lon, true) * 100) / 100;

        matrix[oKey][destLoc.key] = finalDist;
        durations[oKey][destLoc.key] = Math.round((finalDist / 40) * 60);
        sources[oKey][destLoc.key] = 'manual';
      }
    }
  }

  const locations = Array.from(locationMap.values());
  if (locations.length === 0) {
    throw new Error('No valid location coordinates found in uploaded Distance Matrix file.');
  }

  // Ensure all pairwise combinations exist
  let totalPairs = 0;
  let manualCount = 0;
  for (const origin of locations) {
    if (!matrix[origin.key]) matrix[origin.key] = {};
    if (!durations[origin.key]) durations[origin.key] = {};
    if (!sources[origin.key]) sources[origin.key] = {};

    for (const dest of locations) {
      totalPairs++;
      if (matrix[origin.key][dest.key] === undefined) {
        if (origin.key === dest.key) {
          matrix[origin.key][dest.key] = 0;
          durations[origin.key][dest.key] = 0;
          sources[origin.key][dest.key] = 'manual';
        } else {
          const fallbackDist = Math.round(computeHaversineDistanceKm(origin.lat, origin.lon, dest.lat, dest.lon, true) * 100) / 100;
          matrix[origin.key][dest.key] = fallbackDist;
          durations[origin.key][dest.key] = Math.round((fallbackDist / 40) * 60);
          sources[origin.key][dest.key] = 'haversine';
        }
      }
      manualCount++;
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
      osmTablePairs: 0,
      osmRoutePairs: 0,
      haversinePairs: 0,
      manualPairs: totalPairs,
    },
  };

  saveDistanceMatrixToStorage(result);
  return result;
}

/**
 * Generates and downloads a Sample Distance Matrix Excel file template with pairwise and grid formats
 */
export function downloadSampleDistanceMatrixTemplate(
  locations?: LocationPoint[],
  filename = 'Sample_Distance_Matrix_Template.xlsx'
): void {
  const wb = XLSX.utils.book_new();

  // If locations provided, use them; otherwise extract from default sample orders
  const locsToUse = locations && locations.length > 0
    ? locations
    : SAMPLE_SALES_REGISTER_ORDERS.map((o) => ({
        key: getLocationKey(o.lat, o.lon),
        name: o.dest,
        lat: o.lat,
        lon: o.lon,
      })).filter((v, idx, arr) => arr.findIndex((x) => x.key === v.key) === idx);

  // Sheet 1: Pairwise Distances (Standard recommended list format for upload)
  const pairwiseRows: any[] = [];
  for (const origin of locsToUse) {
    for (const dest of locsToUse) {
      const dist = origin.key === dest.key
        ? 0
        : Math.round(computeHaversineDistanceKm(origin.lat, origin.lon, dest.lat, dest.lon, true) * 100) / 100;
      const dur = origin.key === dest.key ? 0 : Math.round((dist / 40) * 60);

      pairwiseRows.push({
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
        'Calculation Tier': origin.key === dest.key ? 'Exact Same Location' : 'User Upload / Verified Road Distance',
      });
    }
  }

  const wsPairwise = XLSX.utils.json_to_sheet(pairwiseRows);
  XLSX.utils.book_append_sheet(wb, wsPairwise, 'Pairwise Distances');

  // Sheet 2: Distance Matrix Grid (N x N visual cross table)
  const headerRow = ['Origin \\ Destination', ...locsToUse.map((l) => `${l.name} (${l.key})`)];
  const gridRows: any[][] = [headerRow];

  for (const origin of locsToUse) {
    const row: any[] = [`${origin.name} (${origin.key})`];
    for (const dest of locsToUse) {
      const dist = origin.key === dest.key
        ? 0
        : Math.round(computeHaversineDistanceKm(origin.lat, origin.lon, dest.lat, dest.lon, true) * 100) / 100;
      row.push(dist);
    }
    gridRows.push(row);
  }

  const wsGrid = XLSX.utils.aoa_to_sheet(gridRows);
  XLSX.utils.book_append_sheet(wb, wsGrid, 'Distance Matrix (km)');

  // Sheet 3: Instructions & Column Specs
  const instructions = [
    { 'Field / Column': 'From Location', 'Description': 'Name of the origin point or dealer city' },
    { 'Field / Column': 'From Lat', 'Description': 'Origin Latitude (Decimal degrees, e.g. 23.6358)' },
    { 'Field / Column': 'From Lon', 'Description': 'Origin Longitude (Decimal degrees, e.g. 91.6247)' },
    { 'Field / Column': 'To Location', 'Description': 'Name of the destination point or dealer city' },
    { 'Field / Column': 'To Lat', 'Description': 'Destination Latitude (Decimal degrees)' },
    { 'Field / Column': 'To Lon', 'Description': 'Destination Longitude (Decimal degrees)' },
    { 'Field / Column': 'Distance (km)', 'Description': 'Actual road network distance between points in kilometers' },
    { 'Field / Column': 'Est. Duration (min)', 'Description': 'Optional estimated travel time in minutes' },
    { 'Field / Column': 'Calculation Tier', 'Description': 'Optional notation (e.g. Manual, Verified ODR, Google API, OSM)' },
  ];
  const wsInstructions = XLSX.utils.json_to_sheet(instructions);
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Upload Instructions');

  XLSX.writeFile(wb, filename);
}

/**
 * Parses raw Excel / CSV file buffer into OrderLineItem array
 */
export async function parseSalesRegisterFile(file: File): Promise<OrderLineItem[]> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });

  // Use the first sheet
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  // Convert to JSON array of row objects
  const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { raw: false, defval: '' });

  if (!rawRows || rawRows.length === 0) {
    throw new Error('The uploaded file contains no data rows.');
  }

  const parsedOrders: OrderLineItem[] = [];

  for (let index = 0; index < rawRows.length; index++) {
    const row = rawRows[index];

    // Map Inv Qt.(MT)
    const rawWeight = findColumnValue(row, ['Inv Qt.(MT)', 'Inv Qt(MT)', 'Inv Qt.', 'Inv Qt', 'Weight(MT)', 'Quantity', 'Qty']);
    const weightNum = parseFloat(String(rawWeight).replace(/,/g, ''));

    if (isNaN(weightNum) || weightNum <= 0) {
      continue; // Skip invalid or summary/header rows
    }

    // Map SO/PO Date
    const rawDate = findColumnValue(row, ['SO/PO Date', 'SO Date', 'PO Date', 'Date', 'Order Date']) || '01/10/2026';
    const rawTime = findColumnValue(row, ['SO/STO creation time', 'SO creation time', 'Creation Time', 'Time', 'Order Time']) || '10:00:00';

    // Map Parties & Dest
    const soldToParty = String(findColumnValue(row, ['Sold to Party (dealer)', 'Sold to Party', 'Dealer', 'Dealer ID', 'Sold-to']) || `Dealer-${index + 1}`).trim();
    const shipToParty = String(findColumnValue(row, ['Ship To Party Name', 'Ship to Party', 'Receiver', 'Consignee', 'Ship-to']) || soldToParty).trim();
    const dest = String(findColumnValue(row, ['Dest.', 'Dest', 'Destination', 'Location', 'City']) || 'Main Hub').trim();

    // Map Coordinates
    const rawLat = findColumnValue(row, ['Lat', 'Latitude', 'dest_lat', 'Destination Lat']);
    const rawLon = findColumnValue(row, ['Lon', 'Longitude', 'Long', 'dest_lon', 'Destination Lon']);

    const latNum = parseFloat(String(rawLat));
    const lonNum = parseFloat(String(rawLon));

    if (isNaN(latNum) || isNaN(lonNum)) {
      continue;
    }

    parsedOrders.push({
      id: index + 1,
      invQt: Math.round(weightNum * 100) / 100,
      soPoDate: String(rawDate).trim(),
      soStoCreationTime: String(rawTime).trim(),
      soldToParty,
      shipToPartyName: shipToParty,
      dest,
      lat: latNum,
      lon: lonNum,
      rawRowData: row,
    });
  }

  if (parsedOrders.length === 0) {
    throw new Error('Could not find any valid order rows with required columns: Inv Qt.(MT), SO/PO Date, SO/STO creation time, Lat, Lon.');
  }

  return parsedOrders;
}

/**
 * Generates and downloads a sample Input Sales Register Excel template
 */
export function downloadSampleSalesRegisterExcel(filename = 'Sample_Sales_Register_Input.xlsx'): void {
  const wb = XLSX.utils.book_new();

  const rows = SAMPLE_SALES_REGISTER_ORDERS.map((item) => item.rawRowData);
  const ws = XLSX.utils.json_to_sheet(rows);

  XLSX.utils.book_append_sheet(wb, ws, 'Sales Register');
  XLSX.writeFile(wb, filename);
}

/**
 * Exports the optimized dispatch manifest to an Excel file:
 * - Preserves all input rows intact
 * - Appends:
 *    - `Vehicle Type Allotted` (25, 30, 35, or NA)
 *    - `Vehicle ID` (<Vehicle_Capacity>_<Vehicle_Capacity_Counter>, e.g. 25MT_1, 35MT_4, or NA)
 * - Also includes a second sheet with the Vehicle Summary Table
 */
export function exportOptimizationResultToExcel(
  result: OptimizationResult,
  filename = 'Optimized_Logistics_Dispatch_Plan.xlsx'
): void {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Master Order Allocation (All original rows preserved + appended allocation columns)
  const masterRows = result.orders.map((o) => {
    const raw = { ...o.rawRowData };

    // Explicitly append the two required PRD columns
    raw['Vehicle Type Allotted'] = o.vehicleTypeAllotted ?? 'NA';
    raw['Vehicle ID'] = o.vehicleId ?? 'NA';

    // Useful diagnostic metadata
    raw['Priority Allocation Category'] = o.priorityCategory ?? 'Unassigned';
    raw['SLA Order Effective Start'] = o.calculatedSla?.formattedStartTime ?? '';
    raw['SLA Expiry Time'] = o.calculatedSla?.formattedExpiryTime ?? '';
    raw['Allocation Details'] = o.allocationReason ?? '';

    return raw;
  });

  const wsMaster = XLSX.utils.json_to_sheet(masterRows);
  XLSX.utils.book_append_sheet(wb, wsMaster, 'Enriched Orders & Allocation');

  // Sheet 2: Vehicle Fleet Summary (UI Vehicle Counter spec)
  const summaryRows = [
    { 'Vehicle Capacity': '25 MT Fleet', 'Fleet Count Required': result.summary.fleet25Count },
    { 'Vehicle Capacity': '30 MT Fleet', 'Fleet Count Required': result.summary.fleet30Count },
    { 'Vehicle Capacity': '35 MT Fleet', 'Fleet Count Required': result.summary.fleet35Count },
    { 'Vehicle Capacity': 'Total Fleet Executed', 'Fleet Count Required': result.summary.totalFleetExecuted },
    { 'Vehicle Capacity': '', 'Fleet Count Required': '' },
    { 'Vehicle Capacity': 'Total Orders Processed', 'Fleet Count Required': result.summary.totalOrders },
    { 'Vehicle Capacity': 'Orders Dispatched', 'Fleet Count Required': result.summary.dispatchedOrdersCount },
    { 'Vehicle Capacity': 'Orders Backlog (NA)', 'Fleet Count Required': result.summary.backlogOrdersCount },
    { 'Vehicle Capacity': 'Total Tonnage (MT)', 'Fleet Count Required': result.summary.totalWeightMT },
    { 'Vehicle Capacity': 'Dispatched Tonnage (MT)', 'Fleet Count Required': result.summary.dispatchedWeightMT },
    { 'Vehicle Capacity': 'Backlog Tonnage (MT)', 'Fleet Count Required': result.summary.backlogWeightMT },
    { 'Vehicle Capacity': 'Average Vehicle Utilization (%)', 'Fleet Count Required': `${result.summary.averageUtilizationPercent}%` },
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Fleet Summary');

  // Sheet 3: Dispatched Vehicle Batches & Route Manifest
  const batchRows = result.dispatchedBatches.map((b) => ({
    'Vehicle ID': b.vehicleId,
    'Vehicle Capacity (MT)': b.capacityMT,
    'Total Payload (MT)': b.totalWeightMT,
    'Payload Utilization (%)': `${b.utilizationPercent}%`,
    'Priority Tier': b.priorityGroup,
    'Dealer / Account': b.dealerId,
    'Number of Orders': b.orders.length,
    'Number of Stops': b.stops.length,
    'First Drop Destination (Stop 1)': b.stops[0]?.dest ?? '',
    'Cumulative Multi-Drop Road Distance (km)': b.cumulativeMultiDropDistanceKm,
    'SLA Earliest Expiry Time': b.slaEarliestExpiry,
    'Route Stop Sequence': b.stops.map((s) => `${s.sequence}. ${s.dest} (${s.weightMT} MT)`).join(' -> '),
  }));

  const wsBatches = XLSX.utils.json_to_sheet(batchRows);
  XLSX.utils.book_append_sheet(wb, wsBatches, 'Vehicle Manifest & Stops');

  // Sheet 4: Backlog Orders (NA)
  const backlogRows = result.backlogOrders.map((o) => ({
    'Order No / ID': o.rawRowData?.['Order No'] || o.id,
    'Dealer': o.soldToParty,
    'Destination': o.dest,
    'Weight (MT)': o.invQt,
    'SLA Window Start': o.calculatedSla?.formattedStartTime ?? '',
    'SLA Expiry': o.calculatedSla?.formattedExpiryTime ?? '',
    'Reason for Backlog': o.allocationReason ?? '',
  }));
  const wsBacklog = XLSX.utils.json_to_sheet(backlogRows);
  XLSX.utils.book_append_sheet(wb, wsBacklog, 'Depot Backlog (NA)');

  XLSX.writeFile(wb, filename);
}
