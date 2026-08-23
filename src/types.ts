export type VehicleType = '25' | '30' | '35';

export interface OrderLineItem {
  id: string | number;
  invQt: number; // Order Weight in MT
  soPoDate: string; // DD/MM/YYYY
  soStoCreationTime: string; // HH:MM:SS
  soldToParty: string; // Unique Dealer ID
  shipToPartyName: string; // Sub-dealer / Secondary Receiver
  dest: string; // Destination Name
  lat: number; // Latitude
  lon: number; // Longitude
  rawRowData: Record<string, any>; // Original row data preserved
  
  // SLA & Temporal fields
  calculatedSla?: {
    orderTimestamp: number;
    effectiveStartTimestamp: number;
    expiryTimestamp: number;
    formattedStartTime: string;
    formattedExpiryTime: string;
    isRolledOver: boolean;
  };

  // Optimization output fields
  vehicleTypeAllotted?: '25' | '30' | '35' | 'NA';
  vehicleId?: string; // e.g. "35MT_1", "25MT_3", or "NA"
  allocationReason?: string;
  dropSequence?: number;
  priorityCategory?: 'Priority I' | 'Priority II' | 'Priority III' | 'Unassigned';
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
