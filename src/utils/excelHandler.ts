import * as XLSX from 'xlsx';
import { OrderLineItem, OptimizationResult } from '../types';
import { SAMPLE_SALES_REGISTER_ORDERS } from './sampleData';

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
