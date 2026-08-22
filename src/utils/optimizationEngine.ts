import {
  OrderLineItem,
  OptimizationConfig,
  OptimizationResult,
  VehicleDispatchBatch,
  VehicleType,
  RouteStop,
  DistanceMatrixData,
  ExecutionLog,
} from '../types';
import { calculateOrderSla, doOrdersOverlapSla } from './slaCalculator';
import { getDistanceBetweenPoints } from './distanceMatrixEngine';

export type OptimizationProgressCallback = (progress: {
  percent: number;
  step: string;
  processedCount: number;
  totalCount: number;
}) => void;

interface CandidateGroup {
  priority: 'Priority I' | 'Priority II' | 'Priority III';
  dealerId: string;
  orders: OrderLineItem[];
  totalWeight: number;
  stops: RouteStop[];
  cumulativeDistanceKm: number;
  allocatedVehicleType?: VehicleType;
}

/**
 * Returns the minimum threshold required for a vehicle type to satisfy >80% utilization
 */
export function getMinWeightForVehicle(type: VehicleType, enabledTypes?: VehicleType[]): number {
  const enabled = enabledTypes || ['25', '30', '35'];
  switch (type) {
    case '25':
      return 20.0; // >= 20 MT (80% of 25)
    case '30':
      // If 25 MT is enabled, 30 MT is prioritized for > 25 MT; otherwise standard 80% is 24.0 MT
      return enabled.includes('25') ? 25.0001 : 24.0;
    case '35':
      // If 30 MT is enabled, 35 MT is prioritized for > 30 MT; if only 25 enabled, > 25 MT; otherwise 80% is 28.0 MT
      if (enabled.includes('30')) return 30.0001;
      if (enabled.includes('25')) return 25.0001;
      return 28.0;
  }
}

/**
 * Returns max capacity for a vehicle type
 */
export function getMaxCapacityForVehicle(type: VehicleType): number {
  switch (type) {
    case '25':
      return 25.0;
    case '30':
      return 30.0;
    case '35':
      return 35.0;
  }
}

/**
 * Finds the single best vehicle type that fits weight and achieves >80% utilization,
 * strictly prioritizing a single larger vehicle over multiple smaller ones.
 */
export function selectBestVehicleForWeight(
  weight: number,
  enabledTypes: VehicleType[]
): VehicleType | null {
  const sortedEnabled = [...enabledTypes].sort((a, b) => parseInt(b, 10) - parseInt(a, 10));

  // Priority: 35 MT > 30 MT > 25 MT
  for (const type of sortedEnabled) {
    const maxCap = getMaxCapacityForVehicle(type);
    const minCap = getMinWeightForVehicle(type, enabledTypes);

    if (weight <= maxCap && weight >= minCap) {
      return type;
    }
  }

  return null;
}

/**
 * Determines stop sequence and first drop rule for a batch of orders.
 * Rule: First drop (Stop 1) is the destination of the highest-weight order line item
 * (ties broken by earliest SLA expiry). Subsequent stops are ordered to minimize route distance.
 */
