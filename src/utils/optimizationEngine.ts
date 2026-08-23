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
 * Determines the exact, intrinsic priority allocation of an allocated vehicle shipment batch:
 * - Priority I: Single Dealer + Single Destination (Direct FTL or clubbed orders at same location)
 * - Priority II: Single Dealer + Multi-Drop Destinations (Same dealer across multiple locations within permissible radius)
 * - Priority III: Cross-Dealer Multi-Drop (Clubbed orders across different dealers within permissible radius)
 */
export function determineBatchPriority(orders: OrderLineItem[]): 'Priority I' | 'Priority II' | 'Priority III' {
  const uniqueDealers = new Set(orders.map((o) => (o.soldToParty || '').trim().toLowerCase()));
  const uniqueDestKeys = new Set(
    orders.map((o) => `${(o.dest || '').trim().toLowerCase()}_${o.lat.toFixed(4)}_${o.lon.toFixed(4)}`)
  );

  if (uniqueDealers.size <= 1 && uniqueDestKeys.size <= 1) {
    return 'Priority I';
  } else if (uniqueDealers.size <= 1 && uniqueDestKeys.size > 1) {
    return 'Priority II';
  } else {
    return 'Priority III';
  }
}

/**
 * Returns the minimum threshold required for a vehicle type to satisfy the configured min utilization %
 */
