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
export function getMinWeightForVehicle(type: VehicleType): number {
  switch (type) {
    case '25':
      return 20.0; // >= 20 MT (80% of 25)
    case '30':
      return 25.0001; // > 25 MT (> 80% of 30, strictly > 25 MT)
    case '35':
      return 30.0001; // > 30 MT (core >30 MT rule, > 80% of 35)
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
    const minCap = getMinWeightForVehicle(type);

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
    const key = `${order.dest.trim()}_${order.lat.toFixed(4)}_${order.lon.toFixed(4)}`;
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

/**
 * Finds combinations of orders that sum up to valid vehicle capacity with >80% utilization
 */
function findSubsetForTargetCapacity(
  orders: OrderLineItem[],
  minWeight: number,
  maxWeight: number
): OrderLineItem[] | null {
  // Sort descending by weight for greedy-first packing
  const sorted = [...orders].sort((a, b) => b.invQt - a.invQt);

  // Try single items first
  for (const o of sorted) {
    if (o.invQt >= minWeight && o.invQt <= maxWeight) {
      return [o];
    }
  }

  // Recursive search for optimal subset
  function search(index: number, currentWeight: number, currentSet: OrderLineItem[]): OrderLineItem[] | null {
    if (currentWeight >= minWeight && currentWeight <= maxWeight) {
      if (doOrdersOverlapSla(currentSet)) {
        return currentSet;
      }
    }

    if (currentWeight > maxWeight || index >= sorted.length) {
      return null;
    }

    for (let i = index; i < sorted.length; i++) {
      const item = sorted[i];
      if (currentWeight + item.invQt <= maxWeight) {
        const nextSet = [...currentSet, item];
        if (doOrdersOverlapSla(nextSet)) {
          const res = search(i + 1, currentWeight + item.invQt, nextSet);
          if (res) return res;
        }
      }
    }

    return null;
  }

  return search(0, 0, []);
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

  // ==========================================
  // PHASE 1: Priority I Grouping (Same Dealer, Same Location)
  // ==========================================
  log('Priority I', 'Evaluating Priority I: Same Dealer & Same Destination groupings...', 'info');

  // Group remaining orders by Dealer + Dest
  const p1Map = new Map<string, OrderLineItem[]>();
  for (const o of orders) {
    if (!remainingOrderIds.has(o.id)) continue;
    const key = `${o.soldToParty.trim()}__${o.dest.trim()}_${o.lat.toFixed(4)}_${o.lon.toFixed(4)}`;
    if (!p1Map.has(key)) {
      p1Map.set(key, []);
    }
    p1Map.get(key)!.push(o);
  }

  for (const [key, groupOrders] of p1Map.entries()) {
    let unassignedInGroup = groupOrders.filter((o) => remainingOrderIds.has(o.id));
    if (unassignedInGroup.length === 0) continue;

    // Check SLA compatibility and partition into SLA clusters if needed
    // Greedy bin pack within this exact dealer+location
    let attempts = 0;
    while (unassignedInGroup.length > 0 && attempts < 50) {
      attempts++;
      const currentUnassigned = unassignedInGroup.filter((o) => remainingOrderIds.has(o.id));
      if (currentUnassigned.length === 0) break;

      let totalWeight = currentUnassigned.reduce((s, o) => s + o.invQt, 0);

      // Check if entire group fits in a single vehicle
      const directVehicle = selectBestVehicleForWeight(totalWeight, config.enabledVehicleTypes);

      if (directVehicle && doOrdersOverlapSla(currentUnassigned)) {
        const vId = getNextVehicleId(directVehicle);
        const { stops, cumulativeDistanceKm, isMultiDrop } = buildRouteStops(currentUnassigned, cachedMatrix);

        dispatchedBatches.push({
          vehicleId: vId,
          vehicleType: directVehicle,
          capacityMT: getMaxCapacityForVehicle(directVehicle),
          totalWeightMT: Math.round(totalWeight * 100) / 100,
          utilizationPercent: Math.round((totalWeight / getMaxCapacityForVehicle(directVehicle)) * 1000) / 10,
          priorityGroup: 'Priority I',
          dealerId: currentUnassigned[0].soldToParty,
          orders: currentUnassigned,
          stops,
          cumulativeMultiDropDistanceKm: cumulativeDistanceKm,
          slaEarliestExpiry: new Date(Math.min(...currentUnassigned.map((o) => o.calculatedSla?.expiryTimestamp ?? Infinity))).toLocaleTimeString(),
          slaLatestStart: new Date(Math.max(...currentUnassigned.map((o) => o.calculatedSla?.effectiveStartTimestamp ?? 0))).toLocaleTimeString(),
          isMultiDrop,
        });

        markOrdersAssigned(currentUnassigned, vId, directVehicle, 'Allocated via Priority I (Same Dealer, Same Location)', 'Priority I');
        break;
      }

      // If group is larger than 35 MT or needs splitting (Large Weight Split rule):
      // Try finding exact 35 MT, 30 MT, or 25 MT subsets
      let subsetAllocated = false;
      for (const vType of config.enabledVehicleTypes) {
        const minW = getMinWeightForVehicle(vType);
        const maxW = getMaxCapacityForVehicle(vType);

        const subset = findSubsetForTargetCapacity(currentUnassigned, minW, maxW);
        if (subset && subset.length > 0) {
          const subWeight = subset.reduce((s, o) => s + o.invQt, 0);
          const vId = getNextVehicleId(vType);
          const { stops, cumulativeDistanceKm, isMultiDrop } = buildRouteStops(subset, cachedMatrix);

          dispatchedBatches.push({
            vehicleId: vId,
            vehicleType: vType,
            capacityMT: maxW,
            totalWeightMT: Math.round(subWeight * 100) / 100,
            utilizationPercent: Math.round((subWeight / maxW) * 1000) / 10,
            priorityGroup: 'Priority I',
            dealerId: subset[0].soldToParty,
            orders: subset,
            stops,
            cumulativeMultiDropDistanceKm: cumulativeDistanceKm,
            slaEarliestExpiry: new Date(Math.min(...subset.map((o) => o.calculatedSla?.expiryTimestamp ?? Infinity))).toLocaleTimeString(),
            slaLatestStart: new Date(Math.max(...subset.map((o) => o.calculatedSla?.effectiveStartTimestamp ?? 0))).toLocaleTimeString(),
            isMultiDrop,
          });

          markOrdersAssigned(subset, vId, vType, 'Allocated via Priority I split batch', 'Priority I');
          subsetAllocated = true;
          break;
        }
      }

      if (!subsetAllocated) {
        // Cannot form any more >= 80% batches for this specific location alone
        break;
      }

      unassignedInGroup = currentUnassigned.filter((o) => remainingOrderIds.has(o.id));
    }
  }

  log('Priority I Completed', `Priority I allocated ${dispatchedBatches.length} shipments. Remaining orders: ${remainingOrderIds.size}`, 'info');

  onProgress?.({
    percent: 50,
    step: '50% of data processed: Evaluating Priority II Multi-Drop (Same Dealer, Different Locations)...',
    processedCount: orders.length - remainingOrderIds.size,
    totalCount: orders.length,
  });

  // ==========================================
  // PHASE 2: Priority II Grouping (Same Dealer, Multi-Drop Locations)
  // ==========================================
  log('Priority II', 'Evaluating Priority II: Same Dealer across different multi-drop locations within max radius...', 'info');

  const p2DealerMap = new Map<string, OrderLineItem[]>();
  for (const o of orders) {
    if (!remainingOrderIds.has(o.id)) continue;
    const dealer = o.soldToParty.trim();
    if (!p2DealerMap.has(dealer)) {
      p2DealerMap.set(dealer, []);
    }
    p2DealerMap.get(dealer)!.push(o);
  }

  for (const [dealer, dealerOrders] of p2DealerMap.entries()) {
    let unassignedDealer = dealerOrders.filter((o) => remainingOrderIds.has(o.id));
    if (unassignedDealer.length <= 1) continue;

    let p2Attempts = 0;
    while (unassignedDealer.length > 1 && p2Attempts < 40) {
      p2Attempts++;
      const currentUnassigned = unassignedDealer.filter((o) => remainingOrderIds.has(o.id));
      if (currentUnassigned.length <= 1) break;

      let matchedBatch: { orders: OrderLineItem[]; vehicleType: VehicleType; stops: RouteStop[]; cumDist: number } | null = null;

      // Try largest vehicle types first
      for (const vType of config.enabledVehicleTypes) {
        const minW = getMinWeightForVehicle(vType);
        const maxW = getMaxCapacityForVehicle(vType);

        // Try combinations of 2 to 5 multi-drop orders
        // Start from largest order as Stop 1 anchor
        const sortedByWeight = [...currentUnassigned].sort((a, b) => b.invQt - a.invQt);
        const anchor = sortedByWeight[0];

        const candidatePool = sortedByWeight.filter(
          (o) => o.id !== anchor.id &&
          getDistanceBetweenPoints(anchor.lat, anchor.lon, o.lat, o.lon, cachedMatrix) <= config.maxMultiDropRadiusKm
        );

        // Greedy search for valid combination with anchor
        let currentBatch = [anchor];
        let curWeight = anchor.invQt;

        for (const candidate of candidatePool) {
          if (curWeight + candidate.invQt <= maxW) {
            const testBatch = [...currentBatch, candidate];
            if (doOrdersOverlapSla(testBatch)) {
              const { stops, cumulativeDistanceKm } = buildRouteStops(testBatch, cachedMatrix);
              if (cumulativeDistanceKm <= config.maxMultiDropRadiusKm) {
                currentBatch = testBatch;
                curWeight += candidate.invQt;
              }
            }
          }
        }

        if (curWeight >= minW && curWeight <= maxW) {
          const { stops, cumulativeDistanceKm } = buildRouteStops(currentBatch, cachedMatrix);
          matchedBatch = {
            orders: currentBatch,
            vehicleType: vType,
            stops,
            cumDist: cumulativeDistanceKm,
          };
          break;
        }
      }

      if (matchedBatch) {
        const vId = getNextVehicleId(matchedBatch.vehicleType);
        const totalW = matchedBatch.orders.reduce((s, o) => s + o.invQt, 0);
        const maxCap = getMaxCapacityForVehicle(matchedBatch.vehicleType);

        dispatchedBatches.push({
          vehicleId: vId,
          vehicleType: matchedBatch.vehicleType,
          capacityMT: maxCap,
          totalWeightMT: Math.round(totalW * 100) / 100,
          utilizationPercent: Math.round((totalW / maxCap) * 1000) / 10,
          priorityGroup: 'Priority II',
          dealerId: dealer,
          orders: matchedBatch.orders,
          stops: matchedBatch.stops,
          cumulativeMultiDropDistanceKm: matchedBatch.cumDist,
          slaEarliestExpiry: new Date(Math.min(...matchedBatch.orders.map((o) => o.calculatedSla?.expiryTimestamp ?? Infinity))).toLocaleTimeString(),
          slaLatestStart: new Date(Math.max(...matchedBatch.orders.map((o) => o.calculatedSla?.effectiveStartTimestamp ?? 0))).toLocaleTimeString(),
          isMultiDrop: true,
        });

        markOrdersAssigned(matchedBatch.orders, vId, matchedBatch.vehicleType, 'Allocated via Priority II (Same Dealer Multi-Drop)', 'Priority II');
        unassignedDealer = unassignedDealer.filter((o) => remainingOrderIds.has(o.id));
      } else {
        break;
      }
    }
  }

  log('Priority II Completed', `Priority II finished. Total shipments so far: ${dispatchedBatches.length}. Remaining orders: ${remainingOrderIds.size}`, 'info');

  onProgress?.({
    percent: 75,
    step: '80% of data processed: Evaluating Priority III (Cross-Dealer Multi-Drop)...',
    processedCount: orders.length - remainingOrderIds.size,
    totalCount: orders.length,
  });

  // ==========================================
  // PHASE 3: Priority III Grouping (Cross-Dealer Multi-Drop)
  // ==========================================
  log('Priority III', 'Evaluating Priority III: Cross-Dealer multi-drop route optimization...', 'info');

  let p3Unassigned = orders.filter((o) => remainingOrderIds.has(o.id));
  let p3Attempts = 0;

  while (p3Unassigned.length > 1 && p3Attempts < 50) {
    p3Attempts++;
    const currentUnassigned = p3Unassigned.filter((o) => remainingOrderIds.has(o.id));
    if (currentUnassigned.length <= 1) break;

    // Pick largest remaining order as First Drop candidate
    const sorted = [...currentUnassigned].sort((a, b) => b.invQt - a.invQt);
    const anchor = sorted[0];

    // Find nearby orders within multi-drop radius
    const nearbyCandidates = sorted.slice(1).filter((o) => {
      const dist = getDistanceBetweenPoints(anchor.lat, anchor.lon, o.lat, o.lon, cachedMatrix);
      return dist <= config.maxMultiDropRadiusKm;
    });

    let matchedP3Batch: { orders: OrderLineItem[]; vehicleType: VehicleType; stops: RouteStop[]; cumDist: number } | null = null;

    for (const vType of config.enabledVehicleTypes) {
      const minW = getMinWeightForVehicle(vType);
      const maxW = getMaxCapacityForVehicle(vType);

      let batch = [anchor];
      let bWeight = anchor.invQt;

      for (const candidate of nearbyCandidates) {
        if (bWeight + candidate.invQt <= maxW) {
          const testBatch = [...batch, candidate];
          if (doOrdersOverlapSla(testBatch)) {
            const { stops, cumulativeDistanceKm } = buildRouteStops(testBatch, cachedMatrix);
            if (cumulativeDistanceKm <= config.maxMultiDropRadiusKm) {
              batch = testBatch;
              bWeight += candidate.invQt;
            }
          }
        }
      }

      if (bWeight >= minW && bWeight <= maxW) {
        const { stops, cumulativeDistanceKm } = buildRouteStops(batch, cachedMatrix);
        matchedP3Batch = {
          orders: batch,
          vehicleType: vType,
          stops,
          cumDist: cumulativeDistanceKm,
        };
        break;
      }
    }

    if (matchedP3Batch) {
      const vId = getNextVehicleId(matchedP3Batch.vehicleType);
      const totalW = matchedP3Batch.orders.reduce((s, o) => s + o.invQt, 0);
      const maxCap = getMaxCapacityForVehicle(matchedP3Batch.vehicleType);

      dispatchedBatches.push({
        vehicleId: vId,
        vehicleType: matchedP3Batch.vehicleType,
        capacityMT: maxCap,
        totalWeightMT: Math.round(totalW * 100) / 100,
        utilizationPercent: Math.round((totalW / maxCap) * 1000) / 10,
        priorityGroup: 'Priority III',
        dealerId: 'Multi-Dealer',
        orders: matchedP3Batch.orders,
        stops: matchedP3Batch.stops,
        cumulativeMultiDropDistanceKm: matchedP3Batch.cumDist,
        slaEarliestExpiry: new Date(Math.min(...matchedP3Batch.orders.map((o) => o.calculatedSla?.expiryTimestamp ?? Infinity))).toLocaleTimeString(),
        slaLatestStart: new Date(Math.max(...matchedP3Batch.orders.map((o) => o.calculatedSla?.effectiveStartTimestamp ?? 0))).toLocaleTimeString(),
        isMultiDrop: true,
      });

      markOrdersAssigned(matchedP3Batch.orders, vId, matchedP3Batch.vehicleType, 'Allocated via Priority III (Cross-Dealer Multi-Drop)', 'Priority III');
      p3Unassigned = p3Unassigned.filter((o) => remainingOrderIds.has(o.id));
    } else {
      // Could not batch this anchor under Priority III, remove from priority iteration
      p3Unassigned = p3Unassigned.filter((o) => o.id !== anchor.id);
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
