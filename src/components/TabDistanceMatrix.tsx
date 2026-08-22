import React, { useState, useEffect, useMemo } from 'react';
import {
  MapPin,
  Play,
  Download,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  FileCode,
  Search,
  Layers,
  Sparkles,
  Info,
  Edit2,
  Check
} from 'lucide-react';
import { DistanceMatrixData, LocationPoint, OrderLineItem } from '../types';
import {
  generateDistanceMatrix,
  extractUniqueLocations,
  exportDistanceMatrixToExcel,
  exportDistanceMatrixToJson,
  saveDistanceMatrixToStorage,
  getLocationKey
} from '../utils/distanceMatrixEngine';
import { SAMPLE_SALES_REGISTER_ORDERS } from '../utils/sampleData';
import { parseSalesRegisterFile } from '../utils/excelHandler';

interface TabDistanceMatrixProps {
  cachedMatrix: DistanceMatrixData | null;
  setCachedMatrix: (matrix: DistanceMatrixData | null) => void;
  activeOrders: OrderLineItem[];
  setActiveOrders: (orders: OrderLineItem[]) => void;
}

export const TabDistanceMatrix: React.FC<TabDistanceMatrixProps> = ({
  cachedMatrix,
  setCachedMatrix,
  activeOrders,
  setActiveOrders,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<{
    percent: number;
    step: string;
    processedPairs: number;
    totalPairs: number;
    tierCounts: { osmTable: number; osmRoute: number; haversine: number };
  }>({
    percent: 0,
    step: 'Idle',
    processedPairs: 0,
    totalPairs: 0,
    tierCounts: { osmTable: 0, osmRoute: 0, haversine: 0 },
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [editingCell, setEditingCell] = useState<{ fromKey: string; toKey: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Derive unique locations from activeOrders or sample data
  const currentLocations: LocationPoint[] = useMemo(() => {
    if (activeOrders.length > 0) {
      return extractUniqueLocations(activeOrders);
    }
    return extractUniqueLocations(SAMPLE_SALES_REGISTER_ORDERS);
  }, [activeOrders]);

  // Execute Script 1
  const handleRunScript1 = async () => {
    if (currentLocations.length === 0) {
      setStatusMessage('No valid coordinates found to compute matrix.');
      return;
    }

    setIsRunning(true);
    setStatusMessage(null);

    try {
      const matrixData = await generateDistanceMatrix(currentLocations, (p) => {
        setProgress(p);
      });
      setCachedMatrix(matrixData);
      saveDistanceMatrixToStorage(matrixData);
      setStatusMessage(`Success! Distance matrix generated for ${matrixData.locations.length} locations (${matrixData.stats.totalPairs} pairs) and saved as distanceMatrix.`);
    } catch (err: any) {
      setStatusMessage(`Error generating distance matrix: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsRunning(false);
    }
  };

  // Handle uploaded sales register to extract coordinates
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const orders = await parseSalesRegisterFile(file);
      setActiveOrders(orders);
      setStatusMessage(`Loaded ${orders.length} orders from ${file.name}. Found ${extractUniqueLocations(orders).length} unique coordinate pairs.`);
    } catch (err: any) {
      setStatusMessage(`Failed to read file: ${err?.message || 'Invalid format'}`);
    }
  };

  // Handle manual distance edit
  const handleSaveManualEdit = () => {
    if (!editingCell || !cachedMatrix) return;
    const num = parseFloat(editValue);
    if (isNaN(num) || num < 0) {
      setEditingCell(null);
      return;
    }

    const updated = { ...cachedMatrix };
    if (!updated.matrix[editingCell.fromKey]) {
      updated.matrix[editingCell.fromKey] = {};
      updated.sources[editingCell.fromKey] = {};
    }
    updated.matrix[editingCell.fromKey][editingCell.toKey] = Math.round(num * 100) / 100;
    updated.sources[editingCell.fromKey][editingCell.toKey] = 'manual';

    setCachedMatrix(updated);
    saveDistanceMatrixToStorage(updated);
    setEditingCell(null);
  };

  // Filter locations for grid
  const filteredLocations = useMemo(() => {
    const locationsToUse = cachedMatrix?.locations || currentLocations;
    if (!searchQuery.trim()) return locationsToUse;
    const q = searchQuery.toLowerCase();
    return locationsToUse.filter(
      (l) => l.name.toLowerCase().includes(q) || l.key.includes(q)
    );
  }, [cachedMatrix, currentLocations, searchQuery]);

  return (
    <div className="space-y-4 max-w-7xl mx-auto px-4 sm:px-6 py-5 font-sans">
      {/* Top Banner & Script 1 Info */}
      <div className="bg-white rounded-lg border border-[#E2E8F0] shadow-2xs p-4 sm:p-5 relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-xs bg-[#0F172A] text-[#38BDF8] text-[10px] font-mono font-bold uppercase tracking-wider border border-[#334155]">
              <Sparkles className="w-3 h-3 text-[#38BDF8]" />
              <span>Script 1: 3-Tier Distance Matrix Engine</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#0F172A] tracking-tight">
              Refresh Distance Matrix Engine
            </h1>
            <p className="text-xs text-[#64748B] font-mono leading-relaxed">
              Processes unique coordinates (<code className="text-[11px] bg-[#F1F5F9] px-1 py-0.2 rounded text-[#0F172A]">Lat, Lon</code>) from sales register orders, computes road network distances via <strong className="text-[#0F172A]">OSM Table API</strong> with <strong className="text-[#0F172A]">Route API fallback</strong> and <strong className="text-[#0F172A]">1.3x Haversine circuity</strong>, saving to <code className="text-[11px] bg-[#F1F5F9] px-1 py-0.2 rounded text-[#0F172A]">distanceMatrix</code>.
            </p>
          </div>

          {/* Action Trigger Box */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <label className="flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-white hover:bg-[#F8FAFC] text-[#334155] rounded-sm text-xs font-mono font-semibold cursor-pointer border border-[#CBD5E1] transition shadow-2xs">
              <Upload className="w-3.5 h-3.5 text-[#64748B]" />
              <span>Upload Sales Register</span>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
            </label>

            <button
              id="btn-run-script1"
              onClick={handleRunScript1}
              disabled={isRunning}
              className={`flex items-center justify-center gap-2 px-4 py-1.5 rounded-sm text-xs font-mono font-bold uppercase tracking-wider transition shadow-2xs cursor-pointer ${
                isRunning
                  ? 'bg-[#94A3B8] text-white cursor-not-allowed opacity-75'
                  : 'bg-[#0F172A] hover:bg-[#1E293B] text-[#38BDF8] border border-[#334155]'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin text-[#38BDF8]' : ''}`} />
              <span>{isRunning ? 'Computing...' : 'Generate Matrix (Script 1)'}</span>
            </button>
          </div>
        </div>

        {/* Progress Bar during Execution */}
        {isRunning && (
          <div className="mt-4 pt-3 border-t border-[#E2E8F0] space-y-1.5 font-mono">
            <div className="flex items-center justify-between text-xs font-bold text-[#0F172A]">
              <span className="flex items-center gap-1.5 text-[#0284C7]">
                <span className="w-2 h-2 rounded-full bg-[#0284C7] animate-ping" />
                <span>{progress.step}</span>
              </span>
              <span>{progress.percent}%</span>
            </div>
            <div className="w-full bg-[#F1F5F9] rounded-full h-2 overflow-hidden">
              <div
                className="bg-[#0284C7] h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-[#64748B] pt-0.5">
              <span>Tier 1 (OSM Table): {progress.tierCounts.osmTable}</span>
              <span>Tier 2 (OSM Route): {progress.tierCounts.osmRoute}</span>
              <span>Tier 3 (Haversine 1.3x): {progress.tierCounts.haversine}</span>
            </div>
          </div>
        )}

        {statusMessage && !isRunning && (
          <div className="mt-3 p-2.5 rounded-sm bg-[#F8FAFC] border border-[#CBD5E1] text-xs font-mono text-[#0F172A] flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-[#059669] shrink-0" />
              <span>{statusMessage}</span>
            </div>
            <button onClick={() => setStatusMessage(null)} className="text-[#94A3B8] hover:text-[#0F172A] text-xs cursor-pointer">
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* KPI Stats Cards for Distance Matrix */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-white p-3 rounded-lg border border-[#E2E8F0] shadow-2xs">
          <span className="text-[10px] font-bold text-[#64748B] font-mono uppercase tracking-wider block mb-0.5">
            Unique Coordinates
          </span>
          <div className="text-2xl font-mono font-extrabold text-[#0F172A]">
            {cachedMatrix ? cachedMatrix.locations.length : currentLocations.length}
          </div>
          <span className="text-[10px] font-mono text-[#94A3B8] block">From active dataset</span>
        </div>

        <div className="bg-white p-3 rounded-lg border border-[#E2E8F0] shadow-2xs">
          <span className="text-[10px] font-bold text-[#64748B] font-mono uppercase tracking-wider block mb-0.5">
            Total Distance Pairs (N&times;N)
          </span>
          <div className="text-2xl font-mono font-extrabold text-[#0F172A]">
            {cachedMatrix
              ? cachedMatrix.stats.totalPairs
              : currentLocations.length * currentLocations.length}
          </div>
          <span className="text-[10px] font-mono text-[#94A3B8] block">Pairwise matrix grid</span>
        </div>

        <div className="bg-white p-3 rounded-lg border border-[#E2E8F0] shadow-2xs">
          <span className="text-[10px] font-bold text-[#64748B] font-mono uppercase tracking-wider block mb-0.5">
            OSM Road Network
          </span>
          <div className="text-2xl font-mono font-extrabold text-[#0284C7]">
            {cachedMatrix ? cachedMatrix.stats.osmTablePairs + cachedMatrix.stats.osmRoutePairs : 0}
          </div>
          <span className="text-[10px] font-mono text-[#94A3B8] block">Tier 1 & Tier 2 API</span>
        </div>

        <div className="bg-white p-3 rounded-lg border border-[#E2E8F0] shadow-2xs">
          <span className="text-[10px] font-bold text-[#64748B] font-mono uppercase tracking-wider block mb-0.5">
            Haversine 1.3x Circuity
          </span>
          <div className="text-2xl font-mono font-extrabold text-[#D97706]">
            {cachedMatrix ? cachedMatrix.stats.haversinePairs : currentLocations.length * currentLocations.length}
          </div>
          <span className="text-[10px] font-mono text-[#94A3B8] block">Tier 3 Circuity</span>
        </div>
      </div>

      {/* Matrix Data Viewer & Export Actions */}
      <div className="bg-white rounded-lg border border-[#E2E8F0] shadow-2xs overflow-hidden">
        <div className="p-3 border-b border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 bg-[#F8FAFC]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-xs bg-[#0F172A] text-[#38BDF8] flex items-center justify-center font-mono text-xs font-bold">
              <Layers className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 className="text-sm font-bold font-mono text-[#0F172A]">Distance Matrix Grid Explorer</h2>
              <p className="text-[10px] font-mono text-[#64748B]">
                Pairwise road distances in kilometers (<code className="bg-[#E2E8F0] px-1 py-0.2 rounded text-[#0F172A]">km</code>) between all destinations
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search locations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-7 pr-2.5 py-1 rounded-sm border border-[#CBD5E1] text-xs font-mono bg-white focus:outline-hidden focus:border-[#38BDF8] text-[#0F172A] w-36 sm:w-44"
              />
            </div>

            {/* Export Buttons */}
            {cachedMatrix && (
              <>
                <button
                  id="btn-export-matrix-excel"
                  onClick={() => exportDistanceMatrixToExcel(cachedMatrix, 'distanceMatrix.xlsx')}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-[#059669] hover:bg-[#047857] text-white text-xs font-mono font-bold shadow-2xs transition"
                  title="Download distanceMatrix.xlsx with all sheets"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Export .XLSX</span>
                </button>

                <button
                  id="btn-export-matrix-json"
                  onClick={() => exportDistanceMatrixToJson(cachedMatrix, 'distanceMatrix.json')}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-[#0F172A] hover:bg-[#1E293B] text-[#38BDF8] border border-[#334155] text-xs font-mono font-bold shadow-2xs transition"
                  title="Download distanceMatrix.json structured file"
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>Export JSON</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Matrix Grid Table */}
        <div className="overflow-x-auto max-h-[480px]">
          <table className="w-full text-left text-xs font-mono border-collapse">
            <thead className="bg-[#F8FAFC] sticky top-0 z-10 border-b border-[#CBD5E1]">
              <tr>
                <th className="p-2 sm:p-2.5 font-bold text-[10px] uppercase tracking-wider text-[#475569] bg-[#F1F5F9] sticky left-0 z-20 border-r border-[#CBD5E1] min-w-[160px]">
                  Origin \ Destination
                </th>
                {filteredLocations.map((loc) => (
                  <th key={loc.key} className="p-2 font-bold text-[#475569] min-w-[130px] text-center border-r border-[#E2E8F0]">
                    <div className="truncate max-w-[120px] text-[#0F172A]" title={loc.name}>
                      {loc.name}
                    </div>
                    <div className="text-[9px] text-[#94A3B8]">{loc.key}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {filteredLocations.map((origin) => (
                <tr key={origin.key} className="hover:bg-[#F8FAFC] transition">
                  <td className="p-2 sm:p-2.5 font-bold text-[#0F172A] bg-[#F8FAFC] sticky left-0 z-10 border-r border-[#CBD5E1]">
                    <div className="truncate max-w-[150px]" title={origin.name}>
                      {origin.name}
                    </div>
                    <div className="text-[9px] text-[#94A3B8] font-normal">{origin.key}</div>
                  </td>
                  {filteredLocations.map((dest) => {
                    const isSame = origin.key === dest.key;
                    const distance = cachedMatrix?.matrix?.[origin.key]?.[dest.key] ?? (isSame ? 0 : null);
                    const source = cachedMatrix?.sources?.[origin.key]?.[dest.key] ?? 'haversine';
                    const isEditing = editingCell?.fromKey === origin.key && editingCell?.toKey === dest.key;

                    return (
                      <td
                        key={dest.key}
                        className={`p-2 text-center border-r border-[#E2E8F0] transition ${
                          isSame ? 'bg-[#F1F5F9] text-[#94A3B8]' : 'hover:bg-[#F0F9FF]'
                        }`}
                      >
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="number"
                              step="0.1"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="w-14 px-1 py-0.5 border border-[#38BDF8] rounded text-center text-xs font-mono bg-white focus:outline-hidden"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveManualEdit();
                                if (e.key === 'Escape') setEditingCell(null);
                              }}
                            />
                            <button
                              onClick={handleSaveManualEdit}
                              className="p-0.5 text-[#059669] hover:bg-[#ECFDF5] rounded cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div
                            className="group flex flex-col items-center justify-center cursor-pointer"
                            onClick={() => {
                              if (!isSame && cachedMatrix) {
                                setEditingCell({ fromKey: origin.key, toKey: dest.key });
                                setEditValue(String(distance ?? ''));
                              }
                            }}
                            title="Click to edit distance manually"
                          >
                            <span className="font-bold text-[#0F172A]">
                              {distance != null ? `${distance} km` : '—'}
                            </span>
                            {!isSame && distance != null && (
                              <span
                                className={`text-[8px] font-bold px-1 py-0.2 rounded-xs mt-0.5 ${
                                  source === 'osm-table'
                                    ? 'bg-[#ECFDF5] text-[#059669] border border-[#10B98133]'
                                    : source === 'osm-route'
                                    ? 'bg-[#F0F9FF] text-[#0284C7] border border-[#0EA5E933]'
                                    : source === 'manual'
                                    ? 'bg-[#FAF5FF] text-[#7C3AED] border border-[#8B5CF633]'
                                    : 'bg-[#FFFBEB] text-[#D97706] border border-[#F59E0B33]'
                                }`}
                              >
                                {source === 'osm-table'
                                  ? 'OSM Table'
                                  : source === 'osm-route'
                                  ? 'OSM Route'
                                  : source === 'manual'
                                  ? 'Manual'
                                  : '1.3x Hav'}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Table Footer / Legend */}
        <div className="p-2.5 bg-[#F8FAFC] border-t border-[#CBD5E1] flex flex-wrap items-center justify-between text-[11px] font-mono text-[#64748B] gap-2">
          <div className="flex items-center gap-3">
            <span className="font-bold text-[#0F172A] uppercase text-[10px]">Tier Legend:</span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-[#059669]" />
              <span>OSM Table</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-[#0284C7]" />
              <span>OSM Route</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-[#D97706]" />
              <span>1.3x Haversine</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-[#7C3AED]" />
              <span>Manual</span>
            </span>
          </div>

          <span className="text-[10px] text-[#94A3B8]">
            Click any cell to override road distance manually
          </span>
        </div>
      </div>
    </div>
  );
};