export function buildRouteStops(
  orders: OrderLineItem[],
  cachedMatrix?: DistanceMatrixData | null
): { stops: RouteStop[]; cumulativeDistanceKm: number; isMultiDrop: boolean } {
  if (orders.length === 0) {
    return { stops: [], cumulativeDistanceKm: 0, isMultiDrop: false };
  }

  // Group orders by destination/coordinates
  const destMap = new Map<string, { dest: string; lat: number; lon: number; orders: OrderLineItem[]; totalWeight: number; maxOrderWeight: number; earliestExpiry: number }>();

  for (const order of orders) {
    const key = `${order.dest.trim().toLowerCase()}_${order.lat.toFixed(4)}_${order.lon.toFixed(4)}`;
    const existing = destMap.get(key);
    const orderWeight = order.invQt;
    const expiry = order.calculatedSla?.expiryTimestamp ?? Infinity;

    if (!existing) {
      destMap.set(key, {
        dest: order.dest.trim(),
        lat: order.lat,
        lon: order.lon,
        orders: [order],
        totalWeight: orderWeight,
        maxOrderWeight: orderWeight,
        earliestExpiry: expiry,
      });
    } else {
      existing.orders.push(order);
      existing.totalWeight += orderWeight;
      if (orderWeight > existing.maxOrderWeight) {
        existing.maxOrderWeight = orderWeight;
      }
      if (expiry < existing.earliestExpiry) {
        existing.earliestExpiry = expiry;
      }
    }
  }

  const distinctDests = Array.from(destMap.values());

  // Find the First Drop (Stop 1): destination of the highest-weight single order line item (tie broken by earliest SLA)
  distinctDests.sort((a, b) => {
    if (b.maxOrderWeight !== a.maxOrderWeight) {
      return b.maxOrderWeight - a.maxOrderWeight;
    }
    return a.earliestExpiry - b.earliestExpiry;
  });

  const firstDest = distinctDests[0];
  const remainingDests = distinctDests.slice(1);

  // Sequence remaining stops by nearest neighbor from previous stop
  const sequencedDests = [firstDest];
  let currentLoc = firstDest;

  while (remainingDests.length > 0) {
    let nearestIdx = 0;
    let shortestDist = Infinity;

    for (let i = 0; i < remainingDests.length; i++) {
      const candidate = remainingDests[i];
      const dist = getDistanceBetweenPoints(currentLoc.lat, currentLoc.lon, candidate.lat, candidate.lon, cachedMatrix);
      if (dist < shortestDist) {
        shortestDist = dist;
        nearestIdx = i;
      }
    }

    const nextStop = remainingDests.splice(nearestIdx, 1)[0];
    sequencedDests.push(nextStop);
    currentLoc = nextStop;
  }

  // Calculate cumulative road distance after first drop
  let cumulativeDist = 0;
  const stops: RouteStop[] = [];

  for (let i = 0; i < sequencedDests.length; i++) {
    const item = sequencedDests[i];
    let legDist = 0;

    if (i > 0) {
      const prev = sequencedDests[i - 1];
      legDist = getDistanceBetweenPoints(prev.lat, prev.lon, item.lat, item.lon, cachedMatrix);
      cumulativeDist += legDist;
    }

    stops.push({
      sequence: i + 1,
      dest: item.dest,
      lat: item.lat,
      lon: item.lon,
      weightMT: Math.round(item.totalWeight * 100) / 100,
      orderCount: item.orders.length,
      orders: item.orders,
      isFirstDrop: i === 0,
      distanceFromPreviousKm: Math.round(legDist * 100) / 100,
    });
  }

  const roundedCumulativeDist = Math.round(cumulativeDist * 100) / 100;

  return {
    stops,
    cumulativeDistanceKm: roundedCumulativeDist,
    isMultiDrop: sequencedDests.length > 1,
  };
}

export interface BestSubsetResult {
  orders: OrderLineItem[];
  totalWeight: number;
  stops: RouteStop[];
  cumulativeDistanceKm: number;
  isMultiDrop: boolean;
}

/**
 * Searches for the subset of orders that maximizes total weight <= maxWeight,
 * subject to totalWeight >= minWeight, valid SLA overlap, and route cumulative distance <= maxRadiusKm.
 */