export function getMinWeightForVehicle(type: VehicleType, minUtilizationPercent: number = 80): number {
  const cap = getMaxCapacityForVehicle(type);
  const ratio = Math.max(0.1, Math.min(1.0, (minUtilizationPercent || 80) / 100));
  return Math.round(cap * ratio * 100) / 100;
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
 * Finds the single best vehicle type that fits weight and achieves target min utilization,
 * strictly prioritizing a single larger vehicle over multiple smaller ones.
 */
export function selectBestVehicleForWeight(
  weight: number,
  enabledTypes: VehicleType[],
  minUtilizationPercent: number = 80
): VehicleType | null {
  const sortedEnabled = [...enabledTypes].sort((a, b) => parseInt(b, 10) - parseInt(a, 10));

  // Priority: 35 MT > 30 MT > 25 MT
  for (const type of sortedEnabled) {
    const maxCap = getMaxCapacityForVehicle(type);
    const minCap = getMinWeightForVehicle(type, minUtilizationPercent);

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

export interface VehicleAllocationPlan {
  vehicleType: VehicleType;
  bestSubset: BestSubsetResult;
}

export interface FeasibleVehicleLoad {
  vehicleType: VehicleType;
  orders: OrderLineItem[];
  totalWeight: number;
  utilization: number;
  stops: RouteStop[];
  cumulativeDistanceKm: number;
  isMultiDrop: boolean;
  orderIds: Set<string | number>;
}

/**
 * Finds all valid feasible vehicle loads for candidate orders across all enabled vehicle types.
 */
export function findAllFeasibleLoads(
  orders: OrderLineItem[],
  enabledVehicleTypes: VehicleType[],
  config: OptimizationConfig,
  cachedMatrix?: DistanceMatrixData | null,
  sameLocationOnly: boolean = false
): FeasibleVehicleLoad[] {
  if (orders.length === 0) return [];

  const results: FeasibleVehicleLoad[] = [];
  const seenCombos = new Set<string>();

  const sortedTypes = (['35', '30', '25'] as VehicleType[]).filter((t) =>
    enabledVehicleTypes.includes(t)
  );

  // Group by location if sameLocationOnly is true
  if (sameLocationOnly) {
    const locMap = new Map<string, OrderLineItem[]>();
    for (const o of orders) {
      const locKey = `${o.dest.trim().toLowerCase()}_${o.lat.toFixed(4)}_${o.lon.toFixed(4)}`;
      if (!locMap.has(locKey)) locMap.set(locKey, []);
      locMap.get(locKey)!.push(o);
    }

    for (const [, locOrders] of locMap.entries()) {
      if (locOrders.length === 0) continue;
      const sortedLocOrders = [...locOrders].sort((a, b) => b.invQt - a.invQt);

      for (const vType of sortedTypes) {
        const minWeight = getMinWeightForVehicle(vType, config.minUtilizationPercent ?? 80);
        const maxWeight = getMaxCapacityForVehicle(vType);

        function branchSameLoc(idx: number, curSet: OrderLineItem[], curWeight: number) {
          if (curWeight >= minWeight && curWeight <= maxWeight + 0.0001) {
            if (doOrdersOverlapSla(curSet)) {
              const comboKey = `${vType}_${curSet.map((o) => o.id).sort().join(',')}`;
              if (!seenCombos.has(comboKey)) {
                seenCombos.add(comboKey);
                const route = buildRouteStops(curSet, cachedMatrix);
                results.push({
                  vehicleType: vType,
                  orders: curSet,
                  totalWeight: Math.round(curWeight * 100) / 100,
                  utilization: curWeight / maxWeight,
                  stops: route.stops,
                  cumulativeDistanceKm: route.cumulativeDistanceKm,
                  isMultiDrop: route.isMultiDrop,
                  orderIds: new Set(curSet.map((o) => o.id)),
                });
              }
            }
          }

          if (curWeight >= maxWeight || idx >= sortedLocOrders.length) return;

          for (let i = idx; i < sortedLocOrders.length; i++) {
            const item = sortedLocOrders[i];
            if (curWeight + item.invQt <= maxWeight + 0.001) {
              branchSameLoc(i + 1, [...curSet, item], curWeight + item.invQt);
            }
          }
        }

        branchSameLoc(0, [], 0);
      }
    }

    return results;
  }

  // Multi-drop / general proximity
  const sorted = [...orders].sort((a, b) => b.invQt - a.invQt);

  for (let aIdx = 0; aIdx < sorted.length; aIdx++) {
    const anchor = sorted[aIdx];
    const candidatePool = sorted.filter((o) => {
      if (o.id === anchor.id) return true;
      const d = getDistanceBetweenPoints(anchor.lat, anchor.lon, o.lat, o.lon, cachedMatrix);
      return d <= config.maxMultiDropRadiusKm;
    });

    const otherCandidates = candidatePool.filter((o) => o.id !== anchor.id);

    for (const vType of sortedTypes) {
      const minWeight = getMinWeightForVehicle(vType, config.minUtilizationPercent ?? 80);
      const maxWeight = getMaxCapacityForVehicle(vType);

      function branchMulti(idx: number, curSet: OrderLineItem[], curWeight: number) {
        if (curWeight >= minWeight && curWeight <= maxWeight + 0.0001) {
          if (doOrdersOverlapSla(curSet)) {
            const route = buildRouteStops(curSet, cachedMatrix);
            if (route.cumulativeDistanceKm <= config.maxMultiDropRadiusKm) {
              const comboKey = `${vType}_${curSet.map((o) => o.id).sort().join(',')}`;
              if (!seenCombos.has(comboKey)) {
                seenCombos.add(comboKey);
                results.push({
                  vehicleType: vType,
                  orders: curSet,
                  totalWeight: Math.round(curWeight * 100) / 100,
                  utilization: curWeight / maxWeight,
                  stops: route.stops,
                  cumulativeDistanceKm: route.cumulativeDistanceKm,
                  isMultiDrop: route.isMultiDrop,
                  orderIds: new Set(curSet.map((o) => o.id)),
                });
              }
            }
          }
        }

        if (curWeight >= maxWeight || idx >= otherCandidates.length) return;

        for (let i = idx; i < otherCandidates.length; i++) {
          const item = otherCandidates[i];
          if (curWeight + item.invQt <= maxWeight + 0.001) {
            branchMulti(i + 1, [...curSet, item], curWeight + item.invQt);
          }
        }
      }

      if (anchor.invQt <= maxWeight) {
        branchMulti(0, [anchor], anchor.invQt);
      }
    }
  }

  return results;
}

/**
 * Finds the optimal subset of candidate orders that fills a single vehicle type
 */
export function findBestSubsetForVehicle(
  candidateOrders: OrderLineItem[],
  vType: VehicleType,
  config: OptimizationConfig,
  cachedMatrix?: DistanceMatrixData | null,
  requireSameLocation: boolean = false
): BestSubsetResult | null {
  if (candidateOrders.length === 0) return null;

  const minWeight = getMinWeightForVehicle(vType, config.minUtilizationPercent ?? 80);
  const maxWeight = getMaxCapacityForVehicle(vType);

  if (requireSameLocation) {
    const locMap = new Map<string, OrderLineItem[]>();
    for (const o of candidateOrders) {
      const locKey = `${o.dest.trim().toLowerCase()}_${o.lat.toFixed(4)}_${o.lon.toFixed(4)}`;
      if (!locMap.has(locKey)) locMap.set(locKey, []);
      locMap.get(locKey)!.push(o);
    }

    let bestResult: BestSubsetResult | null = null;

    for (const [, locOrders] of locMap.entries()) {
      const result = searchOptimalSubset(
        locOrders,
        minWeight,
        maxWeight,
        config.maxMultiDropRadiusKm,
        cachedMatrix,
        true
      );
      if (result) {
        if (
          !bestResult ||
          result.totalWeight > bestResult.totalWeight ||
          (Math.abs(result.totalWeight - bestResult.totalWeight) < 0.001 &&
            result.orders.length > bestResult.orders.length)
        ) {
          bestResult = result;
        }
      }
    }

    return bestResult;
  }

  return searchOptimalSubset(
    candidateOrders,
    minWeight,
    maxWeight,
    config.maxMultiDropRadiusKm,
    cachedMatrix,
    false
  );
}

/**
 * Searches for an optimal global partition of candidate orders into one or more vehicles.
 * Instead of greedily picking one vehicle (e.g. 50MT -> 35MT + 15MT orphan),
 * this evaluates all mutually disjoint feasible multi-vehicle combinations (e.g. 50MT -> 25MT + 25MT = 50MT 100% assigned, 0 backlog)
 * to maximize total assigned weight and payload utilization.
 */
export function findOptimalMultiVehiclePartition(
  candidateOrders: OrderLineItem[],
  enabledVehicleTypes: VehicleType[],
  config: OptimizationConfig,
  cachedMatrix?: DistanceMatrixData | null,
  requireSameLocation: boolean = false,
  maxDepth: number = 4
): VehicleAllocationPlan[] | null {
  if (candidateOrders.length === 0) return null;

  const feasibleLoads = findAllFeasibleLoads(
    candidateOrders,
    enabledVehicleTypes,
    config,
    cachedMatrix,
    requireSameLocation
  );

  if (feasibleLoads.length === 0) return null;

  // Sort loads: prioritize high utilization, high weight, and larger vehicle types
  feasibleLoads.sort((a, b) => {
    if (Math.abs(b.totalWeight - a.totalWeight) > 0.001) return b.totalWeight - a.totalWeight;
    if (Math.abs(b.utilization - a.utilization) > 0.001) return b.utilization - a.utilization;
    return parseInt(b.vehicleType, 10) - parseInt(a.vehicleType, 10);
  });

  let bestSelectedLoads: FeasibleVehicleLoad[] | null = null;
  let maxAssignedWeight = 0;
  let bestAvgUtil = 0;

  function evaluateCandidatePartition(selectedLoads: FeasibleVehicleLoad[]) {
    if (selectedLoads.length === 0) return;

    const totalWeight = Math.round(
      selectedLoads.reduce((sum, l) => sum + l.totalWeight, 0) * 100
    ) / 100;
    const avgUtil =
      selectedLoads.reduce((sum, l) => sum + l.utilization, 0) / selectedLoads.length;

    // Better plan if:
    // 1. Assigns strictly more weight (fewer backlog tons)
    // 2. Or same weight, but higher average vehicle capacity utilization
    // 3. Or same weight and util, but fewer total vehicles (larger vehicles preferred)
    const isBetter =
      totalWeight > maxAssignedWeight + 0.001 ||
      (Math.abs(totalWeight - maxAssignedWeight) <= 0.001 &&
        (avgUtil > bestAvgUtil + 0.001 ||
          (Math.abs(avgUtil - bestAvgUtil) <= 0.001 &&
            bestSelectedLoads !== null &&
            selectedLoads.length < bestSelectedLoads.length)));

    if (isBetter) {
      maxAssignedWeight = totalWeight;
      bestAvgUtil = avgUtil;
      bestSelectedLoads = [...selectedLoads];
    }
  }

  // Recursive exact disjoint search
  function searchDisjoint(
    startIndex: number,
    usedOrderIds: Set<string | number>,
    currentLoads: FeasibleVehicleLoad[],
    depth: number
  ) {
    evaluateCandidatePartition(currentLoads);

    if (depth >= maxDepth || startIndex >= feasibleLoads.length) {
      return;
    }

    for (let i = startIndex; i < feasibleLoads.length; i++) {
      const candidate = feasibleLoads[i];

      // Check if candidate load is disjoint from currently selected loads
      let hasOverlap = false;
      for (const orderId of candidate.orderIds) {
        if (usedOrderIds.has(orderId)) {
          hasOverlap = true;
          break;
        }
      }

      if (!hasOverlap) {
        const nextUsed = new Set(usedOrderIds);
        for (const orderId of candidate.orderIds) {
          nextUsed.add(orderId);
        }

        searchDisjoint(i + 1, nextUsed, [...currentLoads, candidate], depth + 1);
      }
    }
  }

  searchDisjoint(0, new Set(), [], 0);

  if (!bestSelectedLoads || bestSelectedLoads.length === 0) {
    return null;
  }

  return bestSelectedLoads.map((load) => ({
    vehicleType: load.vehicleType,
    bestSubset: {
      orders: load.orders,
      totalWeight: load.totalWeight,
      stops: load.stops,
      cumulativeDistanceKm: load.cumulativeDistanceKm,
      isMultiDrop: load.isMultiDrop,
    },
  }));
}

/**
 * Tops up any allocated vehicle batches that have spare capacity (< 100% utilization)
 * with unassigned orders that satisfy SLA and cluster radius constraints (prioritizing same destination).
 */
export function topUpBatchesWithRemainingOrders(
  dispatchedBatches: VehicleDispatchBatch[],
  orders: OrderLineItem[],
  remainingOrderIds: Set<string | number>,
  config: OptimizationConfig,
  cachedMatrix?: DistanceMatrixData | null,
  markOrdersAssigned?: (
    batchOrders: OrderLineItem[],
    vehicleId: string,
    vehicleType: VehicleType,
    reason: string,
    priority: 'Priority I' | 'Priority II' | 'Priority III'
  ) => void
): number {
  let toppedUpCount = 0;

  for (const batch of dispatchedBatches) {
    let spareCapacity = Math.round((batch.capacityMT - batch.totalWeightMT) * 100) / 100;
    if (spareCapacity < 0.1) continue;

    // Filter candidate unassigned orders that can fit in spare capacity
    const unassignedOrders = orders.filter(
      (o) => remainingOrderIds.has(o.id) && o.invQt <= spareCapacity + 0.001
    );
    if (unassignedOrders.length === 0) continue;

    const firstStop = batch.stops[0] || { lat: batch.orders[0]?.lat || 0, lon: batch.orders[0]?.lon || 0 };

    // Sort candidates:
    // 1. Same destination as an existing stop in this vehicle (0 km extra detour)
    // 2. Closest proximity to the vehicle's stops
    // 3. Highest weight to maximize fill rate
    unassignedOrders.sort((a, b) => {
      const aSameLoc = batch.orders.some(
        (bo) => bo.dest.trim().toLowerCase() === a.dest.trim().toLowerCase()
      );
      const bSameLoc = batch.orders.some(
        (bo) => bo.dest.trim().toLowerCase() === b.dest.trim().toLowerCase()
      );
      if (aSameLoc && !bSameLoc) return -1;
      if (!aSameLoc && bSameLoc) return 1;

      const distA = getDistanceBetweenPoints(firstStop.lat, firstStop.lon, a.lat, a.lon, cachedMatrix);
      const distB = getDistanceBetweenPoints(firstStop.lat, firstStop.lon, b.lat, b.lon, cachedMatrix);
      if (Math.abs(distA - distB) > 0.1) return distA - distB;

      return b.invQt - a.invQt;
    });

    const ordersToAdd: OrderLineItem[] = [];

    for (const cand of unassignedOrders) {
      if (cand.invQt > spareCapacity + 0.001) continue;

      const proposedSet = [...batch.orders, ...ordersToAdd, cand];
      if (!doOrdersOverlapSla(proposedSet)) continue;

      const route = buildRouteStops(proposedSet, cachedMatrix);
      if (route.cumulativeDistanceKm <= config.maxMultiDropRadiusKm) {
        ordersToAdd.push(cand);
        spareCapacity = Math.round((spareCapacity - cand.invQt) * 100) / 100;
      }
    }

    if (ordersToAdd.length > 0) {
      batch.orders.push(...ordersToAdd);
      batch.totalWeightMT = Math.round(batch.orders.reduce((sum, o) => sum + o.invQt, 0) * 100) / 100;
      batch.utilizationPercent = Math.round((batch.totalWeightMT / batch.capacityMT) * 1000) / 10;

      const newRoute = buildRouteStops(batch.orders, cachedMatrix);
      batch.stops = newRoute.stops;
      batch.cumulativeMultiDropDistanceKm = newRoute.cumulativeDistanceKm;
      batch.isMultiDrop = newRoute.isMultiDrop;
      batch.priorityGroup = determineBatchPriority(batch.orders);
      batch.dealerId =
        batch.priorityGroup === 'Priority III'
          ? 'Multi-Dealer'
          : batch.orders[0]?.soldToParty || 'Single-Dealer';

      if (markOrdersAssigned) {
        markOrdersAssigned(
          ordersToAdd,
          batch.vehicleId,
          batch.vehicleType,
          `Topped-up load to ${batch.utilizationPercent}% utilization (${batch.vehicleType}MT Vehicle)`,
          batch.priorityGroup
        );
      }

      toppedUpCount += ordersToAdd.length;
    }
  }

  return toppedUpCount;
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
  // PHASE 1: Priority I Multi-Vehicle Partitioning (Same Dealer, Same Location)
  //
  // Evaluates dealer orders at each location using optimal global partition planning.
  // Example: 50 MT at a single location is partitioned into 2x 25MT trucks (100% fill rate, 0 backlog)
  // instead of a greedy 35MT truck leaving 15 MT orphaned.
  // =========================================================================
  log('Priority I', 'Evaluating Priority I with multi-vehicle partition planning (Same Dealer, Same Location)...', 'info');

  let p1Found = true;
  let p1Guard = 0;
  while (p1Found && p1Guard < 100) {
    p1Guard++;
    p1Found = false;

    // Group remaining unassigned by dealer
    const dealerMap = new Map<string, OrderLineItem[]>();
    for (const o of orders) {
      if (!remainingOrderIds.has(o.id)) continue;
      const dealer = o.soldToParty.trim();
      if (!dealerMap.has(dealer)) dealerMap.set(dealer, []);
      dealerMap.get(dealer)!.push(o);
    }

    for (const [dealer, dOrders] of dealerMap.entries()) {
      // Group by location
      const locMap = new Map<string, OrderLineItem[]>();
      for (const o of dOrders) {
        const locKey = `${o.dest.trim().toLowerCase()}_${o.lat.toFixed(4)}_${o.lon.toFixed(4)}`;
        if (!locMap.has(locKey)) locMap.set(locKey, []);
        locMap.get(locKey)!.push(o);
      }

      for (const [, locOrders] of locMap.entries()) {
        const plan = findOptimalMultiVehiclePartition(locOrders, sortedVehicleTypes, config, cachedMatrix, true);
        if (plan && plan.length > 0) {
          for (const item of plan) {
            const vType = item.vehicleType;
            const maxCap = getMaxCapacityForVehicle(vType);
            const best = item.bestSubset;
            const vId = getNextVehicleId(vType);
            const priority = determineBatchPriority(best.orders);

            dispatchedBatches.push({
              vehicleId: vId,
              vehicleType: vType,
              capacityMT: maxCap,
              totalWeightMT: best.totalWeight,
              utilizationPercent: Math.round((best.totalWeight / maxCap) * 1000) / 10,
              priorityGroup: priority,
              dealerId: dealer,
              orders: best.orders,
              stops: best.stops,
              cumulativeMultiDropDistanceKm: best.cumulativeDistanceKm,
              slaEarliestExpiry: new Date(
                Math.min(...best.orders.map((o) => o.calculatedSla?.expiryTimestamp ?? Infinity))
              ).toLocaleTimeString(),
              slaLatestStart: new Date(
                Math.max(...best.orders.map((o) => o.calculatedSla?.effectiveStartTimestamp ?? 0))
              ).toLocaleTimeString(),
              isMultiDrop: best.isMultiDrop,
            });

            markOrdersAssigned(
              best.orders,
              vId,
              vType,
              `Allocated via ${priority} (${vType}MT Same Location)`,
              priority
            );
          }
          p1Found = true;
          break;
        }
      }
      if (p1Found) break;
    }
  }

  // =========================================================================
  // PHASE 2: Priority II Multi-Vehicle Partitioning (Same Dealer, Multi-Drop)
  // =========================================================================
  log('Priority II', 'Evaluating Priority II with multi-vehicle partition planning (Same Dealer, Multi-Drop)...', 'info');

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

      const plan = findOptimalMultiVehiclePartition(dOrders, sortedVehicleTypes, config, cachedMatrix, false);
      if (plan && plan.length > 0) {
        for (const item of plan) {
          const vType = item.vehicleType;
          const maxCap = getMaxCapacityForVehicle(vType);
          const best = item.bestSubset;
          const vId = getNextVehicleId(vType);
          const priority = determineBatchPriority(best.orders);

          dispatchedBatches.push({
            vehicleId: vId,
            vehicleType: vType,
            capacityMT: maxCap,
            totalWeightMT: best.totalWeight,
            utilizationPercent: Math.round((best.totalWeight / maxCap) * 1000) / 10,
            priorityGroup: priority,
            dealerId: dealer,
            orders: best.orders,
            stops: best.stops,
            cumulativeMultiDropDistanceKm: best.cumulativeDistanceKm,
            slaEarliestExpiry: new Date(
              Math.min(...best.orders.map((o) => o.calculatedSla?.expiryTimestamp ?? Infinity))
            ).toLocaleTimeString(),
            slaLatestStart: new Date(
              Math.max(...best.orders.map((o) => o.calculatedSla?.effectiveStartTimestamp ?? 0))
            ).toLocaleTimeString(),
            isMultiDrop: best.isMultiDrop,
          });

          markOrdersAssigned(
            best.orders,
            vId,
            vType,
            `Allocated via ${priority} (${vType}MT Same Dealer Multi-Drop)`,
            priority
          );
        }
        p2Found = true;
        break;
      }
    }
  }

  log('Priority I & II Completed', `Priority I & II allocated ${dispatchedBatches.length} shipments. Remaining orders: ${remainingOrderIds.size}`, 'info');

  onProgress?.({
    percent: 70,
    step: '70% of data processed: Evaluating Priority III (Cross-Dealer Multi-Drop)...',
    processedCount: orders.length - remainingOrderIds.size,
    totalCount: orders.length,
  });

  // =========================================================================
  // PHASE 3: Priority III Grouping (Cross-Dealer Same Location & Multi-Drop)
  // Evaluates optimal multi-vehicle partitions across all remaining unassigned orders
  // =========================================================================
  log('Priority III', 'Evaluating Priority III: Cross-Dealer same-location & multi-drop route optimization...', 'info');

  // Stage 3A: Same-Location Cross-Dealer Clubbing
  // Group all unassigned orders across all dealers by destination and allocate optimal partitions
  let p3aFound = true;
  let p3aGuard = 0;
  while (p3aFound && p3aGuard < 200) {
    p3aGuard++;
    p3aFound = false;

    const locMap = new Map<string, OrderLineItem[]>();
    for (const o of orders) {
      if (!remainingOrderIds.has(o.id)) continue;
      const locKey = `${o.dest.trim().toLowerCase()}_${o.lat.toFixed(4)}_${o.lon.toFixed(4)}`;
      if (!locMap.has(locKey)) locMap.set(locKey, []);
      locMap.get(locKey)!.push(o);
    }

    for (const [, locOrders] of locMap.entries()) {
      if (locOrders.length === 0) continue;
      const plan = findOptimalMultiVehiclePartition(locOrders, sortedVehicleTypes, config, cachedMatrix, true);
      if (plan && plan.length > 0) {
        for (const item of plan) {
          const vType = item.vehicleType;
          const maxCap = getMaxCapacityForVehicle(vType);
          const best = item.bestSubset;
          const vId = getNextVehicleId(vType);
          const priority = determineBatchPriority(best.orders);
          dispatchedBatches.push({
            vehicleId: vId,
            vehicleType: vType,
            capacityMT: maxCap,
            totalWeightMT: best.totalWeight,
            utilizationPercent: Math.round((best.totalWeight / maxCap) * 1000) / 10,
            priorityGroup: priority,
            dealerId: priority === 'Priority III' ? 'Multi-Dealer' : (best.orders[0]?.soldToParty || 'Single-Dealer'),
            orders: best.orders,
            stops: best.stops,
            cumulativeMultiDropDistanceKm: best.cumulativeDistanceKm,
            slaEarliestExpiry: new Date(
              Math.min(...best.orders.map((o) => o.calculatedSla?.expiryTimestamp ?? Infinity))
            ).toLocaleTimeString(),
            slaLatestStart: new Date(
              Math.max(...best.orders.map((o) => o.calculatedSla?.effectiveStartTimestamp ?? 0))
            ).toLocaleTimeString(),
            isMultiDrop: best.isMultiDrop,
          });

          markOrdersAssigned(
            best.orders,
            vId,
            vType,
            `Allocated via ${priority} (${vType}MT Same Location Cross-Dealer)`,
            priority
          );
        }
        p3aFound = true;
        break;
      }
    }
  }

  // Stage 3B: Cross-Location Multi-Drop Clubbing for remaining orders
  let p3bFound = true;
  let p3bGuard = 0;
  while (p3bFound && p3bGuard < 200) {
    p3bGuard++;
    p3bFound = false;

    const currentUnassigned = orders.filter((o) => remainingOrderIds.has(o.id));
    if (currentUnassigned.length === 0) break;

    const feasibleLoads = findAllFeasibleLoads(
      currentUnassigned,
      sortedVehicleTypes,
      config,
      cachedMatrix,
      false
    );

    if (feasibleLoads.length > 0) {
      // Pick the best feasible load (highest weight, highest utilization, larger vehicle)
      feasibleLoads.sort((a, b) => {
        if (Math.abs(b.totalWeight - a.totalWeight) > 0.001) return b.totalWeight - a.totalWeight;
        if (Math.abs(b.utilization - a.utilization) > 0.001) return b.utilization - a.utilization;
        return parseInt(b.vehicleType, 10) - parseInt(a.vehicleType, 10);
      });

      const bestLoad = feasibleLoads[0];
      const vType = bestLoad.vehicleType;
      const maxCap = getMaxCapacityForVehicle(vType);
      const vId = getNextVehicleId(vType);
      const priority = determineBatchPriority(bestLoad.orders);

      dispatchedBatches.push({
        vehicleId: vId,
        vehicleType: vType,
        capacityMT: maxCap,
        totalWeightMT: bestLoad.totalWeight,
        utilizationPercent: Math.round((bestLoad.totalWeight / maxCap) * 1000) / 10,
        priorityGroup: priority,
        dealerId: priority === 'Priority III' ? 'Multi-Dealer' : (bestLoad.orders[0]?.soldToParty || 'Single-Dealer'),
        orders: bestLoad.orders,
        stops: bestLoad.stops,
        cumulativeMultiDropDistanceKm: bestLoad.cumulativeDistanceKm,
        slaEarliestExpiry: new Date(
          Math.min(...bestLoad.orders.map((o) => o.calculatedSla?.expiryTimestamp ?? Infinity))
        ).toLocaleTimeString(),
        slaLatestStart: new Date(
          Math.max(...bestLoad.orders.map((o) => o.calculatedSla?.effectiveStartTimestamp ?? 0))
        ).toLocaleTimeString(),
        isMultiDrop: bestLoad.isMultiDrop,
      });

      markOrdersAssigned(
        bestLoad.orders,
        vId,
        vType,
        `Allocated via ${priority} (${vType}MT Multi-Drop)`,
        priority
      );

      p3bFound = true;
    }
  }

  // =========================================================================
  // PHASE 4: Under-Utilized Vehicle Top-Up Pass
  // Fills remaining spare capacity on dispatched vehicles with available unassigned orders
  // =========================================================================
  log('Top-Up Pass', 'Scanning dispatched vehicles for spare capacity top-up opportunities...', 'info');
  const toppedUpCount = topUpBatchesWithRemainingOrders(
    dispatchedBatches,
    orders,
    remainingOrderIds,
    config,
    cachedMatrix,
    markOrdersAssigned
  );

  if (toppedUpCount > 0) {
    log('Top-Up Completed', `Successfully topped up ${toppedUpCount} order lines onto under-utilized vehicles to increase payload utilization.`, 'success');
  }

  // ==========================================
  // PHASE 5: Depot Backlog (NA)
  // ==========================================
  const minUtilPercent = config.minUtilizationPercent ?? 80;
  const smallestVehicleType = sortedVehicleTypes[sortedVehicleTypes.length - 1] || '25';
  const smallestVehicleMinWeight = getMinWeightForVehicle(smallestVehicleType, minUtilPercent);

  const backlogOrders: OrderLineItem[] = [];
  for (const o of orders) {
    if (remainingOrderIds.has(o.id)) {
      o.vehicleTypeAllotted = 'NA';
      o.vehicleId = 'NA';
      o.priorityCategory = 'Unassigned';
      o.allocationReason =
        o.invQt < smallestVehicleMinWeight
          ? `Weight (${o.invQt} MT) below ${minUtilPercent}% threshold of smallest vehicle (${smallestVehicleMinWeight} MT) and could not be combined within multi-drop constraints / SLA window.`
          : `Could not be grouped into an eligible vehicle with ≥${minUtilPercent}% utilization without violating SLA or max distance.`;
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
