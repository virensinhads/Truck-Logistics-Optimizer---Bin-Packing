import {
  OrderLineItem,
  HistoricalDispatch,
  HistoricalMetrics,
  DistanceMatrixData,
  VehicleDispatchBatch,
  RouteStop,
  VehicleType,
  SlaBreachStats,
  MultiDropBreakupStats
} from '../types';
import { computeHaversineDistanceKm } from './haversine';
import { getLocationKey, loadDistanceMatrixFromStorage } from './distanceMatrixEngine';
import { DestinationStopGroup, optimizeRouteStopSequence, buildRouteStops } from './optimizationEngine';
import { evaluateOrderSlaWithActuals } from './slaCalculator';

/**
 * Maps case-insensitive vehicle tier name to rated capacity in MT
 * - "12 wheeler" -> 25 MT
 * - "14 wheeler" -> 30 MT
 * - "16 wheeler" -> 35 MT
 */
export function mapTruckTypeToRatedCapacity(rawType: string | undefined | null): number {
  if (!rawType) return 25; // Default baseline
  const clean = String(rawType).toLowerCase().trim();

  if (clean.includes('16') || clean.includes('35')) {
    return 35;
  }
  if (clean.includes('14') || clean.includes('30')) {
    return 30;
  }
  if (clean.includes('12') || clean.includes('25')) {
    return 25;
  }

  const num = parseFloat(clean);
  if (!isNaN(num)) {
    if (num >= 33) return 35;
    if (num >= 28) return 30;
    if (num >= 20) return 25;
  }

  return 25;
}

/**
 * Extracts the date portion (e.g. "DD.MM.YYYY" or "DD/MM/YYYY") from an E-Way Bill date & time value or Date object
 */
export function extractEBillDate(val: any): string {
  if (val === undefined || val === null) return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    const day = String(val.getDate()).padStart(2, '0');
    const month = String(val.getMonth() + 1).padStart(2, '0');
    const year = val.getFullYear();
    return `${day}.${month}.${year}`;
  }
  const str = String(val).trim();
  if (!str || str.toLowerCase() === 'na' || str.toLowerCase() === 'null') return '';

  // Format is typically "DD.MM.YYYY HH:MM:SS" or "DD/MM/YYYY HH:MM:SS"
  // Split on whitespace or 'T' to isolate date portion
  const datePart = str.split(/[ T]/)[0].trim();
  return datePart;
}

/**
 * Resolves the E-Way Bill date for an order item, falling back to SO/PO date if not specified
 */
export function getOrderEBillDate(order: OrderLineItem): string {
  if (order.eWayBillDate) return order.eWayBillDate;
  if (order.eWayBillDateTime) {
    const d = extractEBillDate(order.eWayBillDateTime);
    if (d) return d;
  }
  const rawEwb = order.rawRowData?.['E-Way Bill date & time'] 
    || order.rawRowData?.['E-Way Bill Date & Time']
    || order.rawRowData?.['Eway Bill date & time']
    || order.rawRowData?.['E-Way Bill Date']
    || order.rawRowData?.['Ebill Date']
    || order.rawRowData?.['Dispatch Date'];
  if (rawEwb) {
    const d = extractEBillDate(rawEwb);
    if (d) return d;
  }
  return (order.soPoDate || order.rawRowData?.['SO/PO Date'] || order.rawRowData?.['SO Date'] || order.rawRowData?.['PO Date'] || order.rawRowData?.['Date'] || 'UNKNOWN_DATE').trim();
}

/**
 * Checks whether a Club ID is active/valid or represents an unclubbed row
 * Numeric or non-zero => active club. "NA", "None", "0", 0, "Non Clubbed", empty => unclubbed.
 */