function searchOptimalSubset(
  orders: OrderLineItem[],
  minWeight: number,
  maxWeight: number,
  maxRadiusKm: number,
  cachedMatrix?: DistanceMatrixData | null,
  sameLocationOnly: boolean = false
): BestSubsetResult | null {
  if (orders.length === 0) return null;

  // Filter out orders exceeding maxWeight
  const validOrders = orders.filter((o) => o.invQt <= maxWeight);
  if (validOrders.length === 0) return null;

  // Sort descending by weight
  const sorted = [...validOrders].sort((a, b) => b.invQt - a.invQt);

  let bestSet: OrderLineItem[] | null = null;
  let bestWeight = 0;
  let bestStops: RouteStop[] = [];
  let bestDist = 0;
  let bestIsMulti = false;

  // Anchors to try
  const anchors = sameLocationOnly ? [sorted[0]] : sorted;

  for (let aIdx = 0; aIdx < anchors.length; aIdx++) {
    const anchor = anchors[aIdx];

    const candidatePool = sameLocationOnly
      ? sorted
      : sorted.filter((o) => {
          if (o.id === anchor.id) return true;
          const d = getDistanceBetweenPoints(anchor.lat, anchor.lon, o.lat, o.lon, cachedMatrix);
          return d <= maxRadiusKm;
        });

    const otherCandidates = candidatePool.filter((o) => o.id !== anchor.id);

    function branch(idx: number, currentSet: OrderLineItem[], curWeight: number) {
      if (curWeight >= minWeight && curWeight <= maxWeight + 0.0001) {
        if (doOrdersOverlapSla(currentSet)) {
          const route = buildRouteStops(currentSet, cachedMatrix);
          if (sameLocationOnly || route.cumulativeDistanceKm <= maxRadiusKm) {
            const isBetter =
              curWeight > bestWeight + 0.0001 ||
              (Math.abs(curWeight - bestWeight) < 0.0001 && bestSet !== null && currentSet.length > bestSet.length);

            if (isBetter) {
              bestWeight = curWeight;
              bestSet = [...currentSet];
              bestStops = route.stops;
              bestDist = route.cumulativeDistanceKm;
              bestIsMulti = route.isMultiDrop;
            }

            // Reached exact capacity
            if (Math.abs(curWeight - maxWeight) < 0.001) {
              return;
            }
          }
        }
      }

      if (curWeight >= maxWeight || idx >= otherCandidates.length) {
        return;
      }

      for (let i = idx; i < otherCandidates.length; i++) {
        const item = otherCandidates[i];
        if (curWeight + item.invQt <= maxWeight + 0.001) {
          branch(i + 1, [...currentSet, item], curWeight + item.invQt);
        }
      }
    }

    branch(0, [anchor], anchor.invQt);

    if (bestSet && Math.abs(bestWeight - maxWeight) < 0.001) {
      break;
    }
  }

  if (bestSet && bestWeight >= minWeight) {
    return {
      orders: bestSet,
      totalWeight: Math.round(bestWeight * 100) / 100,
      stops: bestStops,
      cumulativeDistanceKm: Math.round(bestDist * 100) / 100,
      isMultiDrop: bestIsMulti,
    };
  }

  return null;
}

/**
 * Finds the optimal subset of candidate orders that fills a vehicle type
 */
export function findBestSubsetForVehicle(
  candidateOrders: OrderLineItem[],
  vType: VehicleType,
  config: OptimizationConfig,
  cachedMatrix?: DistanceMatrixData | null,
  requireSameLocation: boolean = false
): BestSubsetResult | null {
  if (candidateOrders.length === 0) return null;

  const minWeight = getMinWeightForVehicle(vType, config.enabledVehicleTypes);
  const maxWeight = getMaxCapacityForVehicle(vType);

  if (requireSameLocation) {
    // Group candidate orders by location key
    const locMap = new Map<string, OrderLineItem[]>();
    for (const o of candidateOrders) {
      const locKey = `${o.dest.trim().toLowerCase()}_${o.lat.toFixed(4)}_${o.lon.toFixed(4)}`;
      if (!locMap.has(locKey)) locMap.set(locKey, []);
      locMap.get(locKey)!.push(o);
    }

    let bestResult: BestSubsetResult | null = null;

    for (const [, locOrders] of locMap.entries()) {
      const result = searchOptimalSubset(locOrders, minWeight, maxWeight, config.maxMultiDropRadiusKm, cachedMatrix, true);
      if (result) {
        if (!bestResult || result.totalWeight > bestResult.totalWeight || (Math.abs(result.totalWeight - bestResult.totalWeight) < 0.001 && result.orders.length > bestResult.orders.length)) {
          bestResult = result;
        }
      }
    }

    return bestResult;
  }

  return searchOptimalSubset(candidateOrders, minWeight, maxWeight, config.maxMultiDropRadiusKm, cachedMatrix, false);
}

/**
 * Script 2: Optimization Engine
 */
