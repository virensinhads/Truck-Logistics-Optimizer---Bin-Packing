export type VehicleType = '25' | '30' | '35';

export interface OrderLineItem {
  id: string | number;
  invoiceNo?: string; // Original Inv No. (e.g. "150110039")
  invQt: number; // Order Weight in MT
  soPoDate: string; // DD/MM/YYYY
  soStoCreationTime: string; // HH:MM:SS
  soldToParty: string; // Dealer ID / Code (e.g. "302824")
  soldToPartyName?: string; // Dealer Name (e.g. "JOYGURU TRADERS")
  shipToPartyName: string; // Sub-dealer / Secondary Receiver (e.g. "SRI HIRALAL PAUL")
  dest: string; // Destination Name (e.g. "DASDA")
  lat: number; // Latitude
  lon: number; // Longitude
  rawRowData: Record<string, any>; // Original row data preserved

  // Ingested Dispatch metadata
  clubId?: string | number | null; // Club ID for batching (null/0/NA = unclubbed)
  truckNo?: string; // Dispatched vehicle identifier/license
  transpName?: string; // Transporter name
  truckTypeRaw?: string; // e.g. "12 wheeler", "14 wheeler", "16 wheeler"
  historicalRatedCapacityMT?: number; // 25, 30, 35 MT
  isHistoricallyClubbed?: boolean;
  eWayBillDateTime?: string; // Raw/parsed E-Way Bill date & time (e.g. "01.10.2026 10:15:00")
  eWayBillDate?: string; // Extracted E-Way Bill date only (e.g. "01.10.2026")
  
  // SLA & Temporal fields
  calculatedSla?: {
    orderTimestamp: number;
    effectiveStartTimestamp: number;
    expiryTimestamp: number;
    formattedStartTime: string;
    formattedExpiryTime: string;
    isRolledOver: boolean;
    eWayBillTimestamp?: number;
    formattedEWayBillTime?: string;
    isSlaBreached?: boolean;
    delayMinutes?: number;
    delayHours?: number;
    formattedDelay?: string;
  };

  // Optimization output fields
  vehicleTypeAllotted?: '25' | '30' | '35' | 'NA';
  vehicleId?: string; // e.g. "35MT_1", "25MT_3", or "NA"
  allocationReason?: string;
  dropSequence?: number;
  priorityCategory?: 'Priority I' | 'Priority II' | 'Priority III' | 'Unassigned';
}

export interface HistoricalDispatch {
  dispatchKey: string; // Unique identifier for the historical dispatch (e.g. <truckNo>_<ebillDate>)
  truckNo: string;
  dispatchDate?: string; // E-Way Bill date (or SO/PO date fallback) formatted as Dispatch Date
  eWayBillDate?: string; // Extracted date (DD.MM.YYYY)
  eWayBillDateTime?: string; // Full date & time (DD.MM.YYYY HH:MM:SS)
  soPoDate?: string;
  transpName: string;
  truckTypeRaw: string;
  ratedCapacityMT: number; // 25, 30, 35 MT
  clubId?: string | number | null;
  orders: OrderLineItem[];
  totalWeightMT: number;
  utilizationPercent: number;
  isOverweight: boolean;
  excessWeightMT: number;
  isClubbed: boolean;
  isMultiDrop: boolean;
  destinations: string[];
  interDropDistanceKm: number;
  radiusThresholdBreaches: number;
  dealers: string[]; // Unique Dealer IDs
  dealerNames: string[]; // Unique Dealer Names
  dropPointsCount: number;
  totalOrdersCount: number;

  // SLA Performance metrics for this historical dispatch
  slaBreachedOrdersCount: number;
  maxOrderDelayHours: number;
  avgOrderDelayHours: number;
  isSlaBreached: boolean;
}

export interface SlaBreachStats {
  totalOrders: number;
  breachedOrdersCount: number;
  breachedOrdersPercent: number;
  compliantOrdersCount: number;
  maxDelayHours: number;
  avgDelayHours: number;
  medianDelayHours: number;
  formattedMaxDelay: string;
  formattedAvgDelay: string;
  formattedMedianDelay: string;
}