export function isClubIdActive(rawClubId: any): boolean {
  if (rawClubId === undefined || rawClubId === null) return false;
  const s = String(rawClubId).trim();
  if (!s) return false;

  const upper = s.toUpperCase();
  if (
    upper === 'NA' ||
    upper === 'NONE' ||
    upper === 'N/A' ||
    upper === 'NULL' ||
    upper === '0' ||
    upper === 'NON CLUBBED' ||
    upper === 'NON-CLUBBED' ||
    upper === 'NONCLUBBED' ||
    upper === 'UNCLUBBED' ||
    upper === 'NOT CLUBBED' ||
    upper === 'NO' ||
    upper === 'FALSE' ||
    upper === '-'
  ) {
    return false;
  }

  const num = Number(s);
  if (!isNaN(num) && num === 0) {
    return false;
  }

  return true;
}

/**
 * Calculates inter-stop distance between two points using Distance Matrix cache or 1.3x Haversine
 */
function getPairDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  cachedMatrix?: DistanceMatrixData | null
): number {
  if (Math.abs(lat1 - lat2) < 0.0001 && Math.abs(lon1 - lon2) < 0.0001) {
    return 0;
  }

  if (cachedMatrix?.matrix) {
    const key1 = getLocationKey(lat1, lon1);
    const key2 = getLocationKey(lat2, lon2);
    const dist = cachedMatrix.matrix[key1]?.[key2];
    if (typeof dist === 'number' && dist > 0) {
      return dist;
    }
  }

  return Math.round(computeHaversineDistanceKm(lat1, lon1, lat2, lon2, true) * 100) / 100;
}

/**
 * Computes comprehensive historical actual dispatch metrics from raw sales register rows
 */
