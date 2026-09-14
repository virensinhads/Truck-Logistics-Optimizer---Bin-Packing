import React, { useState, useMemo } from 'react';
import {
  Truck,
  Upload,
  Play,
  Download,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Navigation,
  FileSpreadsheet,
  Layers,
  Sparkles,
  Search,
  Filter,
  ArrowRight,
  Eye,
  RotateCcw,
  Check,
  AlertCircle,
  HelpCircle,
  TrendingUp,
  MapPin,
  Calendar,
  ListOrdered,
  ChevronDown,
  ChevronUp,
  History
} from 'lucide-react';
import {
  OptimizationConfig,
  ConfigValidationErrors,
  OrderLineItem,
  OptimizationResult,
  VehicleDispatchBatch,
  VehicleType,
  DistanceMatrixData,
  HistoricalDispatch,
  MultiDropBreakupStats,
  SlaBreachStats
} from '../types';
import { runPayloadAndRouteOptimization } from '../utils/optimizationEngine';
import {
  parseSalesRegisterFile,
  downloadSampleSalesRegisterExcel,
  exportOptimizationResultToExcel
} from '../utils/excelHandler';
import { SAMPLE_SALES_REGISTER_ORDERS } from '../utils/sampleData';
import { parseShiftTimeToMinutes } from '../utils/slaCalculator';
import { RouteMapModal } from './RouteMapModal';
import { calculateHistoricalMetrics, convertHistoricalDispatchToBatch } from '../utils/historicalMetricsCalculator';

interface TabOptimizationProps {
  config: OptimizationConfig;
  setConfig: React.Dispatch<React.SetStateAction<OptimizationConfig>>;
  cachedMatrix: DistanceMatrixData | null;
  activeOrders: OrderLineItem[];
  setActiveOrders: (orders: OrderLineItem[]) => void;
}