export interface MultiDropBreakupStats {
  totalVehicles: number;
  totalOrders: number;
  fleet25Count: number;
  fleet30Count: number;
  fleet35Count: number;
  fleetOtherCount: number;
}

export interface HistoricalMetrics {
  totalUniqueTrucks: number;
  fleet25Count: number;
  fleet30Count: number;
  fleet35Count: number;
  fleetOtherCount: number;
  totalOrders: number;
  totalClubbedOrders: number;
  totalUnclubbedOrders: number;
  totalDispatches: number;
  overweightDispatchesCount: number;
  totalExcessTonnageMT: number;
  averageCapacityUtilizationPercent: number;
  distanceWeightedAvgInterDropDistanceKm: number | null;
  radiusThresholdBreachesCount: number;
  dispatches: HistoricalDispatch[];
  slaStats: SlaBreachStats;
  multiDropStats: MultiDropBreakupStats;
}

export interface OptimizationConfig {
  enabledVehicleTypes: VehicleType[];
  minUtilizationPercent: number; // 40 to 100%, default 80
  slaWindowHours: number; // 1 to 4 Hours
  maxMultiDropRadiusKm: number; // 5 to 100 km
  shiftStartTime: string; // e.g. "10:00"
  shiftEndTime: string; // e.g. "17:00"
}

export interface ConfigValidationErrors {
  enabledVehicleTypes?: string;
  minUtilizationPercent?: string;
  slaWindowHours?: string;
  maxMultiDropRadiusKm?: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
}

export interface LocationPoint {
  key: string;
  name: string;
  lat: number;
  lon: number;
}

export interface DistanceMatrixEntry {
  fromKey: string;
  toKey: string;
  fromName: string;
  toName: string;
  distanceKm: number;
  durationMin: number;
  source: 'osrm-table' | 'osm-table' | 'osm-route' | 'haversine' | 'manual';
}

export interface DistanceMatrixData {
  locations: LocationPoint[];
  matrix: Record<string, Record<string, number>>; // [fromKey][toKey] = distance in km
  durations: Record<string, Record<string, number>>; // [fromKey][toKey] = duration in min
  sources: Record<string, Record<string, 'osrm-table' | 'osm-table' | 'osm-route' | 'haversine' | 'manual'>>;
  generatedAt: string;
  stats: {
    totalPairs: number;
    osrmTablePairs?: number;
    osmTablePairs: number;
    osmRoutePairs: number;
    haversinePairs: number;
    manualPairs: number;
  };
}

export interface RouteStop {
  sequence: number;
  dest: string;
  lat: number;
  lon: number;
  weightMT: number;
  orderCount: number;
  orders: OrderLineItem[];
  isFirstDrop: boolean;
  distanceFromPreviousKm: number;
}

export interface VehicleDispatchBatch {
  vehicleId: string;
  vehicleType: VehicleType;
  capacityMT: number;
  totalWeightMT: number;
  utilizationPercent: number;
  priorityGroup: 'Priority I' | 'Priority II' | 'Priority III';
  dealerId: string;
  orders: OrderLineItem[];
  stops: RouteStop[];
  cumulativeMultiDropDistanceKm: number;
  slaEarliestExpiry: string;
  slaLatestStart: string;
  isMultiDrop: boolean;
}

export interface OptimizationResultSummary {
  fleet25Count: number;
  fleet30Count: number;
  fleet35Count: number;
  totalFleetExecuted: number;
  totalOrders: number;
  dispatchedOrdersCount: number;
  backlogOrdersCount: number;
  totalWeightMT: number;
  dispatchedWeightMT: number;
  backlogWeightMT: number;
  averageUtilizationPercent: number;
}

export interface ExecutionLog {
  id: string;
  timestamp: string;
  step: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface OptimizationResult {
  orders: OrderLineItem[];
  dispatchedBatches: VehicleDispatchBatch[];
  backlogOrders: OrderLineItem[];
  summary: OptimizationResultSummary;
  logs: ExecutionLog[];
  completedAt: string;
}