export function calculateHistoricalMetrics(
  orders: OrderLineItem[],
  configuredRadiusThreshold: number = 35,
  cachedMatrix?: DistanceMatrixData | null,
  slaWindowHours: number = 2,
  shiftStartTime: string = '10:00',
  shiftEndTime: string = '17:00'
): HistoricalMetrics {
  if (!orders || orders.length === 0) {
    return {
      totalUniqueTrucks: 0,
      fleet25Count: 0,
      fleet30Count: 0,
      fleet35Count: 0,
      fleetOtherCount: 0,
      totalOrders: 0,
      totalClubbedOrders: 0,
      totalUnclubbedOrders: 0,
      totalDispatches: 0,
      overweightDispatchesCount: 0,
      totalExcessTonnageMT: 0,
      averageCapacityUtilizationPercent: 0,
      distanceWeightedAvgInterDropDistanceKm: null,
      radiusThresholdBreachesCount: 0,
      dispatches: [],
      slaStats: {
        totalOrders: 0,
        breachedOrdersCount: 0,
        breachedOrdersPercent: 0,
        compliantOrdersCount: 0,
        maxDelayHours: 0,
        avgDelayHours: 0,
        medianDelayHours: 0,
        formattedMaxDelay: '0.0 hrs',
        formattedAvgDelay: '0.0 hrs',
        formattedMedianDelay: '0.0 hrs',
      },
      multiDropStats: {
        totalVehicles: 0,
        totalOrders: 0,
        fleet25Count: 0,
        fleet30Count: 0,
        fleet35Count: 0,
        fleetOtherCount: 0,
      },
    };
  }

  // 0. Ensure all order items have their SLA and E-Way Bill delays evaluated
  orders.forEach((order) => {
    evaluateOrderSlaWithActuals(order, slaWindowHours, shiftStartTime, shiftEndTime);
  });

  // 1. Group orders into historical dispatches using <truckNo>_<ebillDate>
  const dispatchMap = new Map<string, OrderLineItem[]>();
  let unassignedTruckCounter = 0;

  orders.forEach((order) => {
    const truckNo = (order.truckNo || order.rawRowData?.['Truck No.'] || order.rawRowData?.['Truck No'] || order.rawRowData?.['TruckNo'] || order.rawRowData?.['Vehicle No'] || '').trim();
    const ebillDate = getOrderEBillDate(order);

    let dispatchKey: string;
    if (truckNo) {
      dispatchKey = `${truckNo}_${ebillDate}`;
    } else {
      unassignedTruckCounter++;
      dispatchKey = `TRUCK_UNASSIGNED_${unassignedTruckCounter}_${ebillDate}`;
    }

    if (!dispatchMap.has(dispatchKey)) {
      dispatchMap.set(dispatchKey, []);
    }
    dispatchMap.get(dispatchKey)!.push(order);
  });

  const historicalDispatches: HistoricalDispatch[] = [];
  const uniqueTruckSet = new Set<string>();

  let totalFleet25 = 0;
  let totalFleet30 = 0;
  let totalFleet35 = 0;
  let totalFleetOther = 0;

  let totalClubbedOrders = 0;
  let totalUnclubbedOrders = 0;
  let overweightDispatchesCount = 0;
  let totalExcessTonnageMT = 0;

  let sumUtilization = 0;
  let weightedDistanceNumerator = 0;
  let weightedDistanceDenominator = 0;
  let totalRadiusBreaches = 0;

  dispatchMap.forEach((dispatchOrders, dispatchKey) => {
    const first = dispatchOrders[0];
    const rawClub = first.clubId ?? first.rawRowData?.['Club ID'] ?? first.rawRowData?.['ClubId'];
    const truckNo = (first.truckNo || first.rawRowData?.['Truck No.'] || first.rawRowData?.['Truck No'] || first.rawRowData?.['TruckNo'] || '').trim();
    const ebillDate = getOrderEBillDate(first);
    const soPoDate = (first.soPoDate || first.rawRowData?.['SO/PO Date'] || first.rawRowData?.['SO Date'] || first.rawRowData?.['PO Date'] || first.rawRowData?.['Date'] || '').trim();
    const rawEwbDateTime = first.eWayBillDateTime || first.rawRowData?.['E-Way Bill date & time'] || first.rawRowData?.['E-Way Bill Date & Time'];
    const transpName = (first.transpName || first.rawRowData?.['Transp Name'] || first.rawRowData?.['Transporter Name'] || first.rawRowData?.['Transporter'] || 'Standard Carrier').trim();
    const truckTypeRaw = (first.truckTypeRaw || first.rawRowData?.['Truck Type'] || first.rawRowData?.['TruckType'] || '12 wheeler').trim();

    // Determine the vehicle's true rated capacity (highest capacity specified in batch or mapped from truck type)
    let ratedCapacityMT = 0;
    for (const o of dispatchOrders) {
      const oCap = o.historicalRatedCapacityMT || mapTruckTypeToRatedCapacity(o.truckTypeRaw || o.rawRowData?.['Truck Type'] || o.rawRowData?.['TruckType']);
      if (oCap > ratedCapacityMT) {
        ratedCapacityMT = oCap;
      }
    }
    if (ratedCapacityMT <= 0) {
      ratedCapacityMT = mapTruckTypeToRatedCapacity(truckTypeRaw);
    }

    if (truckNo) {
      uniqueTruckSet.add(truckNo);
    }

    // Partition by tonnage bucket
    if (ratedCapacityMT === 25) totalFleet25++;
    else if (ratedCapacityMT === 30) totalFleet30++;
    else if (ratedCapacityMT === 35) totalFleet35++;
    else totalFleetOther++;

    const totalWeightMT = Math.round(dispatchOrders.reduce((sum, o) => sum + o.invQt, 0) * 100) / 100;
    const isClubbed = dispatchOrders.length > 1;

    if (isClubbed) {
      totalClubbedOrders += dispatchOrders.length;
    } else {
      totalUnclubbedOrders += dispatchOrders.length;
    }

    // Overweight check
    const isOverweight = ratedCapacityMT > 0 && totalWeightMT > ratedCapacityMT;
    const excessWeightMT = isOverweight ? Math.round((totalWeightMT - ratedCapacityMT) * 100) / 100 : 0;

    if (isOverweight) {
      overweightDispatchesCount++;
      totalExcessTonnageMT += excessWeightMT;
    }

    // Utilization % for this vehicle dispatch
    const utilizationPercent = ratedCapacityMT > 0
      ? Math.round((totalWeightMT / ratedCapacityMT) * 1000) / 10
      : 100;
    sumUtilization += utilizationPercent;

    // Multi-drop inter-stop distance & threshold breach calculation
    // Group unique destination stops in sequential order
    const destMap = new Map<string, DestinationStopGroup>();
    dispatchOrders.forEach((o) => {
      const key = `${o.dest.trim().toLowerCase()}_${o.lat.toFixed(4)}_${o.lon.toFixed(4)}`;
      const existing = destMap.get(key);
      const orderWeight = o.invQt;
      const expiry = o.calculatedSla?.expiryTimestamp ?? Infinity;

      if (!existing) {
        destMap.set(key, {
          dest: o.dest.trim(),
          lat: o.lat,
          lon: o.lon,
          orders: [o],
          totalWeight: orderWeight,
          maxOrderWeight: orderWeight,
          earliestExpiry: expiry,
        });
      } else {
        existing.orders.push(o);
        existing.totalWeight += orderWeight;
        if (orderWeight > existing.maxOrderWeight) {
          existing.maxOrderWeight = orderWeight;
        }
        if (expiry < existing.earliestExpiry) {
          existing.earliestExpiry = expiry;
        }
      }
    });

    const distinctDests = Array.from(destMap.values());
    const isMultiDrop = distinctDests.length > 1;
    let dispatchInterDropDistKm = 0;
    let dispatchRadiusBreaches = 0;
    let orderedDestNames: string[] = distinctDests.map((d) => d.dest);

    // Distance-weighted drop distance is calculated ONLY when multi-location drops are happening
    if (isMultiDrop) {
      const optimalResult = optimizeRouteStopSequence(
        distinctDests,
        (a, b) => getPairDistanceKm(a.lat, a.lon, b.lat, b.lon, cachedMatrix)
      );

      dispatchInterDropDistKm = optimalResult.totalDistanceKm;
      orderedDestNames = optimalResult.sequencedDests.map((d) => d.dest);

      // Check radius breaches along the optimal sequence legs
      for (let i = 0; i < optimalResult.sequencedDests.length - 1; i++) {
        const legDist = getPairDistanceKm(
          optimalResult.sequencedDests[i].lat,
          optimalResult.sequencedDests[i].lon,
          optimalResult.sequencedDests[i + 1].lat,
          optimalResult.sequencedDests[i + 1].lon,
          cachedMatrix
        );
        if (legDist > configuredRadiusThreshold) {
          dispatchRadiusBreaches++;
          totalRadiusBreaches++;
        }
      }

      // Distance-Weighted calculation: sum(w_i * d_i) / sum(w_i) strictly for multi-location drops
      const vehicleWeight = totalWeightMT > 0 ? totalWeightMT : (ratedCapacityMT > 0 ? ratedCapacityMT : 25);
      weightedDistanceNumerator += vehicleWeight * dispatchInterDropDistKm;
      weightedDistanceDenominator += vehicleWeight;
    }

    // Unique Dealers and Dealer Names
    const uniqueDealers = Array.from(new Set(dispatchOrders.map((o) => o.soldToParty).filter(Boolean)));
    const uniqueDealerNames = Array.from(
      new Set(
        dispatchOrders
          .map((o) => o.soldToPartyName || o.rawRowData?.['Sold To Party Name (Dealer)'] || o.rawRowData?.['Sold to Party Name (Dealer)'] || o.soldToParty)
          .filter(Boolean)
      )
    );

    // SLA stats for this dispatch
    const slaBreachedOrdersCount = dispatchOrders.filter((o) => o.calculatedSla?.isSlaBreached).length;
    const maxOrderDelayHours = dispatchOrders.reduce((max, o) => Math.max(max, o.calculatedSla?.delayHours || 0), 0);
    const totalOrderDelay = dispatchOrders.reduce((sum, o) => sum + (o.calculatedSla?.delayHours || 0), 0);
    const avgOrderDelayHours = dispatchOrders.length > 0 ? Math.round((totalOrderDelay / dispatchOrders.length) * 10) / 10 : 0;
    const isSlaBreached = slaBreachedOrdersCount > 0;

    historicalDispatches.push({
      dispatchKey,
      truckNo: truckNo || `TRK-${dispatchKey}`,
      dispatchDate: ebillDate || soPoDate || 'N/A',
      eWayBillDate: ebillDate || undefined,
      eWayBillDateTime: rawEwbDateTime ? String(rawEwbDateTime).trim() : undefined,
      soPoDate: soPoDate || undefined,
      transpName,
      truckTypeRaw,
      ratedCapacityMT,
      clubId: isClubIdActive(rawClub) ? rawClub : null,
      orders: dispatchOrders,
      totalWeightMT,
      utilizationPercent,
      isOverweight,
      excessWeightMT,
      isClubbed,
      isMultiDrop,
      destinations: orderedDestNames,
      interDropDistanceKm: dispatchInterDropDistKm,
      radiusThresholdBreaches: dispatchRadiusBreaches,
      dealers: uniqueDealers,
      dealerNames: uniqueDealerNames,
      dropPointsCount: distinctDests.length,
      totalOrdersCount: dispatchOrders.length,
      slaBreachedOrdersCount,
      maxOrderDelayHours,
      avgOrderDelayHours,
      isSlaBreached,
    });
  });

  const totalDispatches = historicalDispatches.length;
  const totalUniqueTrucks = uniqueTruckSet.size > 0 ? uniqueTruckSet.size : totalDispatches;

  // Average Capacity Utilization % across all historical vehicle dispatches
  const averageCapacityUtilizationPercent = totalDispatches > 0
    ? Math.round((sumUtilization / totalDispatches) * 10) / 10
    : 0;

  // Distance-weighted drop distance is calculated ONLY when multi-location drops exist
  const distanceWeightedAvgInterDropDistanceKm = weightedDistanceDenominator > 0
    ? Math.round((weightedDistanceNumerator / weightedDistanceDenominator) * 100) / 100
    : null;

  // Calculate overall SLA breach statistics across all line items
  const breachedOrders = orders.filter((o) => o.calculatedSla?.isSlaBreached);
  const breachedOrdersCount = breachedOrders.length;
  const totalOrdersCount = orders.length;
  const breachedOrdersPercent = totalOrdersCount > 0
    ? Math.round((breachedOrdersCount / totalOrdersCount) * 1000) / 10
    : 0;
  const compliantOrdersCount = totalOrdersCount - breachedOrdersCount;

  const breachedDelays = breachedOrders.map((o) => o.calculatedSla?.delayHours || 0).sort((a, b) => a - b);
  const maxDelayHours = breachedDelays.length > 0 ? Math.max(...breachedDelays) : 0;
  const avgDelayHours = breachedDelays.length > 0
    ? Math.round((breachedDelays.reduce((sum, d) => sum + d, 0) / breachedDelays.length) * 10) / 10
    : 0;

  let medianDelayHours = 0;
  if (breachedDelays.length > 0) {
    const mid = Math.floor(breachedDelays.length / 2);
    medianDelayHours = breachedDelays.length % 2 !== 0
      ? breachedDelays[mid]
      : Math.round(((breachedDelays[mid - 1] + breachedDelays[mid]) / 2) * 10) / 10;
  }

  const slaStats: SlaBreachStats = {
    totalOrders: totalOrdersCount,
    breachedOrdersCount,
    breachedOrdersPercent,
    compliantOrdersCount,
    maxDelayHours,
    avgDelayHours,
    medianDelayHours,
    formattedMaxDelay: `${maxDelayHours.toFixed(1)} hrs`,
    formattedAvgDelay: `${avgDelayHours.toFixed(1)} hrs`,
    formattedMedianDelay: `${medianDelayHours.toFixed(1)} hrs`,
  };

  // Calculate multi-drop vehicle and order counts with fleet breakup
  const multiDropDispatches = historicalDispatches.filter((d) => d.isMultiDrop && d.dropPointsCount > 1);
  const multiDropVehicles = multiDropDispatches.length;
  const multiDropOrders = multiDropDispatches.reduce((sum, d) => sum + d.orders.length, 0);
  const multiDropFleet25 = multiDropDispatches.filter((d) => d.ratedCapacityMT === 25).length;
  const multiDropFleet30 = multiDropDispatches.filter((d) => d.ratedCapacityMT === 30).length;
  const multiDropFleet35 = multiDropDispatches.filter((d) => d.ratedCapacityMT === 35).length;
  const multiDropFleetOther = multiDropDispatches.filter((d) => d.ratedCapacityMT !== 25 && d.ratedCapacityMT !== 30 && d.ratedCapacityMT !== 35).length;

  const multiDropStats: MultiDropBreakupStats = {
    totalVehicles: multiDropVehicles,
    totalOrders: multiDropOrders,
    fleet25Count: multiDropFleet25,
    fleet30Count: multiDropFleet30,
    fleet35Count: multiDropFleet35,
    fleetOtherCount: multiDropFleetOther,
  };

  return {
    totalUniqueTrucks,
    fleet25Count: totalFleet25,
    fleet30Count: totalFleet30,
    fleet35Count: totalFleet35,
    fleetOtherCount: totalFleetOther,
    totalOrders: orders.length,
    totalClubbedOrders,
    totalUnclubbedOrders,
    totalDispatches,
    overweightDispatchesCount,
    totalExcessTonnageMT: Math.round(totalExcessTonnageMT * 100) / 100,
    averageCapacityUtilizationPercent,
    distanceWeightedAvgInterDropDistanceKm,
    radiusThresholdBreachesCount: totalRadiusBreaches,
    dispatches: historicalDispatches,
    slaStats,
    multiDropStats,
  };
}