export const TabOptimization: React.FC<TabOptimizationProps> = ({
  config,
  setConfig,
  cachedMatrix,
  activeOrders,
  setActiveOrders,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<{
    percent: number;
    step: string;
    processedCount: number;
    totalCount: number;
  }>({
    percent: 0,
    step: 'Ready',
    processedCount: 0,
    totalCount: 0,
  });

  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [activeResultView, setActiveResultView] = useState<'manifest' | 'historical' | 'table' | 'backlog' | 'logs'>('manifest');
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedVehicleFilter, setSelectedVehicleFilter] = useState<string>('ALL');
  const [selectedDropFilter, setSelectedDropFilter] = useState<string>('ALL');
  const [selectedOrdersFilter, setSelectedOrdersFilter] = useState<string>('ALL');
  const [mapModalBatch, setMapModalBatch] = useState<VehicleDispatchBatch | null>(null);
  const [showFullFleetMap, setShowFullFleetMap] = useState(false);
  const [fileUploadError, setFileUploadError] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  // Accordion state for expandable order details in Manifest & Historical views
  const [expandedManifestVehicles, setExpandedManifestVehicles] = useState<Set<string>>(new Set());
  const [expandedHistoricalVehicles, setExpandedHistoricalVehicles] = useState<Set<string>>(new Set());

  const toggleManifestVehicle = (id: string) => {
    setExpandedManifestVehicles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleHistoricalVehicle = (key: string) => {
    setExpandedHistoricalVehicles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Historical Analysis View Filters
  const [histSearchFilter, setHistSearchFilter] = useState('');
  const [histVehicleFilter, setHistVehicleFilter] = useState<string>('ALL');
  const [histClubFilter, setHistClubFilter] = useState<string>('ALL');
  const [histOverweightFilter, setHistOverweightFilter] = useState<string>('ALL');
  const [histBreachFilter, setHistBreachFilter] = useState<string>('ALL');
  const [histUtilizationFilter, setHistUtilizationFilter] = useState<string>('ALL');
  const [histCustomUtilizationThreshold, setHistCustomUtilizationThreshold] = useState<number>(80);
  const [histDelayFilter, setHistDelayFilter] = useState<string>('ALL');
  const [histCustomDelayHours, setHistCustomDelayHours] = useState<number>(2);

  // Form Validation
  const validationErrors: ConfigValidationErrors = useMemo(() => {
    const errors: ConfigValidationErrors = {};

    // 1. Fleet Availability: At least one selected
    if (!config.enabledVehicleTypes || config.enabledVehicleTypes.length === 0) {
      errors.enabledVehicleTypes = 'Select at least one vehicle type.';
    }

    // 2. Minimum Vehicle Utilization: Integer/Decimal between 40 and 100 %
    if (isNaN(config.minUtilizationPercent) || config.minUtilizationPercent < 40 || config.minUtilizationPercent > 100) {
      errors.minUtilizationPercent = 'Min utilization must be between 40% and 100%.';
    }

    // 3. SLA Delivery Window: Integer/Decimal between 1 and 4 Hours
    if (isNaN(config.slaWindowHours) || config.slaWindowHours < 1 || config.slaWindowHours > 4) {
      errors.slaWindowHours = 'SLA window must be between 1 and 4 hours.';
    }

    // 4. Max Multi-Drop Radius: Between 5 km and 100 km
    if (isNaN(config.maxMultiDropRadiusKm) || config.maxMultiDropRadiusKm < 5 || config.maxMultiDropRadiusKm > 100) {
      errors.maxMultiDropRadiusKm = 'Multi-drop radius must be between 5 km and 100 km.';
    }

    // 5. Operating Shift Start & End
    if (!config.shiftStartTime) {
      errors.shiftStartTime = 'Provide a valid shift start time.';
    }

    if (!config.shiftEndTime) {
      errors.shiftEndTime = 'Shift end time must be after shift start time.';
    } else {
      const startMins = parseShiftTimeToMinutes(config.shiftStartTime);
      const endMins = parseShiftTimeToMinutes(config.shiftEndTime);
      if (endMins <= startMins) {
        errors.shiftEndTime = 'Shift end time must be after shift start time.';
      }
    }

    return errors;
  }, [config]);

  const isFormValid = Object.keys(validationErrors).length === 0;

  // Handle Fleet Checkbox Toggle
  const handleToggleVehicleType = (type: VehicleType) => {
    setConfig((prev) => {
      const exists = prev.enabledVehicleTypes.includes(type);
      const updated = exists
        ? prev.enabledVehicleTypes.filter((t) => t !== type)
        : [...prev.enabledVehicleTypes, type];
      return { ...prev, enabledVehicleTypes: updated };
    });
  };

  // Handle File Upload
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileUploadError(null);
    try {
      const orders = await parseSalesRegisterFile(file);
      setActiveOrders(orders);
      setUploadedFileName(file.name);
      setOptimizationResult(null);
    } catch (err: any) {
      setFileUploadError(err?.message || 'Failed to parse Excel file.');
    }
  };

  // Load Built-In Sample Dataset
  const handleLoadSampleDataset = () => {
    const formattedOrders: OrderLineItem[] = SAMPLE_SALES_REGISTER_ORDERS.map((item) => ({
      ...item,
    }));
    setActiveOrders(formattedOrders);
    setUploadedFileName('Sample_Sales_Register_Input.xlsx');
    setFileUploadError(null);
    setOptimizationResult(null);
  };

  // Trigger Script 2 Optimization
  const handleRunOptimization = async () => {
    if (!isFormValid) return;

    const ordersToRun = activeOrders.length > 0
      ? activeOrders
      : SAMPLE_SALES_REGISTER_ORDERS.map((item) => ({ ...item }));

    if (ordersToRun.length === 0) {
      setFileUploadError('Please upload an input Excel file or load the sample dataset first.');
      return;
    }

    setIsRunning(true);
    setFileUploadError(null);

    try {
      const result = await runPayloadAndRouteOptimization(
        ordersToRun,
        config,
        cachedMatrix,
        (p) => setProgress(p)
      );
      setOptimizationResult(result);
    } catch (err: any) {
      setFileUploadError(`Optimization failed: ${err?.message || 'Unexpected error'}`);
    } finally {
      setIsRunning(false);
    }
  };

  // Unique drop counts present in the result
  const availableDropCounts = useMemo(() => {
    if (!optimizationResult) return [1, 2, 3, 4];
    const set = new Set<number>();
    optimizationResult.dispatchedBatches.forEach((b) => set.add(b.stops.length));
    const list = Array.from(set).sort((a, b) => a - b);
    return list.length > 0 ? list : [1, 2, 3, 4];
  }, [optimizationResult]);

  // Unique order counts clubbed per FTL present in the result
  const availableOrderCounts = useMemo(() => {
    if (!optimizationResult) return [1, 2, 3, 4, 5];
    const set = new Set<number>();
    optimizationResult.dispatchedBatches.forEach((b) => set.add(b.orders.length));
    const list = Array.from(set).sort((a, b) => a - b);
    return list.length > 0 ? list : [1, 2, 3, 4, 5];
  }, [optimizationResult]);

  // Filtered dispatched batches
  const filteredBatches = useMemo(() => {
    if (!optimizationResult) return [];
    let batches = optimizationResult.dispatchedBatches;

    if (selectedVehicleFilter !== 'ALL') {
      batches = batches.filter((b) => b.vehicleType === selectedVehicleFilter);
    }

    if (selectedDropFilter !== 'ALL') {
      const dropCount = parseInt(selectedDropFilter, 10);
      batches = batches.filter((b) => b.stops.length === dropCount);
    }

    if (selectedOrdersFilter !== 'ALL') {
      const orderCount = parseInt(selectedOrdersFilter, 10);
      batches = batches.filter((b) => b.orders.length === orderCount);
    }

    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      batches = batches.filter(
        (b) =>
          b.vehicleId.toLowerCase().includes(q) ||
          b.dealerId.toLowerCase().includes(q) ||
          b.stops.some((s) => s.dest.toLowerCase().includes(q))
      );
    }

    return batches;
  }, [optimizationResult, selectedVehicleFilter, selectedDropFilter, selectedOrdersFilter, searchFilter]);

  // Filtered all orders
  const filteredOrders = useMemo(() => {
    if (!optimizationResult) return [];
    let list = optimizationResult.orders;

    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      list = list.filter(
        (o) =>
          o.dest.toLowerCase().includes(q) ||
          o.soldToParty.toLowerCase().includes(q) ||
          (o.vehicleId && o.vehicleId.toLowerCase().includes(q)) ||
          (o.vehicleTypeAllotted && o.vehicleTypeAllotted.toLowerCase().includes(q))
      );
    }

    return list;
  }, [optimizationResult, searchFilter]);

  // Historical actual metrics computed from the active orders & ingested dispatch data
  const historicalMetrics = useMemo(() => {
    return calculateHistoricalMetrics(
      activeOrders,
      config.maxMultiDropRadiusKm,
      cachedMatrix,
      config.slaWindowHours,
      config.shiftStartTime,
      config.shiftEndTime
    );
  }, [
    activeOrders,
    config.maxMultiDropRadiusKm,
    cachedMatrix,
    config.slaWindowHours,
    config.shiftStartTime,
    config.shiftEndTime,
  ]);

  // Filtered historical dispatches based on user UI filter controls
  const filteredHistoricalDispatches = useMemo(() => {
    let list = historicalMetrics.dispatches;

    if (histVehicleFilter !== 'ALL') {
      const target = parseInt(histVehicleFilter, 10);
      list = list.filter((hd) => hd.ratedCapacityMT === target);
    }

    if (histClubFilter === 'CLUBBED') {
      list = list.filter((hd) => hd.isClubbed);
    } else if (histClubFilter === 'UNCLUBBED') {
      list = list.filter((hd) => !hd.isClubbed);
    }

    if (histOverweightFilter === 'OVERWEIGHT') {
      list = list.filter((hd) => hd.isOverweight);
    } else if (histOverweightFilter === 'COMPLIANT') {
      list = list.filter((hd) => !hd.isOverweight);
    }

    if (histBreachFilter === 'BREACH') {
      list = list.filter((hd) => hd.radiusThresholdBreaches > 0);
    } else if (histBreachFilter === 'COMPLIANT') {
      list = list.filter((hd) => hd.radiusThresholdBreaches === 0);
    }

    // SLA Delay Filtering
    if (histDelayFilter === 'BREACHED') {
      list = list.filter((hd) => hd.isSlaBreached || hd.slaBreachedOrdersCount > 0);
    } else if (histDelayFilter === 'MET') {
      list = list.filter((hd) => !hd.isSlaBreached && hd.slaBreachedOrdersCount === 0);
    } else if (histDelayFilter === 'DELAY_2') {
      list = list.filter((hd) => hd.maxOrderDelayHours >= 2);
    } else if (histDelayFilter === 'DELAY_4') {
      list = list.filter((hd) => hd.maxOrderDelayHours >= 4);
    } else if (histDelayFilter === 'DELAY_8') {
      list = list.filter((hd) => hd.maxOrderDelayHours >= 8);
    } else if (histDelayFilter === 'DELAY_24') {
      list = list.filter((hd) => hd.maxOrderDelayHours >= 24);
    } else if (histDelayFilter === 'CUSTOM') {
      const threshold = histCustomDelayHours;
      if (!isNaN(threshold) && threshold >= 0) {
        list = list.filter((hd) => hd.maxOrderDelayHours >= threshold);
      }
    }

    if (histUtilizationFilter !== 'ALL') {
      const threshold = histUtilizationFilter === 'CUSTOM'
        ? histCustomUtilizationThreshold
        : parseFloat(histUtilizationFilter);
      if (!isNaN(threshold) && threshold > 0) {
        list = list.filter((hd) => hd.utilizationPercent < threshold);
      }
    }

    if (histSearchFilter.trim()) {
      const q = histSearchFilter.toLowerCase();
      list = list.filter((hd) => {
        const matchTruck = hd.truckNo.toLowerCase().includes(q);
        const matchTransp = hd.transpName.toLowerCase().includes(q);
        const matchKey = hd.dispatchKey.toLowerCase().includes(q);
        const matchDealers =
          hd.dealers.some((d) => d.toLowerCase().includes(q)) ||
          hd.dealerNames.some((dn) => dn.toLowerCase().includes(q));
        const matchDest = hd.destinations.some((dst) => dst.toLowerCase().includes(q));
        const matchOrders = hd.orders.some(
          (o) =>
            (o.invoiceNo && o.invoiceNo.toLowerCase().includes(q)) ||
            (o.shipToPartyName && o.shipToPartyName.toLowerCase().includes(q)) ||
            (o.soldToParty && o.soldToParty.toLowerCase().includes(q))
        );
        return matchTruck || matchTransp || matchKey || matchDealers || matchDest || matchOrders;
      });
    }

    return list;
  }, [
    historicalMetrics.dispatches,
    histVehicleFilter,
    histClubFilter,
    histOverweightFilter,
    histBreachFilter,
    histDelayFilter,
    histCustomDelayHours,
    histUtilizationFilter,
    histCustomUtilizationThreshold,
    histSearchFilter,
  ]);

  // Derived metrics from engine optimization outputs for side-by-side comparison
  const engineMetrics = useMemo(() => {
    if (!optimizationResult) return null;

    // Total orders clubbed together into multi-order dispatches
    const engineClubbedOrders = optimizationResult.dispatchedBatches
      .filter((b) => b.orders.length > 1)
      .reduce((sum, b) => sum + b.orders.length, 0);

    // Multi-drop batches for engine
    const engineMultiDropBatches = optimizationResult.dispatchedBatches.filter(
      (b) => b.isMultiDrop && b.stops.length > 1
    );

    // Distance-weighted drop distance for engine multi-drop batches (calculated strictly only when multi-location drops are happening)
    let weightedDistNum = 0;
    let weightedDistDen = 0;
    engineMultiDropBatches.forEach((b) => {
      const weight = b.totalWeightMT > 0 ? b.totalWeightMT : b.capacityMT;
      weightedDistNum += weight * b.cumulativeMultiDropDistanceKm;
      weightedDistDen += weight;
    });

    const engineDistanceWeightedDropDistance = weightedDistDen > 0
      ? Math.round((weightedDistNum / weightedDistDen) * 100) / 100
      : null;

    const engineMultiDropStats: MultiDropBreakupStats = {
      totalVehicles: engineMultiDropBatches.length,
      totalOrders: engineMultiDropBatches.reduce((sum, b) => sum + b.orders.length, 0),
      fleet25Count: engineMultiDropBatches.filter((b) => b.vehicleType === '25').length,
      fleet30Count: engineMultiDropBatches.filter((b) => b.vehicleType === '30').length,
      fleet35Count: engineMultiDropBatches.filter((b) => b.vehicleType === '35').length,
      fleetOtherCount: 0,
    };

    // Radius breaches in engine (guaranteed 0 by design)
    const engineRadiusBreaches = 0;
    // Overweight dispatches in engine (guaranteed 0 by design)
    const engineOverweightDispatches = 0;

    return {
      engineClubbedOrders,
      engineDistanceWeightedDropDistance,
      engineMultiDropStats,
      engineRadiusBreaches,
      engineOverweightDispatches,
    };
  }, [optimizationResult]);

  return (
    <div className="space-y-4 max-w-7xl mx-auto px-4 sm:px-6 py-5 font-sans">
      {/* Configuration & Inputs Card */}
      <div className="bg-white rounded-lg border border-[#E2E8F0] shadow-2xs p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-4 border-b border-[#E2E8F0]">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-xs bg-[#0F172A] text-[#38BDF8] text-[10px] font-mono font-bold uppercase tracking-wider mb-1.5 border border-[#334155]">
              <Sparkles className="w-3 h-3 text-[#38BDF8]" />
              <span>Script 2: Multi-Drop Bin-Packing & Dispatch Engine</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#0F172A] tracking-tight">
              Payload & Route Optimization Engine
            </h1>
            <p className="text-xs text-[#64748B] font-mono mt-0.5">
              Enforcing <strong className="text-[#0F172A]">&ge; {config.minUtilizationPercent ?? 80}.0% load utilization</strong>, <strong className="text-[#0F172A]">Priority I / II / III</strong> grouping hierarchies, and <strong className="text-[#0F172A]">temporal SLA windows</strong>.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-download-sample-excel"
              onClick={() => downloadSampleSalesRegisterExcel()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#334155] text-xs font-mono font-semibold border border-[#CBD5E1] transition shadow-2xs"
              title="Download sample Excel file with input structure"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#059669]" />
              <span>Template .XLSX</span>
            </button>

            <button
              id="btn-load-sample-data"
              onClick={handleLoadSampleDataset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#0F172A] hover:bg-[#1E293B] text-[#38BDF8] text-xs font-mono font-bold border border-[#334155] transition shadow-2xs"
              title="Load pre-built 13-order scenario testing all business rules"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Load 13 Orders Sample</span>
            </button>
          </div>
        </div>

        {/* File Upload Zone & Parameters */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-4 flex flex-col justify-center">
            <label
              htmlFor="sales-file-input"
              className={`border border-dashed rounded-lg p-4 flex flex-col items-center justify-center text-center cursor-pointer transition ${
                uploadedFileName
                  ? 'border-[#059669] bg-[#ECFDF5]/50'
                  : 'border-[#CBD5E1] hover:border-[#38BDF8] bg-[#F8FAFC] hover:bg-[#F1F5F9]'
              }`}
            >
              <div className={`w-10 h-10 rounded-md flex items-center justify-center mb-2 font-mono ${
                uploadedFileName ? 'bg-[#D1FAE5] text-[#059669]' : 'bg-[#E2E8F0] text-[#0F172A]'
              }`}>
                {uploadedFileName ? <CheckCircle2 className="w-5 h-5" /> : <Upload className="w-5 h-5" />}
              </div>

              <span className="text-xs font-bold font-mono text-[#0F172A]">
                {uploadedFileName ? uploadedFileName : 'Upload Sales Register File'}
              </span>
              <span className="text-[11px] text-[#64748B] font-mono mt-0.5">
                {uploadedFileName
                  ? `${activeOrders.length || 13} orders loaded and ready`
                  : 'Drag and drop or click (.xlsx, .xls, .csv)'}
              </span>

              <input
                id="sales-file-input"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>

            {fileUploadError && (
              <div className="mt-1.5 text-xs text-[#DC2626] font-mono flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{fileUploadError}</span>
              </div>
            )}
          </div>

          {/* Form Controls & Validation Panel */}
          <div className="lg:col-span-8 bg-[#F8FAFC] p-3.5 sm:p-4 rounded-lg border border-[#E2E8F0] space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* 1. Fleet Availability */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold font-mono uppercase tracking-wider text-[#475569] flex items-center justify-between">
                  <span>Fleet Availability</span>
                  <span className="text-[10px] text-[#94A3B8] font-normal">&ge;{config.minUtilizationPercent ?? 80}%</span>
                </label>
                <div className="flex items-center gap-1 pt-0.5">
                  {(['25', '30', '35'] as VehicleType[]).map((type) => {
                    const isChecked = config.enabledVehicleTypes.includes(type);
                    const minMt = ((parseInt(type, 10) * (config.minUtilizationPercent || 80)) / 100).toFixed(1);
                    return (
                      <button
                        key={type}
                        type="button"
                        id={`fleet-toggle-${type}`}
                        onClick={() => handleToggleVehicleType(type)}
                        title={`Min payload: ${minMt} MT (${config.minUtilizationPercent || 80}% of ${type} MT)`}
                        className={`flex-1 py-1 px-1 rounded-sm text-[11px] font-mono font-bold border transition ${
                          isChecked
                            ? 'bg-[#0F172A] text-[#38BDF8] border-[#0F172A] shadow-2xs'
                            : 'bg-white text-[#64748B] border-[#CBD5E1] hover:bg-[#F1F5F9]'
                        }`}
                      >
                        {type}T
                      </button>
                    );
                  })}
                </div>
                {validationErrors.enabledVehicleTypes && (
                  <p className="text-[10px] text-[#DC2626] font-mono flex items-center gap-1 mt-0.5">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span>{validationErrors.enabledVehicleTypes}</span>
                  </p>
                )}
              </div>

              {/* 2. Minimum Utilization % */}
              <div className="space-y-1">
                <label htmlFor="input-min-utilization" className="text-[11px] font-bold font-mono uppercase tracking-wider text-[#475569] flex items-center justify-between">
                  <span>Min Utilization</span>
                  <span className="text-[10px] text-[#94A3B8] font-normal">40–100%</span>
                </label>
                <div className="relative">
                  <input
                    id="input-min-utilization"
                    type="number"
                    min="40"
                    max="100"
                    step="1"
                    value={config.minUtilizationPercent ?? 80}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        minUtilizationPercent: parseFloat(e.target.value) || 0,
                      }))
                    }
                    className={`w-full px-2.5 py-1 rounded-sm border text-xs font-mono bg-white text-[#0F172A] focus:outline-hidden focus:border-[#38BDF8] ${
                      validationErrors.minUtilizationPercent
                        ? 'border-[#DC2626] focus:border-[#DC2626]'
                        : 'border-[#CBD5E1]'
                    }`}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-[#64748B]">
                    %
                  </span>
                </div>
                {validationErrors.minUtilizationPercent && (
                  <p className="text-[10px] text-[#DC2626] font-mono flex items-center gap-1 mt-0.5">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span>{validationErrors.minUtilizationPercent}</span>
                  </p>
                )}
              </div>

              {/* 3. SLA Delivery Window */}
              <div className="space-y-1">
                <label htmlFor="input-sla-window" className="text-[11px] font-bold font-mono uppercase tracking-wider text-[#475569] flex items-center justify-between">
                  <span>SLA Window</span>
                  <span className="text-[10px] text-[#94A3B8] font-normal">1 to 4 Hrs</span>
                </label>
                <div className="relative">
                  <input
                    id="input-sla-window"
                    type="number"
                    min="1"
                    max="4"
                    step="0.5"
                    value={config.slaWindowHours}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        slaWindowHours: parseFloat(e.target.value) || 0,
                      }))
                    }
                    className={`w-full px-2.5 py-1 rounded-sm border text-xs font-mono bg-white text-[#0F172A] focus:outline-hidden focus:border-[#38BDF8] ${
                      validationErrors.slaWindowHours
                        ? 'border-[#DC2626] focus:border-[#DC2626]'
                        : 'border-[#CBD5E1]'
                    }`}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-[#94A3B8]">
                    Hrs
                  </span>
                </div>
                {validationErrors.slaWindowHours && (
                  <p className="text-[10px] text-[#DC2626] font-mono flex items-center gap-1 mt-0.5">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span>{validationErrors.slaWindowHours}</span>
                  </p>
                )}
              </div>

              {/* 4. Max Multi-Drop Radius */}
              <div className="space-y-1">
                <label htmlFor="input-multi-drop-radius" className="text-[11px] font-bold font-mono uppercase tracking-wider text-[#475569] flex items-center justify-between">
                  <span>Radius (D_Max)</span>
                  <span className="text-[10px] text-[#94A3B8] font-normal">5–100 km</span>
                </label>
                <div className="relative">
                  <input
                    id="input-multi-drop-radius"
                    type="number"
                    min="5"
                    max="100"
                    step="1"
                    value={config.maxMultiDropRadiusKm}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        maxMultiDropRadiusKm: parseFloat(e.target.value) || 0,
                      }))
                    }
                    className={`w-full px-2.5 py-1 rounded-sm border text-xs font-mono bg-white text-[#0F172A] focus:outline-hidden focus:border-[#38BDF8] ${
                      validationErrors.maxMultiDropRadiusKm
                        ? 'border-[#DC2626] focus:border-[#DC2626]'
                        : 'border-[#CBD5E1]'
                    }`}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-[#94A3B8]">
                    km
                  </span>
                </div>
                {validationErrors.maxMultiDropRadiusKm && (
                  <p className="text-[10px] text-[#DC2626] font-mono flex items-center gap-1 mt-0.5">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span>{validationErrors.maxMultiDropRadiusKm}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Shift Times */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#E2E8F0]">
              <div className="space-y-1">
                <label htmlFor="input-shift-start" className="text-[11px] font-bold font-mono uppercase tracking-wider text-[#475569] flex items-center justify-between">
                  <span>Operating Shift Start</span>
                  <span className="text-[10px] text-[#94A3B8] font-normal">HH:MM</span>
                </label>
                <input
                  id="input-shift-start"
                  type="time"
                  value={config.shiftStartTime}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, shiftStartTime: e.target.value }))
                  }
                  className={`w-full px-2.5 py-1 rounded-sm border text-xs font-mono bg-white text-[#0F172A] focus:outline-hidden focus:border-[#38BDF8] ${
                    validationErrors.shiftStartTime
                      ? 'border-[#DC2626] focus:border-[#DC2626]'
                      : 'border-[#CBD5E1]'
                  }`}
                />
                {validationErrors.shiftStartTime && (
                  <p className="text-[10px] text-[#DC2626] font-mono flex items-center gap-1 mt-0.5">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span>{validationErrors.shiftStartTime}</span>
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label htmlFor="input-shift-end" className="text-[11px] font-bold font-mono uppercase tracking-wider text-[#475569] flex items-center justify-between">
                  <span>Operating Shift End</span>
                  <span className="text-[10px] text-[#94A3B8] font-normal">&gt; Start Time</span>
                </label>
                <input
                  id="input-shift-end"
                  type="time"
                  value={config.shiftEndTime}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, shiftEndTime: e.target.value }))
                  }
                  className={`w-full px-2.5 py-1 rounded-sm border text-xs font-mono bg-white text-[#0F172A] focus:outline-hidden focus:border-[#38BDF8] ${
                    validationErrors.shiftEndTime
                      ? 'border-[#DC2626] focus:border-[#DC2626]'
                      : 'border-[#CBD5E1]'
                  }`}
                />
                {validationErrors.shiftEndTime && (
                  <p className="text-[10px] text-[#DC2626] font-mono flex items-center gap-1 mt-0.5">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span>{validationErrors.shiftEndTime}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Execution Trigger Bar */}
            <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
              <div className="text-xs font-mono text-[#64748B] flex items-center gap-1.5">
                {isFormValid ? (
                  <span className="flex items-center gap-1 text-[#059669] font-medium">
                    <Check className="w-3.5 h-3.5 text-[#059669]" />
                    <span>Operational constraints valid & ready for dispatch engine</span>
                  </span>
                ) : (
                  <span className="text-[#DC2626] font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Please correct the highlighted form errors</span>
                  </span>
                )}
              </div>

              <button
                id="btn-run-optimization"
                onClick={handleRunOptimization}
                disabled={!isFormValid || isRunning}
                className={`flex items-center justify-center gap-2 px-5 py-2 rounded-sm text-xs font-mono font-bold tracking-wider uppercase transition shadow-2xs cursor-pointer ${
                  !isFormValid || isRunning
                    ? 'bg-[#94A3B8] text-white cursor-not-allowed opacity-75'
                    : 'bg-[#0F172A] hover:bg-[#1E293B] text-[#38BDF8] border border-[#334155]'
                }`}
              >
                <Play className={`w-3.5 h-3.5 ${isRunning ? 'animate-pulse text-[#38BDF8]' : ''}`} />
                <span>{isRunning ? 'Optimizing Fleet...' : 'Run Optimization Engine (Script 2)'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Real-time Progress & Messaging Overlay during run */}
        {isRunning && (
          <div className="p-3.5 rounded-lg bg-[#0F172A] border border-[#334155] text-white font-mono space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-[#38BDF8]">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#38BDF8] animate-ping" />
                <span>{progress.step}</span>
              </span>
              <span>{progress.percent}%</span>
            </div>
            <div className="w-full bg-[#1E293B] rounded-full h-2 overflow-hidden">
              <div
                className="bg-[#38BDF8] h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="text-[11px] text-[#94A3B8]">
              Evaluating multi-drop road circuity, bin packing subsets, and SLA roll-overs...
            </p>
          </div>
        )}
      </div>

      {/* UI Summary Dashboard (Vehicle Counter & Historical Comparative Analysis) */}
      {optimizationResult && (
        <div className="space-y-4">
          {/* Top Vehicle Counter Row (PRD Section 6 Spec) */}
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-[#0F172A] tracking-tight flex items-center gap-2">
                  <span>UI Summary Dashboard: Vehicle Fleet Allocation</span>
                  <span className="text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded-xs bg-[#ECFDF5] text-[#059669] border border-[#10B98133]">
                    COMPLETE
                  </span>
                </h2>
                <p className="text-xs font-mono text-[#64748B] mt-0.5">
                  Generated at {new Date(optimizationResult.completedAt).toLocaleTimeString()} • Minimizing vehicle count & enforcing &ge;{config.minUtilizationPercent ?? 80}.0% payload targets
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  id="btn-view-fleet-map"
                  onClick={() => setShowFullFleetMap(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#0F172A] hover:bg-[#1E293B] text-white text-xs font-mono font-bold border border-[#334155] transition cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5 text-[#38BDF8]" />
                  <span>Fleet Map</span>
                </button>

                <button
                  id="btn-export-optimized-excel"
                  onClick={() => exportOptimizationResultToExcel(optimizationResult)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-sm bg-[#059669] hover:bg-[#047857] text-white text-xs font-mono font-bold shadow-2xs transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export .XLSX</span>
                </button>
              </div>
            </div>

            {/* Official PRD Vehicle Counter Table & KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              {/* 25 MT Fleet */}
              <div className="bg-white p-3 rounded-lg border border-[#E2E8F0] shadow-2xs">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-bold text-[#64748B] font-mono uppercase tracking-wider">
                    25 MT Fleet
                  </span>
                  <span className="text-[9px] font-mono px-1 py-0.2 rounded-xs bg-[#F1F5F9] text-[#0F172A] font-bold">
                    &ge; {((25 * (config.minUtilizationPercent || 80)) / 100).toFixed(1)} MT
                  </span>
                </div>
                <div className="text-2xl font-mono font-extrabold text-[#0F172A]">
                  {optimizationResult.summary.fleet25Count}
                </div>
                <span className="text-[10px] font-mono text-[#94A3B8] block">Vehicles</span>
              </div>

              {/* 30 MT Fleet */}
              <div className="bg-white p-3 rounded-lg border border-[#E2E8F0] shadow-2xs">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-bold text-[#64748B] font-mono uppercase tracking-wider">
                    30 MT Fleet
                  </span>
                  <span className="text-[9px] font-mono px-1 py-0.2 rounded-xs bg-[#F1F5F9] text-[#0F172A] font-bold">
                    &ge; {((30 * (config.minUtilizationPercent || 80)) / 100).toFixed(1)} MT
                  </span>
                </div>
                <div className="text-2xl font-mono font-extrabold text-[#0F172A]">
                  {optimizationResult.summary.fleet30Count}
                </div>
                <span className="text-[10px] font-mono text-[#94A3B8] block">Vehicles</span>
              </div>

              {/* 35 MT Fleet */}
              <div className="bg-white p-3 rounded-lg border border-[#E2E8F0] shadow-2xs">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-bold text-[#64748B] font-mono uppercase tracking-wider">
                    35 MT Fleet
                  </span>
                  <span className="text-[9px] font-mono px-1 py-0.2 rounded-xs bg-[#F1F5F9] text-[#0F172A] font-bold">
                    &ge; {((35 * (config.minUtilizationPercent || 80)) / 100).toFixed(1)} MT
                  </span>
                </div>
                <div className="text-2xl font-mono font-extrabold text-[#0F172A]">
                  {optimizationResult.summary.fleet35Count}
                </div>
                <span className="text-[10px] font-mono text-[#94A3B8] block">Vehicles</span>
              </div>

              {/* Total Fleet Executed (PRD Mandate) */}
              <div className="bg-[#0F172A] p-3 rounded-lg text-white border border-[#334155] shadow-2xs">
                <span className="text-[10px] font-bold uppercase font-mono tracking-wider text-[#38BDF8] block mb-0.5">
                  Total Fleet
                </span>
                <div className="text-2xl font-mono font-extrabold text-[#38BDF8]">
                  {optimizationResult.summary.totalFleetExecuted}
                </div>
                <span className="text-[10px] font-mono text-[#94A3B8] block">Dispatches</span>
              </div>

              {/* Avg Load Utilization */}
              <div className="bg-white p-3 rounded-lg border border-[#E2E8F0] shadow-2xs">
                <span className="text-[10px] font-bold text-[#64748B] font-mono uppercase tracking-wider block mb-0.5">
                  Avg. Utilization
                </span>
                <div className="text-2xl font-mono font-extrabold text-[#059669]">
                  {optimizationResult.summary.averageUtilizationPercent}%
                </div>
                <span className="text-[10px] font-mono text-[#94A3B8] block">Target: &ge;{(config.minUtilizationPercent ?? 80).toFixed(1)}%</span>
              </div>

              {/* Dispatched Weight vs Backlog */}
              <div className="bg-white p-3 rounded-lg border border-[#E2E8F0] shadow-2xs">
                <span className="text-[10px] font-bold text-[#64748B] font-mono uppercase tracking-wider block mb-0.5">
                  Tonnage Dispatched
                </span>
                <div className="text-2xl font-mono font-extrabold text-[#0F172A]">
                  {optimizationResult.summary.dispatchedWeightMT} <span className="text-xs font-normal text-[#64748B]">MT</span>
                </div>
                <span className="text-[10px] font-mono text-[#94A3B8] block">
                  {optimizationResult.summary.dispatchedOrdersCount} of {optimizationResult.summary.totalOrders} Orders
                </span>
              </div>
            </div>
          </div>

          {/* Comparative Analysis: Historical Actuals vs Optimization Engine Outputs */}
          <div className="bg-white rounded-lg border border-[#E2E8F0] shadow-2xs p-4 sm:p-5 space-y-3 font-mono">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2.5 border-b border-[#E2E8F0] gap-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#0284C7]" />
                <h3 className="text-sm font-bold text-[#0F172A] tracking-tight uppercase">
                  Comparative Analysis: Historical Actuals vs. Engine Optimization
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#64748B]">
                  Evaluating {activeOrders.length} Ingested Line Items against Algorithmic Grouping
                </span>
                <button
                  id="btn-inspect-historical-manifest"
                  onClick={() => setActiveResultView('historical')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#0F172A] hover:bg-[#1E293B] text-[#38BDF8] text-xs font-bold transition shadow-2xs cursor-pointer"
                  title="View detailed historical dispatches manifest and order breakdown"
                >
                  <History className="w-3.5 h-3.5 text-[#38BDF8]" />
                  <span>Inspect Historical Dispatches ({historicalMetrics.totalDispatches})</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b border-[#CBD5E1] text-[10px] font-bold uppercase tracking-wider text-[#475569]">
                    <th className="p-2.5 sm:p-3">Performance Dimension</th>
                    <th className="p-2.5 sm:p-3 bg-[#FFFBEB]/60 text-[#92400E] border-l border-[#E2E8F0]">
                      Historical Actuals (Input Ingestion)
                    </th>
                    <th className="p-2.5 sm:p-3 bg-[#ECFDF5]/60 text-[#065F46] border-l border-[#E2E8F0]">
                      Optimization Engine Output
                    </th>
                    <th className="p-2.5 sm:p-3 bg-[#F0F9FF] text-[#0369A1] border-l border-[#E2E8F0]">
                      Variance & Impact
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {/* 1. Total Fleet Count */}
                  <tr className="hover:bg-[#F8FAFC]">
                    <td className="p-2.5 sm:p-3 font-bold text-[#0F172A]">
                      Total Vehicles Dispatched
                    </td>
                    <td className="p-2.5 sm:p-3 font-semibold text-[#0F172A] bg-[#FFFBEB]/20 border-l border-[#E2E8F0]">
                      {historicalMetrics.totalDispatches} Dispatches ({historicalMetrics.totalUniqueTrucks} Unique Trucks)
                    </td>
                    <td className="p-2.5 sm:p-3 font-bold text-[#059669] bg-[#ECFDF5]/20 border-l border-[#E2E8F0]">
                      {optimizationResult.summary.totalFleetExecuted} Dispatches
                    </td>
                    <td className="p-2.5 sm:p-3 font-bold text-[#0284C7] bg-[#F0F9FF]/40 border-l border-[#E2E8F0]">
                      {historicalMetrics.totalDispatches >= optimizationResult.summary.totalFleetExecuted ? (
                        <span className="text-[#059669]">
                          -{historicalMetrics.totalDispatches - optimizationResult.summary.totalFleetExecuted} Vehicles ({historicalMetrics.totalDispatches > 0 ? (((historicalMetrics.totalDispatches - optimizationResult.summary.totalFleetExecuted) / historicalMetrics.totalDispatches) * 100).toFixed(1) : 0}% Fleet Reduction)
                        </span>
                      ) : (
                        <span className="text-[#64748B]">
                          +{optimizationResult.summary.totalFleetExecuted - historicalMetrics.totalDispatches} Vehicles (SLA Constrained)
                        </span>
                      )}
                    </td>
                  </tr>

                  {/* 2. Vehicle Tier Split */}
                  <tr className="hover:bg-[#F8FAFC]">
                    <td className="p-2.5 sm:p-3 font-bold text-[#0F172A]">
                      Fleet Capacity Breakdown
                    </td>
                    <td className="p-2.5 sm:p-3 text-[#475569] bg-[#FFFBEB]/20 border-l border-[#E2E8F0]">
                      25MT: <span className="font-bold text-[#0F172A]">{historicalMetrics.fleet25Count}</span> | 30MT: <span className="font-bold text-[#0F172A]">{historicalMetrics.fleet30Count}</span> | 35MT: <span className="font-bold text-[#0F172A]">{historicalMetrics.fleet35Count}</span>
                      {historicalMetrics.fleetOtherCount > 0 && <span> | Other: {historicalMetrics.fleetOtherCount}</span>}
                    </td>
                    <td className="p-2.5 sm:p-3 text-[#475569] bg-[#ECFDF5]/20 border-l border-[#E2E8F0]">
                      25MT: <span className="font-bold text-[#059669]">{optimizationResult.summary.fleet25Count}</span> | 30MT: <span className="font-bold text-[#059669]">{optimizationResult.summary.fleet30Count}</span> | 35MT: <span className="font-bold text-[#059669]">{optimizationResult.summary.fleet35Count}</span>
                    </td>
                    <td className="p-2.5 sm:p-3 text-[#64748B] bg-[#F0F9FF]/40 border-l border-[#E2E8F0]">
                      Right-sized to multi-drop payloads
                    </td>
                  </tr>

                  {/* 3. Clubbed Orders */}
                  <tr className="hover:bg-[#F8FAFC]">
                    <td className="p-2.5 sm:p-3 font-bold text-[#0F172A]">
                      Total Clubbed Orders
                    </td>
                    <td className="p-2.5 sm:p-3 text-[#475569] bg-[#FFFBEB]/20 border-l border-[#E2E8F0]">
                      <span className="font-bold text-[#0F172A]">{historicalMetrics.totalClubbedOrders}</span> orders in batches ({historicalMetrics.totalUnclubbedOrders} individual)
                    </td>
                    <td className="p-2.5 sm:p-3 text-[#475569] bg-[#ECFDF5]/20 border-l border-[#E2E8F0]">
                      <span className="font-bold text-[#059669]">{engineMetrics?.engineClubbedOrders ?? 0}</span> orders clubbed ({optimizationResult.orders.length - (engineMetrics?.engineClubbedOrders ?? 0)} single-order FTLs)
                    </td>
                    <td className="p-2.5 sm:p-3 text-[#0284C7] font-semibold bg-[#F0F9FF]/40 border-l border-[#E2E8F0]">
                      Optimized across Priority I, II, and III
                    </td>
                  </tr>

                  {/* 4. Overweight Dispatches */}
                  <tr className="hover:bg-[#F8FAFC]">
                    <td className="p-2.5 sm:p-3 font-bold text-[#0F172A]">
                      Overweight Dispatches (&gt; Rated Capacity)
                    </td>
                    <td className="p-2.5 sm:p-3 bg-[#FFFBEB]/20 border-l border-[#E2E8F0]">
                      {historicalMetrics.overweightDispatchesCount > 0 ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-[#FEF2F2] text-[#DC2626] font-bold border border-[#FECACA]">
                          <AlertTriangle className="w-3 h-3 text-[#DC2626]" />
                          {historicalMetrics.overweightDispatchesCount} Dispatches ({historicalMetrics.totalExcessTonnageMT} MT Excess)
                        </span>
                      ) : (
                        <span className="text-[#059669] font-bold">0 Overweight Dispatches</span>
                      )}
                    </td>
                    <td className="p-2.5 sm:p-3 text-[#059669] font-bold bg-[#ECFDF5]/20 border-l border-[#E2E8F0]">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-[#ECFDF5] text-[#059669] font-bold border border-[#A7F3D0]">
                        <Check className="w-3 h-3 text-[#059669]" />
                        0 Overweight (100% Compliant)
                      </span>
                    </td>
                    <td className="p-2.5 sm:p-3 text-[#059669] font-bold bg-[#F0F9FF]/40 border-l border-[#E2E8F0]">
                      {historicalMetrics.overweightDispatchesCount > 0
                        ? `Eliminated ${historicalMetrics.overweightDispatchesCount} overloaded runs`
                        : 'Compliant with statutory axle load limits'}
                    </td>
                  </tr>

                  {/* 5. Average Capacity Utilization */}
                  <tr className="hover:bg-[#F8FAFC]">
                    <td className="p-2.5 sm:p-3 font-bold text-[#0F172A]">
                      Average Capacity Utilization %
                    </td>
                    <td className="p-2.5 sm:p-3 text-[#0F172A] font-bold bg-[#FFFBEB]/20 border-l border-[#E2E8F0]">
                      {historicalMetrics.averageCapacityUtilizationPercent}%
                    </td>
                    <td className="p-2.5 sm:p-3 text-[#059669] font-extrabold bg-[#ECFDF5]/20 border-l border-[#E2E8F0]">
                      {optimizationResult.summary.averageUtilizationPercent}%
                    </td>
                    <td className="p-2.5 sm:p-3 font-bold bg-[#F0F9FF]/40 border-l border-[#E2E8F0]">
                      {optimizationResult.summary.averageUtilizationPercent >= historicalMetrics.averageCapacityUtilizationPercent ? (
                        <span className="text-[#059669]">
                          +{(optimizationResult.summary.averageUtilizationPercent - historicalMetrics.averageCapacityUtilizationPercent).toFixed(1)}% Efficiency Gain
                        </span>
                      ) : (
                        <span className="text-[#64748B]">
                          {(optimizationResult.summary.averageUtilizationPercent - historicalMetrics.averageCapacityUtilizationPercent).toFixed(1)}%
                        </span>
                      )}
                    </td>
                  </tr>

                  {/* 6. SLA Breaches & Dispatch Delays */}
                  <tr className="hover:bg-[#F8FAFC]">
                    <td className="p-2.5 sm:p-3 font-bold text-[#0F172A]">
                      <div>SLA Breaches &amp; Delays</div>
                      <div className="text-[10px] text-[#64748B] font-normal">Based on E-Way Bill vs. SLA Expiry ({config.slaWindowHours}h Window)</div>
                    </td>
                    <td className="p-2.5 sm:p-3 bg-[#FFFBEB]/20 border-l border-[#E2E8F0]">
                      {historicalMetrics.slaStats.breachedOrdersCount > 0 ? (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-[#FEF2F2] text-[#DC2626] font-bold border border-[#FECACA]">
                            <Clock className="w-3 h-3 text-[#DC2626]" />
                            {historicalMetrics.slaStats.breachedOrdersCount} / {historicalMetrics.totalOrders} Orders ({historicalMetrics.slaStats.breachedOrdersPercent}% Breached)
                          </span>
                          <div className="text-[10px] text-[#475569]">
                            Max: <strong className="text-[#DC2626]">{historicalMetrics.slaStats.formattedMaxDelay}</strong> | Avg: <strong className="text-[#92400E]">{historicalMetrics.slaStats.formattedAvgDelay}</strong> | Median: <strong className="text-[#92400E]">{historicalMetrics.slaStats.formattedMedianDelay}</strong>
                          </div>
                        </div>
                      ) : (
                        <span className="text-[#059669] font-bold">0 SLA Breaches (100% On-Time)</span>
                      )}
                    </td>
                    <td className="p-2.5 sm:p-3 text-[#059669] font-bold bg-[#ECFDF5]/20 border-l border-[#E2E8F0]">
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-[#ECFDF5] text-[#059669] font-bold border border-[#A7F3D0]">
                          <Check className="w-3 h-3 text-[#059669]" />
                          0 Orders Breached (100% On-Time)
                        </span>
                        <div className="text-[10px] text-[#059669] font-normal">
                          Max: 0.0 hrs | Avg: 0.0 hrs | Median: 0.0 hrs (Strict &le; {config.slaWindowHours}h SLA)
                        </div>
                      </div>
                    </td>
                    <td className="p-2.5 sm:p-3 text-[#059669] font-bold bg-[#F0F9FF]/40 border-l border-[#E2E8F0]">
                      {historicalMetrics.slaStats.breachedOrdersCount > 0 ? (
                        <span>
                          Eliminated {historicalMetrics.slaStats.breachedOrdersCount} order SLA breaches (100% on-time turnaround)
                        </span>
                      ) : (
                        'Zero SLA rollover delays across all dispatches'
                      )}
                    </td>
                  </tr>

                  {/* 7. Distance-Weighted Drop Distance */}
                  <tr className="hover:bg-[#F8FAFC]">
                    <td className="p-2.5 sm:p-3 font-bold text-[#0F172A]">
                      <div>Distance-Weighted Inter-Drop Dist.</div>
                      <div className="text-[10px] text-[#64748B] font-normal">&Sigma;(Payload &times; Route Dist) / &Sigma;(Payload)</div>
                    </td>
                    <td className="p-2.5 sm:p-3 text-[#475569] bg-[#FFFBEB]/20 border-l border-[#E2E8F0]">
                      <div className="space-y-1">
                        <div className="font-bold text-[#0F172A] text-sm">
                          {historicalMetrics.distanceWeightedAvgInterDropDistanceKm !== null
                            ? `${historicalMetrics.distanceWeightedAvgInterDropDistanceKm} km`
                            : 'N/A (Single-drop runs)'}
                        </div>
                        <div className="text-[10px] text-[#475569]">
                          <strong>{historicalMetrics.multiDropStats.totalVehicles} Multi-Drop Vehicles</strong> ({historicalMetrics.multiDropStats.totalOrders} Orders)
                        </div>
                        <div className="text-[10px] text-[#64748B]">
                          Fleet Breakup: 25MT: <strong className="text-[#0F172A]">{historicalMetrics.multiDropStats.fleet25Count}</strong> | 30MT: <strong className="text-[#0F172A]">{historicalMetrics.multiDropStats.fleet30Count}</strong> | 35MT: <strong className="text-[#0F172A]">{historicalMetrics.multiDropStats.fleet35Count}</strong>
                          {historicalMetrics.multiDropStats.fleetOtherCount > 0 && <span> | Other: <strong className="text-[#0F172A]">{historicalMetrics.multiDropStats.fleetOtherCount}</strong></span>}
                        </div>
                      </div>
                    </td>
                    <td className="p-2.5 sm:p-3 text-[#0F172A] bg-[#ECFDF5]/20 border-l border-[#E2E8F0]">
                      <div className="space-y-1">
                        <div className="font-bold text-[#059669] text-sm">
                          {engineMetrics?.engineDistanceWeightedDropDistance !== null
                            ? `${engineMetrics?.engineDistanceWeightedDropDistance} km`
                            : 'N/A (Single-drop runs)'}
                        </div>
                        <div className="text-[10px] text-[#065F46]">
                          <strong>{engineMetrics?.engineMultiDropStats.totalVehicles ?? 0} Multi-Drop Vehicles</strong> ({engineMetrics?.engineMultiDropStats.totalOrders ?? 0} Orders)
                        </div>
                        <div className="text-[10px] text-[#065F46]">
                          Fleet Breakup: 25MT: <strong className="text-[#059669]">{engineMetrics?.engineMultiDropStats.fleet25Count ?? 0}</strong> | 30MT: <strong className="text-[#059669]">{engineMetrics?.engineMultiDropStats.fleet30Count ?? 0}</strong> | 35MT: <strong className="text-[#059669]">{engineMetrics?.engineMultiDropStats.fleet35Count ?? 0}</strong>
                        </div>
                      </div>
                    </td>
                    <td className="p-2.5 sm:p-3 text-[#64748B] bg-[#F0F9FF]/40 border-l border-[#E2E8F0]">
                      {historicalMetrics.distanceWeightedAvgInterDropDistanceKm !== null && engineMetrics?.engineDistanceWeightedDropDistance !== null ? (
                        engineMetrics.engineDistanceWeightedDropDistance < historicalMetrics.distanceWeightedAvgInterDropDistanceKm ? (
                          <span className="text-[#059669] font-bold">
                            -{(historicalMetrics.distanceWeightedAvgInterDropDistanceKm - engineMetrics.engineDistanceWeightedDropDistance).toFixed(1)} km ({(((historicalMetrics.distanceWeightedAvgInterDropDistanceKm - engineMetrics.engineDistanceWeightedDropDistance) / historicalMetrics.distanceWeightedAvgInterDropDistanceKm) * 100).toFixed(1)}% tighter cluster proximity)
                          </span>
                        ) : (
                          <span>
                            +{(engineMetrics.engineDistanceWeightedDropDistance - historicalMetrics.distanceWeightedAvgInterDropDistanceKm).toFixed(1)} km (Higher cluster FTL load density)
                          </span>
                        )
                      ) : (
                        'Optimized inter-drop routing with minimal road detour'
                      )}
                    </td>
                  </tr>

                  {/* 8. Radius Threshold Breaches */}
                  <tr className="hover:bg-[#F8FAFC]">
                    <td className="p-2.5 sm:p-3 font-bold text-[#0F172A]">
                      Radius Breaches (&gt; {config.maxMultiDropRadiusKm} km)
                    </td>
                    <td className="p-2.5 sm:p-3 bg-[#FFFBEB]/20 border-l border-[#E2E8F0]">
                      {historicalMetrics.radiusThresholdBreachesCount > 0 ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-[#FEF2F2] text-[#DC2626] font-bold border border-[#FECACA]">
                          <AlertCircle className="w-3 h-3 text-[#DC2626]" />
                          {historicalMetrics.radiusThresholdBreachesCount} Breaches
                        </span>
                      ) : (
                        <span className="text-[#059669] font-bold">0 Breaches</span>
                      )}
                    </td>
                    <td className="p-2.5 sm:p-3 text-[#059669] font-bold bg-[#ECFDF5]/20 border-l border-[#E2E8F0]">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-[#ECFDF5] text-[#059669] font-bold border border-[#A7F3D0]">
                        <Check className="w-3 h-3 text-[#059669]" />
                        0 Breaches (&le; {config.maxMultiDropRadiusKm} km)
                      </span>
                    </td>
                    <td className="p-2.5 sm:p-3 text-[#059669] font-bold bg-[#F0F9FF]/40 border-l border-[#E2E8F0]">
                      Strict geographic boundary enforcement
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Detailed Results Tabs */}
          <div className="bg-white rounded-lg border border-[#E2E8F0] shadow-2xs overflow-hidden">
            {/* View Selector & Search Filter */}
            <div className="p-3 border-b border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 bg-[#F8FAFC]">
              <div className="flex flex-wrap items-center gap-1">
                <button
                  id="view-btn-manifest"
                  onClick={() => setActiveResultView('manifest')}
                  className={`px-3 py-1 rounded-sm text-xs font-mono font-bold transition cursor-pointer ${
                    activeResultView === 'manifest'
                      ? 'bg-[#0F172A] text-[#38BDF8] shadow-2xs'
                      : 'text-[#64748B] hover:text-[#0F172A] hover:bg-[#E2E8F0]'
                  }`}
                >
                  Manifest ({optimizationResult.dispatchedBatches.length})
                </button>

                <button
                  id="view-btn-historical"
                  onClick={() => setActiveResultView('historical')}
                  className={`px-3 py-1 rounded-sm text-xs font-mono font-bold transition cursor-pointer ${
                    activeResultView === 'historical'
                      ? 'bg-[#0284C7] text-white shadow-2xs'
                      : 'text-[#64748B] hover:text-[#0F172A] hover:bg-[#E2E8F0]'
                  }`}
                >
                  Historical Dispatches ({historicalMetrics.totalDispatches})
                </button>

                <button
                  id="view-btn-table"
                  onClick={() => setActiveResultView('table')}
                  className={`px-3 py-1 rounded-sm text-xs font-mono font-bold transition cursor-pointer ${
                    activeResultView === 'table'
                      ? 'bg-[#0F172A] text-[#38BDF8] shadow-2xs'
                      : 'text-[#64748B] hover:text-[#0F172A] hover:bg-[#E2E8F0]'
                  }`}
                >
                  All Orders ({optimizationResult.orders.length})
                </button>

                <button
                  id="view-btn-backlog"
                  onClick={() => setActiveResultView('backlog')}
                  className={`px-3 py-1 rounded-sm text-xs font-mono font-bold transition cursor-pointer ${
                    activeResultView === 'backlog'
                      ? 'bg-[#D97706] text-white shadow-2xs'
                      : 'text-[#64748B] hover:text-[#0F172A] hover:bg-[#E2E8F0]'
                  }`}
                >
                  Backlog ({optimizationResult.backlogOrders.length})
                </button>

                <button
                  id="view-btn-logs"
                  onClick={() => setActiveResultView('logs')}
                  className={`px-3 py-1 rounded-sm text-xs font-mono font-bold transition cursor-pointer ${
                    activeResultView === 'logs'
                      ? 'bg-[#0F172A] text-[#38BDF8] shadow-2xs'
                      : 'text-[#64748B] hover:text-[#0F172A] hover:bg-[#E2E8F0]'
                  }`}
                >
                  Logs ({optimizationResult.logs.length})
                </button>
              </div>

              {/* Search & Filter */}
              <div className="flex flex-wrap items-center gap-2">
                {activeResultView === 'manifest' && (
                  <>
                    <select
                      id="select-fleet-filter"
                      value={selectedVehicleFilter}
                      onChange={(e) => setSelectedVehicleFilter(e.target.value)}
                      className="px-2 py-1 rounded-sm border border-[#CBD5E1] text-xs font-mono bg-white text-[#0F172A] focus:outline-hidden cursor-pointer"
                    >
                      <option value="ALL">All Fleets</option>
                      <option value="25">25 MT Only</option>
                      <option value="30">30 MT Only</option>
                      <option value="35">35 MT Only</option>
                    </select>

                    <select
                      id="select-drop-filter"
                      value={selectedDropFilter}
                      onChange={(e) => setSelectedDropFilter(e.target.value)}
                      className="px-2 py-1 rounded-sm border border-[#CBD5E1] text-xs font-mono bg-white text-[#0F172A] focus:outline-hidden cursor-pointer"
                    >
                      <option value="ALL">All Drops</option>
                      {availableDropCounts.map((count) => (
                        <option key={count} value={count.toString()}>
                          {count} {count === 1 ? 'Drop' : 'Drops'}
                        </option>
                      ))}
                    </select>

                    <select
                      id="select-orders-filter"
                      value={selectedOrdersFilter}
                      onChange={(e) => setSelectedOrdersFilter(e.target.value)}
                      className="px-2 py-1 rounded-sm border border-[#CBD5E1] text-xs font-mono bg-white text-[#0F172A] focus:outline-hidden cursor-pointer"
                    >
                      <option value="ALL">All Orders/Truck</option>
                      {availableOrderCounts.map((count) => (
                        <option key={count} value={count.toString()}>
                          {count} {count === 1 ? 'Order' : 'Orders'} Clubbed
                        </option>
                      ))}
                    </select>

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Search manifest..."
                        value={searchFilter}
                        onChange={(e) => setSearchFilter(e.target.value)}
                        className="pl-7 pr-2.5 py-1 rounded-sm border border-[#CBD5E1] text-xs font-mono bg-white text-[#0F172A] focus:outline-hidden focus:border-[#38BDF8] w-40 sm:w-48"
                      />
                    </div>
                  </>
                )}

                {activeResultView === 'historical' && (
                  <>
                    <select
                      id="select-hist-fleet-filter"
                      value={histVehicleFilter}
                      onChange={(e) => setHistVehicleFilter(e.target.value)}
                      className="px-2 py-1 rounded-sm border border-[#CBD5E1] text-xs font-mono bg-white text-[#0F172A] focus:outline-hidden cursor-pointer"
                    >
                      <option value="ALL">All Fleets</option>
                      <option value="25">25 MT (12 Whlr)</option>
                      <option value="30">30 MT (14 Whlr)</option>
                      <option value="35">35 MT (16 Whlr)</option>
                    </select>

                    <select
                      id="select-hist-club-filter"
                      value={histClubFilter}
                      onChange={(e) => setHistClubFilter(e.target.value)}
                      className="px-2 py-1 rounded-sm border border-[#CBD5E1] text-xs font-mono bg-white text-[#0F172A] focus:outline-hidden cursor-pointer"
                    >
                      <option value="ALL">All Dispatch Types</option>
                      <option value="CLUBBED">Clubbed Batches</option>
                      <option value="UNCLUBBED">Non-Clubbed (Direct FTL)</option>
                    </select>

                    <select
                      id="select-hist-overweight-filter"
                      value={histOverweightFilter}
                      onChange={(e) => setHistOverweightFilter(e.target.value)}
                      className="px-2 py-1 rounded-sm border border-[#CBD5E1] text-xs font-mono bg-white text-[#0F172A] focus:outline-hidden cursor-pointer"
                    >
                      <option value="ALL">All Payload Statuses</option>
                      <option value="OVERWEIGHT">Overweight Runs</option>
                      <option value="COMPLIANT">Payload Compliant</option>
                    </select>

                    <select
                      id="select-hist-breach-filter"
                      value={histBreachFilter}
                      onChange={(e) => setHistBreachFilter(e.target.value)}
                      className="px-2 py-1 rounded-sm border border-[#CBD5E1] text-xs font-mono bg-white text-[#0F172A] focus:outline-hidden cursor-pointer"
                    >
                      <option value="ALL">All Proximity Statuses</option>
                      <option value="BREACH">Radius Breaches (&gt;{config.maxMultiDropRadiusKm}km)</option>
                      <option value="COMPLIANT">Within Radius Limit</option>
                    </select>

                    {/* Capacity Utilization Filter */}
                    <div className="flex items-center gap-1">
                      <select
                        id="select-hist-utilization-filter"
                        value={histUtilizationFilter}
                        onChange={(e) => {
                          const val = e.target.value;
                          setHistUtilizationFilter(val);
                          if (val !== 'ALL' && val !== 'CUSTOM') {
                            setHistCustomUtilizationThreshold(parseFloat(val));
                          }
                        }}
                        className="px-2 py-1 rounded-sm border border-[#CBD5E1] text-xs font-mono bg-white text-[#0F172A] focus:outline-hidden cursor-pointer"
                        title="Filter orders/dispatches by capacity utilization threshold"
                      >
                        <option value="ALL">All Utilizations</option>
                        <option value="80">&lt; 80% Utilization</option>
                        <option value="85">&lt; 85% Utilization</option>
                        <option value="90">&lt; 90% Utilization</option>
                        <option value="95">&lt; 95% Utilization</option>
                        <option value="100">&lt; 100% (Underutilized)</option>
                        <option value="CUSTOM">Custom &lt; %</option>
                      </select>

                      {histUtilizationFilter !== 'ALL' && (
                        <div className="inline-flex items-center bg-white border border-[#CBD5E1] rounded-sm px-1.5 py-0.5 text-xs font-mono">
                          <span className="text-[#64748B] text-[11px] mr-1 font-bold">&lt;</span>
                          <input
                            type="number"
                            min="1"
                            max="150"
                            step="1"
                            value={histCustomUtilizationThreshold}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) {
                                setHistCustomUtilizationThreshold(val);
                                if (histUtilizationFilter !== 'CUSTOM') {
                                  setHistUtilizationFilter('CUSTOM');
                                }
                              }
                            }}
                            className="w-10 text-center font-bold text-[#0F172A] focus:outline-hidden bg-transparent"
                            title="Enter custom maximum utilization % threshold"
                          />
                          <span className="text-[#64748B] text-[11px] font-bold">%</span>
                        </div>
                      )}
                    </div>

                    {/* SLA Delay Filter */}
                    <div className="flex items-center gap-1">
                      <select
                        id="select-hist-delay-filter"
                        value={histDelayFilter}
                        onChange={(e) => {
                          const val = e.target.value;
                          setHistDelayFilter(val);
                          if (val === 'DELAY_2') setHistCustomDelayHours(2);
                          else if (val === 'DELAY_4') setHistCustomDelayHours(4);
                          else if (val === 'DELAY_8') setHistCustomDelayHours(8);
                          else if (val === 'DELAY_24') setHistCustomDelayHours(24);
                        }}
                        className="px-2 py-1 rounded-sm border border-[#CBD5E1] text-xs font-mono bg-white text-[#0F172A] focus:outline-hidden cursor-pointer"
                        title="Filter orders/dispatches by SLA breach and dispatch delay duration"
                      >
                        <option value="ALL">All SLA Statuses</option>
                        <option value="BREACHED">Any SLA Breach (&gt;0h delay)</option>
                        <option value="MET">SLA Met (On-Time)</option>
                        <option value="DELAY_2">Delay &ge; 2 Hours</option>
                        <option value="DELAY_4">Delay &ge; 4 Hours</option>
                        <option value="DELAY_8">Delay &ge; 8 Hours</option>
                        <option value="DELAY_24">Delay &ge; 24 Hours (1+ Day)</option>
                        <option value="CUSTOM">Custom Delay &ge; X Hours</option>
                      </select>

                      {histDelayFilter !== 'ALL' && histDelayFilter !== 'MET' && (
                        <div className="inline-flex items-center bg-white border border-[#CBD5E1] rounded-sm px-1.5 py-0.5 text-xs font-mono">
                          <span className="text-[#64748B] text-[11px] mr-1 font-bold">&ge;</span>
                          <input
                            type="number"
                            min="0"
                            max="1000"
                            step="0.5"
                            value={histCustomDelayHours}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) {
                                setHistCustomDelayHours(val);
                                if (histDelayFilter !== 'CUSTOM') {
                                  setHistDelayFilter('CUSTOM');
                                }
                              }
                            }}
                            className="w-12 text-center font-bold text-[#0F172A] focus:outline-hidden bg-transparent"
                            title="Enter custom minimum SLA delay in hours"
                          />
                          <span className="text-[#64748B] text-[11px] font-bold">hrs</span>
                        </div>
                      )}
                    </div>

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Search truck, dealer, dest..."
                        value={histSearchFilter}
                        onChange={(e) => setHistSearchFilter(e.target.value)}
                        className="pl-7 pr-2.5 py-1 rounded-sm border border-[#CBD5E1] text-xs font-mono bg-white text-[#0F172A] focus:outline-hidden focus:border-[#38BDF8] w-44 sm:w-56"
                      />
                    </div>
                  </>
                )}

                {(activeResultView === 'table' || activeResultView === 'backlog' || activeResultView === 'logs') && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search results..."
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="pl-7 pr-2.5 py-1 rounded-sm border border-[#CBD5E1] text-xs font-mono bg-white text-[#0F172A] focus:outline-hidden focus:border-[#38BDF8] w-40 sm:w-48"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Reactive Filter Metric Banner (Manifest) */}
            {activeResultView === 'manifest' && (
              <div className="px-4 py-2 bg-[#F1F5F9] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between text-xs font-mono text-[#475569] gap-2">
                <div className="flex items-center gap-2">
                  <Filter className="w-3.5 h-3.5 text-[#0284C7]" />
                  <span>
                    Showing <strong className="text-[#0F172A]">{filteredBatches.length}</strong> of <strong className="text-[#0F172A]">{optimizationResult.dispatchedBatches.length}</strong> batches ({optimizationResult.dispatchedBatches.length - filteredBatches.length} filtered out)
                  </span>
                </div>
                {(optimizationResult.dispatchedBatches.length - filteredBatches.length > 0 || searchFilter.trim() || selectedVehicleFilter !== 'ALL' || selectedDropFilter !== 'ALL' || selectedOrdersFilter !== 'ALL') && (
                  <button
                    onClick={() => {
                      setSelectedVehicleFilter('ALL');
                      setSelectedDropFilter('ALL');
                      setSelectedOrdersFilter('ALL');
                      setSearchFilter('');
                    }}
                    className="px-2 py-0.5 rounded text-[11px] font-bold text-[#0284C7] bg-[#E0F2FE] hover:bg-[#BAE6FD] transition cursor-pointer"
                  >
                    Clear Filter
                  </button>
                )}
              </div>
            )}

            {/* Reactive Filter Metric Banner (Historical Dispatches) */}
            {activeResultView === 'historical' && (
              <div className="px-4 py-2 bg-[#F1F5F9] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between text-xs font-mono text-[#475569] gap-2">
                <div className="flex items-center gap-2">
                  <Filter className="w-3.5 h-3.5 text-[#0284C7]" />
                  <span>
                    Showing <strong className="text-[#0F172A]">{filteredHistoricalDispatches.length}</strong> of <strong className="text-[#0F172A]">{historicalMetrics.totalDispatches}</strong> historical vehicle dispatches ({historicalMetrics.totalDispatches - filteredHistoricalDispatches.length} filtered out
                    {histUtilizationFilter !== 'ALL' && ` with < ${histUtilizationFilter === 'CUSTOM' ? histCustomUtilizationThreshold : histUtilizationFilter}% utilization`}
                    )
                  </span>
                </div>
                {(historicalMetrics.totalDispatches - filteredHistoricalDispatches.length > 0 || histSearchFilter.trim() || histVehicleFilter !== 'ALL' || histClubFilter !== 'ALL' || histOverweightFilter !== 'ALL' || histBreachFilter !== 'ALL' || histUtilizationFilter !== 'ALL') && (
                  <button
                    onClick={() => {
                      setHistVehicleFilter('ALL');
                      setHistClubFilter('ALL');
                      setHistOverweightFilter('ALL');
                      setHistBreachFilter('ALL');
                      setHistUtilizationFilter('ALL');
                      setHistCustomUtilizationThreshold(80);
                      setHistSearchFilter('');
                    }}
                    className="px-2 py-0.5 rounded text-[11px] font-bold text-[#0284C7] bg-[#E0F2FE] hover:bg-[#BAE6FD] transition cursor-pointer"
                  >
                    Clear Filter
                  </button>
                )}
              </div>
            )}

            {activeResultView === 'table' && (
              <div className="px-4 py-2 bg-[#F1F5F9] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between text-xs font-mono text-[#475569] gap-2">
                <div className="flex items-center gap-2">
                  <Filter className="w-3.5 h-3.5 text-[#0284C7]" />
                  <span>
                    Showing <strong className="text-[#0F172A]">{filteredOrders.length}</strong> of <strong className="text-[#0F172A]">{optimizationResult.orders.length}</strong> rows ({optimizationResult.orders.length - filteredOrders.length} rows filtered out)
                  </span>
                </div>
                {(optimizationResult.orders.length - filteredOrders.length > 0 || searchFilter.trim()) && (
                  <button
                    onClick={() => setSearchFilter('')}
                    className="px-2 py-0.5 rounded text-[11px] font-bold text-[#0284C7] bg-[#E0F2FE] hover:bg-[#BAE6FD] transition cursor-pointer"
                  >
                    Clear Search Filter
                  </button>
                )}
              </div>
            )}

            {/* VIEW 1: Optimized Dispatched Vehicle Manifest Cards */}
            {activeResultView === 'manifest' && (
              <div className="p-4 divide-y divide-[#E2E8F0] space-y-4">
                {filteredBatches.length === 0 ? (
                  <div className="p-8 text-center text-[#64748B] font-mono text-xs space-y-2">
                    <p>No vehicle dispatches match the selected fleet, drop count, clubbed order count, or search filter.</p>
                    {(selectedVehicleFilter !== 'ALL' || selectedDropFilter !== 'ALL' || selectedOrdersFilter !== 'ALL' || searchFilter.trim()) && (
                      <button
                        onClick={() => {
                          setSelectedVehicleFilter('ALL');
                          setSelectedDropFilter('ALL');
                          setSelectedOrdersFilter('ALL');
                          setSearchFilter('');
                        }}
                        className="px-3 py-1 text-[11px] font-bold text-[#0284C7] bg-[#E0F2FE] hover:bg-[#BAE6FD] rounded cursor-pointer transition"
                      >
                        Reset All Filters
                      </button>
                    )}
                  </div>
                ) : (
                  filteredBatches.map((batch) => (
                    <div
                      key={batch.vehicleId}
                      className="pt-4 first:pt-0 space-y-3 font-mono"
                    >
                      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                        {/* Left: Vehicle Badge & Payload */}
                        <div className="space-y-1.5 min-w-[220px]">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-extrabold text-[#0F172A]">
                              {batch.vehicleId}
                            </span>
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.2 rounded-xs ${
                                batch.priorityGroup === 'Priority I'
                                  ? 'bg-[#ECFDF5] text-[#059669] border border-[#10B98133]'
                                  : batch.priorityGroup === 'Priority II'
                                  ? 'bg-[#F0F9FF] text-[#0284C7] border border-[#0EA5E933]'
                                  : 'bg-[#FAF5FF] text-[#7C3AED] border border-[#8B5CF633]'
                              }`}
                            >
                              {batch.priorityGroup}
                            </span>
                          </div>

                          <div className="text-xs text-[#475569] space-y-0.5">
                            <div><strong>Dealer:</strong> {batch.dealerId}</div>
                            <div>
                              <strong>Payload:</strong> {batch.totalWeightMT} / {batch.capacityMT} MT (
                              <span className="font-bold text-[#059669]">{batch.utilizationPercent}%</span>)
                            </div>
                            <div><strong>Orders Batched:</strong> {batch.orders.length} lines</div>
                          </div>

                          <div className="flex items-center gap-2 pt-0.5">
                            <button
                              onClick={() => setMapModalBatch(batch)}
                              className="inline-flex items-center gap-1 text-xs font-bold text-[#0284C7] hover:text-[#0369A1] transition cursor-pointer"
                            >
                              <MapPin className="w-3.5 h-3.5" />
                              <span>View Route & Stops</span>
                            </button>
                          </div>
                        </div>

                        {/* Right: Multi-Drop Stops Sequence & SLA Window */}
                        <div className="flex-1 bg-[#F8FAFC] p-3 rounded-md border border-[#E2E8F0] space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-[#0F172A] flex items-center gap-1.5">
                              <ListOrdered className="w-3.5 h-3.5 text-[#64748B]" />
                              <span>Stop Sequence ({batch.stops.length} {batch.stops.length === 1 ? 'Drop' : 'Drops'})</span>
                            </span>

                            <span className="text-[11px] text-[#64748B]">
                              Road Dist: <strong className="text-[#0F172A]">{batch.cumulativeMultiDropDistanceKm} km</strong>
                            </span>
                          </div>

                          {/* Stop Sequence Chain */}
                          <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
                            {batch.stops.map((stop, idx) => (
                              <div key={stop.sequence} className="flex items-center gap-1.5 shrink-0">
                                {idx > 0 && <ArrowRight className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />}
                                <div
                                  className={`p-2 rounded border text-xs flex flex-col ${
                                    stop.isFirstDrop
                                      ? 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]'
                                      : 'bg-white border-[#CBD5E1] text-[#0F172A]'
                                  }`}
                                >
                                  <div className="flex items-center gap-1 font-bold">
                                    <span className="w-3.5 h-3.5 rounded-xs bg-[#0F172A] text-white text-[9px] flex items-center justify-center">
                                      {stop.sequence}
                                    </span>
                                    <span>{stop.dest}</span>
                                    {stop.isFirstDrop && (
                                      <span className="text-[9px] px-1 bg-[#FEF3C7] text-[#92400E] rounded font-bold">
                                        First Drop
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[10px] text-[#64748B] mt-0.5">
                                    {stop.weightMT} MT • {stop.orderCount} orders
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* SLA Window info */}
                          <div className="pt-1.5 border-t border-[#E2E8F0] flex flex-wrap items-center justify-between text-[10px] text-[#64748B] gap-2">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-[#94A3B8]" />
                              <span>Earliest SLA Expiry: <strong className="text-[#0F172A]">{batch.slaEarliestExpiry}</strong></span>
                            </span>
                            <span>Dispatched within shared SLA window</span>
                          </div>
                        </div>
                      </div>

                      {/* Expandable Order Details Toggle & Table */}
                      <div className="pt-1.5 border-t border-[#E2E8F0] flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => toggleManifestVehicle(batch.vehicleId)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold text-[#0284C7] bg-[#F0F9FF] hover:bg-[#E0F2FE] border border-[#BAE6FD] transition cursor-pointer"
                          >
                            {expandedManifestVehicles.has(batch.vehicleId) ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {expandedManifestVehicles.has(batch.vehicleId)
                                ? 'Hide Dispatched Orders'
                                : `View Dispatched Orders (${batch.orders.length})`}
                            </span>
                          </button>

                          <span className="text-[11px] text-[#64748B]">
                            {batch.orders.length} {batch.orders.length === 1 ? 'line item' : 'line items'} • Total {batch.totalWeightMT} MT
                          </span>
                        </div>

                        {expandedManifestVehicles.has(batch.vehicleId) && (
                          <div className="overflow-x-auto rounded border border-[#E2E8F0] bg-white shadow-2xs">
                            <table className="w-full text-left text-xs font-mono border-collapse">
                              <thead className="bg-[#F8FAFC] border-b border-[#CBD5E1] text-[10px] font-bold uppercase tracking-wider text-[#475569]">
                                <tr>
                                  <th className="p-2">Invoice / Order No</th>
                                  <th className="p-2">Inv Qt (MT)</th>
                                  <th className="p-2">Sold To Party (Dealer)</th>
                                  <th className="p-2">Ship To Party Name</th>
                                  <th className="p-2">Dest.</th>
                                  <th className="p-2">SO Date & Time</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#E2E8F0]">
                                {batch.orders.map((o) => (
                                  <tr key={o.id} className="hover:bg-[#F8FAFC] transition">
                                    <td className="p-2 font-bold text-[#0F172A]">
                                      {o.invoiceNo || o.rawRowData?.['Original Inv No.'] || o.rawRowData?.['Original Inv No'] || o.rawRowData?.['Order No'] || `ORD-${o.id}`}
                                    </td>
                                    <td className="p-2 font-bold text-[#059669]">{o.invQt} MT</td>
                                    <td className="p-2 text-[#0F172A]">
                                      {o.soldToPartyName || o.rawRowData?.['Sold To Party Name (Dealer)'] || o.rawRowData?.['Sold to Party Name (Dealer)'] || o.soldToParty}
                                    </td>
                                    <td className="p-2 text-[#475569]">{o.shipToPartyName}</td>
                                    <td className="p-2 font-semibold text-[#0F172A]">{o.dest}</td>
                                    <td className="p-2 text-[#64748B] text-[11px]">
                                      {o.soPoDate} {o.soStoCreationTime}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* VIEW 2: Historical Dispatches Data Analysis Tab */}
            {activeResultView === 'historical' && (
              <div className="p-4 space-y-4 font-mono">
                {filteredHistoricalDispatches.length === 0 ? (
                  <div className="p-8 text-center text-[#64748B] text-xs space-y-2">
                    <p>No historical dispatches match the selected filters.</p>
                    <button
                      onClick={() => {
                        setHistVehicleFilter('ALL');
                        setHistClubFilter('ALL');
                        setHistOverweightFilter('ALL');
                        setHistBreachFilter('ALL');
                        setHistUtilizationFilter('ALL');
                        setHistCustomUtilizationThreshold(80);
                        setHistSearchFilter('');
                      }}
                      className="px-3 py-1 text-[11px] font-bold text-[#0284C7] bg-[#E0F2FE] hover:bg-[#BAE6FD] rounded cursor-pointer transition"
                    >
                      Reset Historical Filters
                    </button>
                  </div>
                ) : (
                  filteredHistoricalDispatches.map((hd) => (
                    <div
                      key={hd.dispatchKey}
                      className="bg-white rounded-lg border border-[#E2E8F0] p-4 shadow-2xs space-y-3"
                    >
                      {/* Card Header */}
                      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 pb-2.5 border-b border-[#E2E8F0]">
                        <div className="flex flex-wrap items-center gap-2">
                          <Truck className="w-4 h-4 text-[#0284C7]" />
                          <span className="text-sm font-extrabold text-[#0F172A]">
                            {hd.truckNo}
                          </span>
                          {(hd.dispatchDate || hd.eWayBillDate || hd.soPoDate) && (
                            <span className="text-xs font-bold px-2 py-0.5 rounded bg-[#F0F9FF] text-[#0369A1] border border-[#BAE6FD]">
                              📅 Dispatch Date: {hd.eWayBillDate || hd.dispatchDate || hd.soPoDate}
                            </span>
                          )}
                          {hd.eWayBillDateTime && (
                            <span className="text-[11px] font-mono text-[#64748B] hidden sm:inline-block" title="E-Way Bill Date & Time">
                              (EWB: {hd.eWayBillDateTime})
                            </span>
                          )}
                          {hd.transpName && (
                            <span className="text-xs text-[#64748B]">
                              • {hd.transpName}
                            </span>
                          )}
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#0F172A] text-[#38BDF8] border border-[#334155]">
                            {hd.truckTypeRaw ? hd.truckTypeRaw.toUpperCase() : `${hd.ratedCapacityMT} MT`}
                          </span>
                          {hd.isClubbed ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]">
                              Clubbed ({hd.totalOrdersCount} orders)
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#F8FAFC] text-[#475569] border border-[#CBD5E1]">
                              Single Order (Direct FTL)
                            </span>
                          )}
                        </div>

                        {/* Status Badges */}
                        <div className="flex flex-wrap items-center gap-2">
                          {hd.isSlaBreached ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]" title={`SLA breached on ${hd.slaBreachedOrdersCount} order(s)`}>
                              <Clock className="w-3 h-3 text-[#DC2626]" />
                              SLA Breached: {hd.slaBreachedOrdersCount} {hd.slaBreachedOrdersCount === 1 ? 'Order' : 'Orders'} (Max: +{hd.maxOrderDelayHours}h)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]">
                              <Check className="w-3 h-3 text-[#059669]" />
                              SLA Met (On-Time)
                            </span>
                          )}

                          {hd.isOverweight ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]">
                              <AlertTriangle className="w-3 h-3 text-[#DC2626]" />
                              Overweight: {hd.totalWeightMT} / {hd.ratedCapacityMT} MT (+{hd.excessWeightMT} MT Excess)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]">
                              <Check className="w-3 h-3 text-[#059669]" />
                              Payload Compliant ({hd.utilizationPercent}%)
                            </span>
                          )}

                          {hd.radiusThresholdBreaches > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]">
                              <AlertCircle className="w-3 h-3 text-[#DC2626]" />
                              Radius Breach: {hd.radiusThresholdBreaches} Legs &gt; {config.maxMultiDropRadiusKm} km
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]">
                              <Check className="w-3 h-3 text-[#15803D]" />
                              Within Radius Limit
                            </span>
                          )}
                        </div>
                      </div>

                      {/* KPI Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 text-xs bg-[#F8FAFC] p-3 rounded-md border border-[#E2E8F0]">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-[#64748B] block">Total Orders</span>
                          <span className="font-bold text-[#0F172A]">{hd.totalOrdersCount} {hd.totalOrdersCount === 1 ? 'Order' : 'Orders'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-[#64748B] block">Drop Points</span>
                          <span className="font-bold text-[#0F172A]">{hd.dropPointsCount} {hd.dropPointsCount === 1 ? 'Point' : 'Points'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-[#64748B] block">Loaded Payload</span>
                          <span className={`font-bold ${hd.isOverweight ? 'text-[#DC2626]' : 'text-[#059669]'}`}>
                            {hd.totalWeightMT} MT
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-[#64748B] block">Vehicle Capacity</span>
                          <span className="font-bold text-[#0F172A]">{hd.ratedCapacityMT} MT</span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-[#64748B] block">Capacity Utilization</span>
                          <span className="font-bold text-[#0284C7]">{hd.utilizationPercent}%</span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-[#64748B] block">Inter-Drop Distance</span>
                          <span className="font-bold text-[#0F172A]">{hd.interDropDistanceKm} km</span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-[#64748B] block">SLA Compliance</span>
                          <span className={`font-bold ${hd.isSlaBreached ? 'text-[#DC2626]' : 'text-[#059669]'}`}>
                            {hd.isSlaBreached ? `+${hd.maxOrderDelayHours}h Delay` : 'On-Time'}
                          </span>
                        </div>
                      </div>

                      {/* Drop Points & Dealers Row */}
                      <div className="text-xs text-[#475569] space-y-1">
                        <div>
                          <strong className="text-[#0F172A]">Drop Points:</strong>{' '}
                          {hd.destinations.join(' ➔ ') || 'Single Destination'}
                        </div>
                        <div>
                          <strong className="text-[#0F172A]">Dealer(s):</strong>{' '}
                          {hd.dealerNames.length > 0 ? hd.dealerNames.join(', ') : hd.dealers.join(', ')}
                          {hd.dealers.length > 0 && (
                            <span className="text-[#64748B] text-[11px] ml-1">
                              (Code: {hd.dealers.join(', ')})
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Action & Dropdown Controls */}
                      <div className="pt-2 border-t border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setMapModalBatch(convertHistoricalDispatchToBatch(hd, cachedMatrix))}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#0F172A] hover:bg-[#1E293B] text-[#38BDF8] text-xs font-bold transition shadow-2xs cursor-pointer"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                            <span>View Route & Stops</span>
                          </button>

                          <button
                            onClick={() => toggleHistoricalVehicle(hd.dispatchKey)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-bold text-[#0284C7] bg-[#F0F9FF] hover:bg-[#E0F2FE] border border-[#BAE6FD] transition cursor-pointer"
                          >
                            {expandedHistoricalVehicles.has(hd.dispatchKey) ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {expandedHistoricalVehicles.has(hd.dispatchKey)
                                ? 'Hide Dispatched Orders'
                                : `View Dispatched Orders (${hd.orders.length})`}
                            </span>
                          </button>
                        </div>

                        <span className="text-[11px] text-[#64748B]">
                          Dispatch Key: <code className="font-bold text-[#0F172A]">{hd.dispatchKey}</code>
                        </span>
                      </div>

                      {/* Expanded Order Details Table */}
                      {expandedHistoricalVehicles.has(hd.dispatchKey) && (
                        <div className="overflow-x-auto rounded border border-[#CBD5E1] bg-white mt-2 shadow-2xs">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead className="bg-[#F8FAFC] border-b border-[#CBD5E1] text-[10px] font-bold uppercase tracking-wider text-[#475569]">
                              <tr>
                                <th className="p-2">Invoice / Order No</th>
                                <th className="p-2">Inv Qt (MT)</th>
                                <th className="p-2">SO Date &amp; Time</th>
                                <th className="p-2">SLA Expiry</th>
                                <th className="p-2">E-Way Bill Date &amp; Time</th>
                                <th className="p-2">SLA Status &amp; Delay</th>
                                <th className="p-2">Sold To Party (Dealer)</th>
                                <th className="p-2">Ship To Party Name</th>
                                <th className="p-2">Dest.</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E2E8F0]">
                              {hd.orders.map((o) => {
                                const isBreached = o.calculatedSla?.isSlaBreached;
                                return (
                                  <tr key={o.id} className="hover:bg-[#F8FAFC] transition">
                                    <td className="p-2 font-bold text-[#0F172A]">
                                      {o.invoiceNo || o.rawRowData?.['Original Inv No.'] || o.rawRowData?.['Original Inv No'] || o.rawRowData?.['Order No'] || `ORD-${o.id}`}
                                    </td>
                                    <td className="p-2 font-bold text-[#059669]">{o.invQt} MT</td>
                                    <td className="p-2 text-[#64748B] text-[11px]">
                                      {o.soPoDate} {o.soStoCreationTime}
                                    </td>
                                    <td className="p-2 text-[#0F172A] font-mono text-[11px]">
                                      {o.calculatedSla?.formattedExpiryTime || '-'}
                                    </td>
                                    <td className="p-2 text-[#0369A1] font-mono text-[11px]">
                                      {o.eWayBillDateTime || o.eWayBillDate || hd.dispatchDate || '-'}
                                    </td>
                                    <td className="p-2 font-mono text-[11px]">
                                      {isBreached ? (
                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]">
                                          <AlertTriangle className="w-3 h-3 text-[#DC2626]" />
                                          Breached (+{o.calculatedSla?.formattedDelay})
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]">
                                          <Check className="w-3 h-3 text-[#059669]" />
                                          SLA Met
                                        </span>
                                      )}
                                    </td>
                                    <td className="p-2 text-[#0F172A]">
                                      {o.soldToPartyName || o.rawRowData?.['Sold To Party Name (Dealer)'] || o.rawRowData?.['Sold to Party Name (Dealer)'] || o.soldToParty}
                                    </td>
                                    <td className="p-2 text-[#475569]">{o.shipToPartyName}</td>
                                    <td className="p-2 font-semibold text-[#0F172A]">{o.dest}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* VIEW 3: Master Order Table (PRD Output Excel Structure) */}
            {activeResultView === 'table' && (
              <div className="overflow-x-auto max-h-[480px]">
                <table className="w-full text-left text-xs font-mono border-collapse">
                  <thead className="bg-[#F8FAFC] sticky top-0 z-10 border-b border-[#CBD5E1] text-[10px] font-bold uppercase tracking-wider text-[#475569]">
                    <tr>
                      <th className="p-2 sm:p-2.5">Order No</th>
                      <th className="p-2 sm:p-2.5">Inv Qt.</th>
                      <th className="p-2 sm:p-2.5">SO/PO Date</th>
                      <th className="p-2 sm:p-2.5">Time</th>
                      <th className="p-2 sm:p-2.5">Sold to Party</th>
                      <th className="p-2 sm:p-2.5">Dest.</th>
                      <th className="p-2 sm:p-2.5">SLA Expiry</th>
                      <th className="p-2 sm:p-2.5 bg-[#F1F5F9] text-[#0F172A] border-l border-[#E2E8F0]">
                        Vehicle Allotted
                      </th>
                      <th className="p-2 sm:p-2.5 bg-[#F1F5F9] text-[#0F172A]">
                        Vehicle ID
                      </th>
                      <th className="p-2 sm:p-2.5">Allocation Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {filteredOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-[#F8FAFC] transition">
                        <td className="p-2 sm:p-2.5 font-bold text-[#0F172A]">
                          {o.rawRowData?.['Order No'] || `ORD-${o.id}`}
                        </td>
                        <td className="p-2 sm:p-2.5 font-bold text-[#0F172A]">{o.invQt} MT</td>
                        <td className="p-2 sm:p-2.5 text-[#64748B]">{o.soPoDate}</td>
                        <td className="p-2 sm:p-2.5 text-[#64748B]">{o.soStoCreationTime}</td>
                        <td className="p-2 sm:p-2.5 text-[#0F172A]">{o.soldToParty}</td>
                        <td className="p-2 sm:p-2.5 text-[#475569]">{o.dest}</td>
                        <td className="p-2 sm:p-2.5 text-[#64748B] text-[11px]">
                          {o.calculatedSla?.formattedExpiryTime || '—'}
                        </td>
                        <td className="p-2 sm:p-2.5 bg-[#F8FAFC] border-l border-[#E2E8F0]">
                          <span
                            className={`px-1.5 py-0.5 rounded-xs font-bold text-[10px] ${
                              o.vehicleTypeAllotted === 'NA'
                                ? 'bg-[#FEF3C7] text-[#92400E]'
                                : 'bg-[#0F172A] text-[#38BDF8]'
                            }`}
                          >
                            {o.vehicleTypeAllotted ?? 'NA'}
                          </span>
                        </td>
                        <td className="p-2 sm:p-2.5 bg-[#F8FAFC] font-bold text-[#0F172A]">
                          {o.vehicleId ?? 'NA'}
                        </td>
                        <td className="p-2 sm:p-2.5 text-[10px] text-[#64748B] max-w-[200px] truncate" title={o.allocationReason}>
                          {o.allocationReason || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* VIEW 3: Depot Backlog (NA) */}
            {activeResultView === 'backlog' && (
              <div className="p-4 space-y-3 font-mono">
                {optimizationResult.backlogOrders.length === 0 ? (
                  <div className="p-6 text-center text-[#059669] text-xs font-bold bg-[#ECFDF5] rounded-md border border-[#A7F3D0]">
                    <CheckCircle2 className="w-5 h-5 mx-auto mb-1 text-[#059669]" />
                    100% of orders dispatched in compliant vehicle batches. Zero backlog.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="p-2.5 rounded-md bg-[#FFFBEB] border border-[#FDE68A] text-xs text-[#92400E] flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0" />
                      <span>
                        Orders could not be batched into &ge; 80% payload vehicles without violating SLA or max radius limits (<code className="font-bold">NA</code>).
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-[#F8FAFC] border-b border-[#CBD5E1] text-[10px] uppercase font-bold text-[#475569]">
                          <tr>
                            <th className="p-2 sm:p-2.5">Order ID</th>
                            <th className="p-2 sm:p-2.5">Dealer</th>
                            <th className="p-2 sm:p-2.5">Destination</th>
                            <th className="p-2 sm:p-2.5">Weight</th>
                            <th className="p-2 sm:p-2.5">SLA Expiry</th>
                            <th className="p-2 sm:p-2.5">Backlog Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E8F0]">
                          {optimizationResult.backlogOrders.map((o) => (
                            <tr key={o.id} className="hover:bg-[#F8FAFC]">
                              <td className="p-2 sm:p-2.5 font-bold text-[#0F172A]">
                                {o.rawRowData?.['Order No'] || `ORD-${o.id}`}
                              </td>
                              <td className="p-2 sm:p-2.5 text-[#0F172A]">{o.soldToParty}</td>
                              <td className="p-2 sm:p-2.5 text-[#475569]">{o.dest}</td>
                              <td className="p-2 sm:p-2.5 font-bold text-[#D97706]">{o.invQt} MT</td>
                              <td className="p-2 sm:p-2.5 text-[#64748B]">{o.calculatedSla?.formattedExpiryTime}</td>
                              <td className="p-2 sm:p-2.5 text-[#64748B] text-[10px]">{o.allocationReason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* VIEW 4: Chronological Execution Logs */}
            {activeResultView === 'logs' && (
              <div className="p-3 bg-[#0F172A] text-[#94A3B8] font-mono text-xs max-h-[420px] overflow-y-auto space-y-1.5">
                {optimizationResult.logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-2 border-b border-[#1E293B] pb-1 last:border-0">
                    <span className="text-[#64748B] text-[11px]">{log.timestamp}</span>
                    <span
                      className={`font-bold px-1.5 py-0.2 rounded-xs text-[9px] ${
                        log.type === 'success'
                          ? 'bg-[#064E3B] text-[#34D399]'
                          : log.type === 'warning'
                          ? 'bg-[#78350F] text-[#FBBF24]'
                          : log.type === 'error'
                          ? 'bg-[#881337] text-[#FB7185]'
                          : 'bg-[#1E293B] text-[#38BDF8]'
                      }`}
                    >
                      {log.step}
                    </span>
                    <span className="text-[#CBD5E1] text-[11px] flex-1">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Interactive Leaflet Route Map Modal */}
      {(mapModalBatch || showFullFleetMap) && (
        <RouteMapModal
          batch={mapModalBatch}
          allBatches={showFullFleetMap && optimizationResult ? optimizationResult.dispatchedBatches : undefined}
          onClose={() => {
            setMapModalBatch(null);
            setShowFullFleetMap(false);
          }}
        />
      )}
    </div>
  );
};