export async function runPayloadAndRouteOptimization(
  rawOrders: OrderLineItem[],
  config: OptimizationConfig,
  cachedMatrix?: DistanceMatrixData | null,
  onProgress?: OptimizationProgressCallback
): Promise<OptimizationResult> {
  const logs: ExecutionLog[] = [];
  const log = (step: string, message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    logs.push({
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toLocaleTimeString(),
      step,
      message,
      type,
    });
  };

  log('Initialization', `Starting optimization for ${rawOrders.length} order lines with SLA window ${config.slaWindowHours}h and max multi-drop radius ${config.maxMultiDropRadiusKm} km`, 'info');

  onProgress?.({
    percent: 10,
    step: 'File read successfully. Computing order SLA windows & shift boundaries...',
    processedCount: 0,
    totalCount: rawOrders.length,
  });

  // Step 1: Compute SLA for each order
  const orders: OrderLineItem[] = rawOrders.map((o) => {
    const sla = calculateOrderSla(
      o.soPoDate,
      o.soStoCreationTime,
      config.slaWindowHours,
      config.shiftStartTime,
      config.shiftEndTime
    );
    return {
      ...o,
      calculatedSla: sla,
    };
  });

  log('SLA Computation', `SLA timers calculated for operational shift ${config.shiftStartTime} - ${config.shiftEndTime} with EOD rollover support`, 'info');

  onProgress?.({
    percent: 25,
    step: '20% of data processed: Evaluating SLA windows & dealer groupings...',
    processedCount: Math.round(orders.length * 0.25),
    totalCount: orders.length,
  });

  // Array to collect all valid vehicle dispatch batches
  const dispatchedBatches: VehicleDispatchBatch[] = [];
  const remainingOrderIds = new Set<string | number>(orders.map((o) => o.id));

  // Helper to remove assigned orders
  const markOrdersAssigned = (batchOrders: OrderLineItem[], vehicleId: string, vehicleType: VehicleType, reason: string, priority: 'Priority I' | 'Priority II' | 'Priority III') => {
    for (const o of batchOrders) {
      remainingOrderIds.delete(o.id);
      o.vehicleTypeAllotted = vehicleType;
      o.vehicleId = vehicleId;
      o.allocationReason = reason;
      o.priorityCategory = priority;
    }
  };

  // Tracking vehicle type counters
  const vehicleCounters: Record<VehicleType, number> = {
    '25': 0,
    '30': 0,
    '35': 0,
  };

  const getNextVehicleId = (type: VehicleType): string => {
    vehicleCounters[type]++;
    return `${type}MT_${vehicleCounters[type]}`;
  };

  // Enabled vehicle types sorted descending (35 MT -> 30 MT -> 25 MT)
  // Ensures single larger vehicle is always prioritized over multiple smaller ones
  const sortedVehicleTypes = (['35', '30', '25'] as VehicleType[]).filter((t) =>
    config.enabledVehicleTypes.includes(t)
  );

  // =========================================================================
  // DEALER-LEVEL OPTIMIZATION (Priority I & Priority II with Vehicle Size Priority)
  //
  // For each vehicle type in descending order (35 MT -> 30 MT -> 25 MT):
  //   1. Check Priority I (Same Dealer, Same Location) for eligible shipments
  //   2. Check Priority II (Same Dealer, Multi-Drop within radius) for eligible shipments
  //
  // This guarantees:
  // - A single larger vehicle (e.g. 35MT / 30MT) is always preferred over smaller vehicles (25MT)
  // - Multi-item orders (e.g. 15+5+5=25 MT, 20+10=30 MT, 20+14=34 MT) maximize payload capacity
  // - Priority I single-drop is preferred over Priority II multi-drop within the SAME vehicle class
  // =========================================================================
  log('Priority I & II', 'Evaluating dealer-level groupings (35MT -> 30MT -> 25MT)...', 'info');

  for (const vType of sortedVehicleTypes) {
    const maxCap = getMaxCapacityForVehicle(vType);

    // 1. Try Priority I (Same Dealer, Same Location) for this vehicle type
    let p1Found = true;
    let p1Guard = 0;
    while (p1Found && p1Guard < 100) {
      p1Guard++;
      p1Found = false;

      // Group unassigned by dealer
      const dealerMap = new Map<string, OrderLineItem[]>();
      for (const o of orders) {
        if (!remainingOrderIds.has(o.id)) continue;
        const dealer = o.soldToParty.trim();
        if (!dealerMap.has(dealer)) dealerMap.set(dealer, []);
        dealerMap.get(dealer)!.push(o);
      }

      for (const [dealer, dOrders] of dealerMap.entries()) {
        const best = findBestSubsetForVehicle(dOrders, vType, config, cachedMatrix, true);
        if (best) {
          const vId = getNextVehicleId(vType);
          dispatchedBatches.push({
            vehicleId: vId,
            vehicleType: vType,
            capacityMT: maxCap,
            totalWeightMT: best.totalWeight,
            utilizationPercent: Math.round((best.totalWeight / maxCap) * 1000) / 10,
            priorityGroup: 'Priority I',
            dealerId: dealer,
            orders: best.orders,
            stops: best.stops,
            cumulativeMultiDropDistanceKm: best.cumulativeDistanceKm,
            slaEarliestExpiry: new Date(Math.min(...best.orders.map((o) => o.calculatedSla?.expiryTimestamp ?? Infinity))).toLocaleTimeString(),
            slaLatestStart: new Date(Math.max(...best.orders.map((o) => o.calculatedSla?.effectiveStartTimestamp ?? 0))).toLocaleTimeString(),
            isMultiDrop: best.isMultiDrop,
          });

          markOrdersAssigned(best.orders, vId, vType, `Allocated via Priority I (${vType}MT Same Location)`, 'Priority I');
          p1Found = true;
          break; // break to re-evaluate dealerMap with updated remaining orders
        }
      }
    }

    // 2. Try Priority II (Same Dealer, Multi-Drop Locations) for this vehicle type
    let p2Found = true;
    let p2Guard = 0;
    while (p2Found && p2Guard < 100) {
      p2Guard++;
      p2Found = false;

      const dealerMap = new Map<string, OrderLineItem[]>();
      for (const o of orders) {
        if (!remainingOrderIds.has(o.id)) continue;
        const dealer = o.soldToParty.trim();
        if (!dealerMap.has(dealer)) dealerMap.set(dealer, []);
        dealerMap.get(dealer)!.push(o);
      }

      for (const [dealer, dOrders] of dealerMap.entries()) {
        if (dOrders.length <= 1) continue;

        const best = findBestSubsetForVehicle(dOrders, vType, config, cachedMatrix, false);
        if (best) {
          const vId = getNextVehicleId(vType);
          dispatchedBatches.push({
            vehicleId: vId,
            vehicleType: vType,
            capacityMT: maxCap,
            totalWeightMT: best.totalWeight,
            utilizationPercent: Math.round((best.totalWeight / maxCap) * 1000) / 10,
            priorityGroup: 'Priority II',
            dealerId: dealer,
            orders: best.orders,
            stops: best.stops,
            cumulativeMultiDropDistanceKm: best.cumulativeDistanceKm,
            slaEarliestExpiry: new Date(Math.min(...best.orders.map((o) => o.calculatedSla?.expiryTimestamp ?? Infinity))).toLocaleTimeString(),
            slaLatestStart: new Date(Math.max(...best.orders.map((o) => o.calculatedSla?.effectiveStartTimestamp ?? 0))).toLocaleTimeString(),
            isMultiDrop: best.isMultiDrop,
          });

          markOrdersAssigned(best.orders, vId, vType, `Allocated via Priority II (${vType}MT Same Dealer Multi-Drop)`, 'Priority II');
          p2Found = true;
          break;
        }
      }
    }
  }

  log('Priority I & II Completed', `Priority I & II allocated ${dispatchedBatches.length} shipments. Remaining orders: ${remainingOrderIds.size}`, 'info');

  onProgress?.({
    percent: 75,
    step: '75% of data processed: Evaluating Priority III (Cross-Dealer Multi-Drop)...',
    processedCount: orders.length - remainingOrderIds.size,
    totalCount: orders.length,
  });

  // =========================================================================
  // PHASE 3: Priority III Grouping (Cross-Dealer Multi-Drop)
  // Evaluates 35 MT -> 30 MT -> 25 MT across all remaining unassigned orders
  // =========================================================================
  log('Priority III', 'Evaluating Priority III: Cross-Dealer multi-drop route optimization (35MT -> 30MT -> 25MT)...', 'info');

  for (const vType of sortedVehicleTypes) {
    const maxCap = getMaxCapacityForVehicle(vType);
    let p3Found = true;
    let p3Guard = 0;

    while (p3Found && p3Guard < 100) {
      p3Guard++;
      p3Found = false;

      const currentUnassigned = orders.filter((o) => remainingOrderIds.has(o.id));
      if (currentUnassigned.length <= 1) break;

      const best = findBestSubsetForVehicle(currentUnassigned, vType, config, cachedMatrix, false);
      if (best) {
        const vId = getNextVehicleId(vType);
        dispatchedBatches.push({
          vehicleId: vId,
          vehicleType: vType,
          capacityMT: maxCap,
          totalWeightMT: best.totalWeight,
          utilizationPercent: Math.round((best.totalWeight / maxCap) * 1000) / 10,
          priorityGroup: 'Priority III',
          dealerId: 'Multi-Dealer',
          orders: best.orders,
          stops: best.stops,
          cumulativeMultiDropDistanceKm: best.cumulativeDistanceKm,
          slaEarliestExpiry: new Date(Math.min(...best.orders.map((o) => o.calculatedSla?.expiryTimestamp ?? Infinity))).toLocaleTimeString(),
          slaLatestStart: new Date(Math.max(...best.orders.map((o) => o.calculatedSla?.effectiveStartTimestamp ?? 0))).toLocaleTimeString(),
          isMultiDrop: best.isMultiDrop,
        });

        markOrdersAssigned(best.orders, vId, vType, `Allocated via Priority III (${vType}MT Cross-Dealer Multi-Drop)`, 'Priority III');
        p3Found = true;
      }
    }
  }

  // ==========================================
  // PHASE 4: Depot Backlog (NA)
  // ==========================================
  const backlogOrders: OrderLineItem[] = [];
  for (const o of orders) {
    if (remainingOrderIds.has(o.id)) {
      o.vehicleTypeAllotted = 'NA';
      o.vehicleId = 'NA';
      o.priorityCategory = 'Unassigned';
      o.allocationReason = o.invQt < 20
        ? `Weight (${o.invQt} MT) below 80% threshold of smallest vehicle (20 MT) and could not be combined within multi-drop constraints / SLA window.`
        : `Could not be grouped into an eligible vehicle with >80% utilization without violating SLA or max distance.`;
      backlogOrders.push(o);
    }
  }

  log('Backlog Finalized', `${backlogOrders.length} orders routed to Depot Backlog (NA).`, backlogOrders.length > 0 ? 'warning' : 'success');

  onProgress?.({
    percent: 95,
    step: 'Finalizing Vehicle Allocations and KPI summary...',
    processedCount: orders.length,
    totalCount: orders.length,
  });

  // Calculate Summary Statistics
  const totalWeightMT = Math.round(orders.reduce((s, o) => s + o.invQt, 0) * 100) / 100;
  const dispatchedWeightMT = Math.round(dispatchedBatches.reduce((s, b) => s + b.totalWeightMT, 0) * 100) / 100;
  const backlogWeightMT = Math.round(backlogOrders.reduce((s, o) => s + o.invQt, 0) * 100) / 100;

  const fleet25Count = vehicleCounters['25'];
  const fleet30Count = vehicleCounters['30'];
  const fleet35Count = vehicleCounters['35'];
  const totalFleetExecuted = fleet25Count + fleet30Count + fleet35Count;

  const avgUtil = dispatchedBatches.length > 0
    ? Math.round((dispatchedBatches.reduce((s, b) => s + b.utilizationPercent, 0) / dispatchedBatches.length) * 10) / 10
    : 0;

  const summary = {
    fleet25Count,
    fleet30Count,
    fleet35Count,
    totalFleetExecuted,
    totalOrders: orders.length,
    dispatchedOrdersCount: orders.length - backlogOrders.length,
    backlogOrdersCount: backlogOrders.length,
    totalWeightMT,
    dispatchedWeightMT,
    backlogWeightMT,
    averageUtilizationPercent: avgUtil,
  };

  log('Optimization Completed', `Dispatched ${totalFleetExecuted} total vehicles with ${avgUtil}% average payload utilization. Dispatched ${summary.dispatchedOrdersCount}/${orders.length} orders.`, 'success');

  onProgress?.({
    percent: 100,
    step: 'Optimization Completed Successfully!',
    processedCount: orders.length,
    totalCount: orders.length,
  });

  return {
    orders,
    dispatchedBatches,
    backlogOrders,
    summary,
    logs,
    completedAt: new Date().toISOString(),
  };
}