/**
 * Converts a HistoricalDispatch record into a VehicleDispatchBatch representation
 * for full compatibility with RouteMapModal and interactive road route visualization.
 */
export function convertHistoricalDispatchToBatch(
  hd: HistoricalDispatch,
  cachedMatrix?: DistanceMatrixData | null
): VehicleDispatchBatch {
  const activeMatrix = cachedMatrix || loadDistanceMatrixFromStorage();
  const routeResult = buildRouteStops(hd.orders, activeMatrix);

  const dealerDisplay = hd.dealerNames.length > 0
    ? hd.dealerNames.join(', ')
    : (hd.dealers.join(', ') || 'Various');

  const clubLabel = hd.isClubbed ? `Clubbed (${hd.totalOrdersCount} orders)` : 'Direct FTL';
  const vType: VehicleType = hd.ratedCapacityMT === 35 ? '35' : hd.ratedCapacityMT === 30 ? '30' : '25';

  return {
    vehicleId: `${hd.truckNo} (${hd.ratedCapacityMT} MT - ${clubLabel})`,
    vehicleType: vType,
    dealerId: dealerDisplay,
    capacityMT: hd.ratedCapacityMT,
    totalWeightMT: hd.totalWeightMT,
    utilizationPercent: hd.utilizationPercent,
    priorityGroup: hd.isClubbed ? 'Priority II' : 'Priority I',
    orders: hd.orders,
    stops: routeResult.stops,
    cumulativeMultiDropDistanceKm: routeResult.cumulativeDistanceKm,
    slaEarliestExpiry: hd.orders[0]?.soStoCreationTime || 'N/A',
    slaLatestStart: hd.orders[0]?.soStoCreationTime || 'N/A',
    isMultiDrop: routeResult.isMultiDrop,
  };
}
