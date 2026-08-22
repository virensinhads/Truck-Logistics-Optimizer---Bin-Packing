import React, { useState } from 'react';
import { Truck, MapPin, Layers, Info, CheckCircle2, Sliders, FileSpreadsheet, X, ShieldAlert } from 'lucide-react';
import { DistanceMatrixData, OptimizationConfig } from '../types';

interface NavbarProps {
  activeTab: 'matrix' | 'optimization';
  setActiveTab: (tab: 'matrix' | 'optimization') => void;
  cachedMatrix: DistanceMatrixData | null;
  config: OptimizationConfig;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  cachedMatrix,
  config,
}) => {
  const [showRulesModal, setShowRulesModal] = useState(false);

  return (
    <header className="h-14 bg-[#0F172A] flex items-center justify-between px-4 sm:px-6 border-b border-[#334155] text-white sticky top-0 z-30">
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Brand Logo Badge (LX) */}
        <div className="bg-[#38BDF8] w-8 h-8 rounded-sm flex items-center justify-center font-bold text-[#0F172A] text-xs font-mono shadow-xs">
          LX
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-white font-semibold text-sm sm:text-base tracking-tight leading-none">
              Logistics Payload & Route Optimization Engine
            </h1>
            <span className="hidden md:inline-block text-[9px] font-mono uppercase font-bold px-1.5 py-0.5 rounded-xs bg-[#1E293B] text-[#38BDF8] border border-[#334155]">
              v2.0 DUAL-PHASE
            </span>
          </div>
          <p className="hidden sm:block text-[10px] text-[#94A3B8] font-mono mt-0.5">
            OpenStreetMap 3-Tier Matrix & Multi-Drop Bin Packing
          </p>
        </div>
      </div>

      {/* Center Tab Navigation */}
      <div className="flex bg-[#1E293B] rounded-md p-1 border border-[#334155]/80">
        <button
          id="tab-btn-matrix"
          onClick={() => setActiveTab('matrix')}
          className={`px-3 sm:px-4 py-1 sm:py-1.5 text-xs font-medium rounded-sm transition-colors flex items-center gap-1.5 ${
            activeTab === 'matrix'
              ? 'bg-[#38BDF8] text-[#0F172A] font-bold shadow-xs'
              : 'text-[#94A3B8] hover:text-white'
          }`}
        >
          <MapPin className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Tab 1:</span>
          <span>Distance Matrix</span>
          {cachedMatrix && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80]" title="Matrix loaded in cache" />
          )}
        </button>

        <button
          id="tab-btn-optimization"
          onClick={() => setActiveTab('optimization')}
          className={`px-3 sm:px-4 py-1 sm:py-1.5 text-xs font-medium rounded-sm transition-colors flex items-center gap-1.5 ${
            activeTab === 'optimization'
              ? 'bg-[#38BDF8] text-[#0F172A] font-bold shadow-xs'
              : 'text-[#94A3B8] hover:text-white'
          }`}
        >
          <Truck className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Tab 2:</span>
          <span>Optimization Engine</span>
        </button>
      </div>

      {/* Right System Status & Rule Button */}
      <div className="flex items-center gap-3">
        <div className="hidden lg:flex items-center gap-1.5 text-[11px] font-mono">
          <span className="text-[10px] uppercase font-bold text-[#94A3B8]">System Status:</span>
          {cachedMatrix ? (
            <span className="flex items-center gap-1.5 font-medium text-[#4ADE80]">
              <span className="w-2 h-2 bg-[#4ADE80] rounded-full animate-pulse"></span>
              OSM Matrix Active ({cachedMatrix.locations.length} pts)
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-medium text-[#F59E0B]">
              <span className="w-2 h-2 bg-[#F59E0B] rounded-full"></span>
              Tiered Engine Ready
            </span>
          )}
        </div>

        <button
          id="btn-rules-info"
          onClick={() => setShowRulesModal(true)}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-mono font-medium rounded-sm bg-[#1E293B] hover:bg-[#334155] text-[#94A3B8] hover:text-white border border-[#334155] transition-colors"
          title="View Optimization Rules & Architecture"
        >
          <Info className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span className="hidden sm:inline">Rules</span>
        </button>
      </div>

      {/* Rules & Architecture Modal */}
      {showRulesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs text-[#1A1C1E]">
          <div className="bg-[#0F172A] border border-[#334155] rounded-lg max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5 text-[#94A3B8] shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#334155]">
              <div className="flex items-center space-x-2">
                <div className="bg-[#38BDF8] w-6 h-6 rounded-xs flex items-center justify-center font-bold text-[#0F172A] text-xs font-mono">
                  LX
                </div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                  Logistics Engine Architecture & Execution Rules
                </h3>
              </div>
              <button
                onClick={() => setShowRulesModal(false)}
                className="p-1 rounded-sm text-[#94A3B8] hover:text-white hover:bg-[#1E293B] transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs leading-relaxed font-mono">
              <div className="p-3 rounded-md bg-[#1E293B] border border-[#334155] space-y-1">
                <div className="font-bold text-[#38BDF8] flex items-center space-x-1.5 uppercase text-[11px]">
                  <MapPin className="w-3.5 h-3.5" />
                  <span>Script 1: 3-Tier Distance Matrix Engine</span>
                </div>
                <p className="text-[#CBD5E1] text-[11px]">
                  1. <strong className="text-white">Tier 1 (OSM Table API):</strong> High-throughput batch distance & duration matrix.<br />
                  2. <strong className="text-white">Tier 2 (OSM Route API):</strong> Pairwise fallback resolution for unresolved nodes.<br />
                  3. <strong className="text-white">Tier 3 (1.3x Haversine):</strong> Infallible road circuity geometric fallback formula.
                </p>
              </div>

              <div className="p-3 rounded-md bg-[#1E293B] border border-[#334155] space-y-1">
                <div className="font-bold text-white flex items-center space-x-1.5 uppercase text-[11px]">
                  <Truck className="w-3.5 h-3.5 text-[#38BDF8]" />
                  <span>Script 2: Hierarchical Grouping Priorities</span>
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-[#CBD5E1] text-[11px]">
                  <li><strong className="text-white">Priority I:</strong> Same Dealer (<code>Sold to Party</code>), Same Location (<code>Dest.</code>)</li>
                  <li><strong className="text-white">Priority II:</strong> Same Dealer, Different Multi-Drop Locations (&le; D_Max)</li>
                  <li><strong className="text-white">Priority III:</strong> Cross-Dealer, Multi-Drop Locations (&le; D_Max)</li>
                </ul>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-md bg-[#1E293B] border border-[#334155] space-y-1">
                  <span className="font-bold text-[#F59E0B] uppercase text-[11px]">Payload &gt;80% Min Load Rule</span>
                  <p className="text-[11px] text-[#CBD5E1]">
                    Prefers 1 larger vehicle over multiple smaller ones.<br />
                    • 25 MT: &ge; 20 MT<br />
                    • 30 MT: &gt; 25 MT<br />
                    • 35 MT: &gt; 30 MT
                  </p>
                </div>

                <div className="p-3 rounded-md bg-[#1E293B] border border-[#334155] space-y-1">
                  <span className="font-bold text-[#4ADE80] uppercase text-[11px]">First Drop & Proximity</span>
                  <p className="text-[11px] text-[#CBD5E1]">
                    Stop 1 is assigned to the highest-weight order line item. Subsequent cumulative drops must satisfy &le; D_Max (5–100 km).
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-md bg-[#1E293B] border border-[#334155] space-y-1">
                <span className="font-bold text-[#C084FC] uppercase text-[11px]">SLA & EOD Roll-Over Logic</span>
                <p className="text-[11px] text-[#CBD5E1]">
                  Orders must share overlapping temporal dispatch windows. Operational Shift: {config.shiftStartTime} to {config.shiftEndTime}. Orders post-shift automatically roll over to next day's shift start.
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end border-t border-[#334155]">
              <button
                onClick={() => setShowRulesModal(false)}
                className="px-4 py-1.5 bg-[#38BDF8] hover:bg-[#0284C7] text-[#0F172A] text-xs font-mono font-bold rounded-sm transition"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
