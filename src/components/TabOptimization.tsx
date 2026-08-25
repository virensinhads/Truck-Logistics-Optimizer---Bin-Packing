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
  ListOrdered
} from 'lucide-react';
import {
  OptimizationConfig,
  ConfigValidationErrors,
  OrderLineItem,
  OptimizationResult,
  VehicleDispatchBatch,
  VehicleType,
  DistanceMatrixData
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
  const [activeResultView, setActiveResultView] = useState<'manifest' | 'table' | 'backlog' | 'logs'>('manifest');
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedVehicleFilter, setSelectedVehicleFilter] = useState<string>('ALL');
  const [selectedDropFilter, setSelectedDropFilter] = useState<string>('ALL');
  const [selectedOrdersFilter, setSelectedOrdersFilter] = useState<string>('ALL');
  const [mapModalBatch, setMapModalBatch] = useState<VehicleDispatchBatch | null>(null);
  const [showFullFleetMap, setShowFullFleetMap] = useState(false);
  const [fileUploadError, setFileUploadError] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

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

      {/* UI Summary Dashboard (Vehicle Counter) */}
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
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#0F172A] hover:bg-[#1E293B] text-white text-xs font-mono font-bold border border-[#334155] transition"
                >
                  <MapPin className="w-3.5 h-3.5 text-[#38BDF8]" />
                  <span>Fleet Map</span>
                </button>

                <button
                  id="btn-export-optimized-excel"
                  onClick={() => exportOptimizationResultToExcel(optimizationResult)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-sm bg-[#059669] hover:bg-[#047857] text-white text-xs font-mono font-bold shadow-2xs transition"
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

          {/* Detailed Results Tabs */}
          <div className="bg-white rounded-lg border border-[#E2E8F0] shadow-2xs overflow-hidden">
            {/* View Selector & Search Filter */}
            <div className="p-3 border-b border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 bg-[#F8FAFC]">
              <div className="flex flex-wrap items-center gap-1">
                <button
                  id="view-btn-manifest"
                  onClick={() => setActiveResultView('manifest')}
                  className={`px-3 py-1 rounded-sm text-xs font-mono font-bold transition ${
                    activeResultView === 'manifest'
                      ? 'bg-[#0F172A] text-[#38BDF8] shadow-2xs'
                      : 'text-[#64748B] hover:text-[#0F172A] hover:bg-[#E2E8F0]'
                  }`}
                >
                  Manifest ({optimizationResult.dispatchedBatches.length})
                </button>

                <button
                  id="view-btn-table"
                  onClick={() => setActiveResultView('table')}
                  className={`px-3 py-1 rounded-sm text-xs font-mono font-bold transition ${
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
                  className={`px-3 py-1 rounded-sm text-xs font-mono font-bold transition ${
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
                  className={`px-3 py-1 rounded-sm text-xs font-mono font-bold transition ${
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
                  </>
                )}

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
              </div>
            </div>

            {/* VIEW 1: Dispatched Vehicle Manifest Cards */}
            {activeResultView === 'manifest' && (
              <div className="p-4 divide-y divide-[#E2E8F0] space-y-3">
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
                      className="pt-3 first:pt-0 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 font-mono"
                    >
                      {/* Left: Vehicle Badge & Payload */}
                      <div className="space-y-1.5 min-w-[200px]">
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

                        <button
                          onClick={() => setMapModalBatch(batch)}
                          className="inline-flex items-center gap-1 text-xs font-bold text-[#0284C7] hover:text-[#0369A1] transition pt-0.5 cursor-pointer"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                          <span>View Route & Stops</span>
                        </button>
                      </div>

                      {/* Right: Multi-Drop Stops Sequence & SLA Window */}
                      <div className="flex-1 bg-[#F8FAFC] p-3 rounded-md border border-[#E2E8F0] space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-[#0F172A] flex items-center gap-1.5">
                            <ListOrdered className="w-3.5 h-3.5 text-[#64748B]" />
                            <span>Stop Sequence ({batch.stops.length} Drops)</span>
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
                  ))
                )}
              </div>
            )}

            {/* VIEW 2: Master Order Table (PRD Output Excel Structure) */}
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
