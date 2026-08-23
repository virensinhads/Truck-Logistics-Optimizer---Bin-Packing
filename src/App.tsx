/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { OptimizationConfig, DistanceMatrixData, OrderLineItem } from './types';
import { Navbar } from './components/Navbar';
import { TabDistanceMatrix } from './components/TabDistanceMatrix';
import { TabOptimization } from './components/TabOptimization';
import { loadDistanceMatrixFromStorage } from './utils/distanceMatrixEngine';
import { SAMPLE_SALES_REGISTER_ORDERS } from './utils/sampleData';

export default function App() {
  const [activeTab, setActiveTab] = useState<'matrix' | 'optimization'>('optimization');

  // Default optimization configuration matching PRD specs
  const [config, setConfig] = useState<OptimizationConfig>({
    enabledVehicleTypes: ['25', '30', '35'],
    minUtilizationPercent: 80, // 40 to 100%
    slaWindowHours: 2.0, // 1 to 4 hours
    maxMultiDropRadiusKm: 35, // 5 to 100 km
    shiftStartTime: '10:00',
    shiftEndTime: '17:00',
  });

  // Loaded or generated distance matrix cache
  const [cachedMatrix, setCachedMatrix] = useState<DistanceMatrixData | null>(null);

  // Active sales register orders (default initialized with sample dataset)
  const [activeOrders, setActiveOrders] = useState<OrderLineItem[]>(() => {
    return SAMPLE_SALES_REGISTER_ORDERS.map((item) => ({ ...item }));
  });

  // Load any previously persisted distance matrix from storage on start
  useEffect(() => {
    const saved = loadDistanceMatrixFromStorage();
    if (saved) {
      setCachedMatrix(saved);
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#F4F4F7] text-[#1A1C1E] flex flex-col selection:bg-[#38BDF8] selection:text-[#0F172A]">
      {/* Top Navbar Header */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        cachedMatrix={cachedMatrix}
        config={config}
      />

      {/* Main Tabbed Content */}
      <main className="flex-1 pb-10">
        {activeTab === 'matrix' ? (
          <TabDistanceMatrix
            cachedMatrix={cachedMatrix}
            setCachedMatrix={setCachedMatrix}
            activeOrders={activeOrders}
            setActiveOrders={setActiveOrders}
          />
        ) : (
          <TabOptimization
            config={config}
            setConfig={setConfig}
            cachedMatrix={cachedMatrix}
            activeOrders={activeOrders}
            setActiveOrders={setActiveOrders}
          />
        )}
      </main>

      {/* High-Density Footer Bar */}
      <footer className="bg-[#0F172A] border-t border-[#334155] py-2.5 px-4 sm:px-6 text-[11px] font-mono text-[#94A3B8]">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-1.5">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#38BDF8]"></span>
            <span className="text-white font-medium">Logistics Payload & Route Optimization Engine</span>
            <span className="text-[#64748B]">|</span>
            <span>OSM 3-Tier Distance Matrix + Multi-Drop Heuristics</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[#38BDF8]">MIN FLEET ALLOCATION</span>
            <span className="text-[#64748B]">•</span>
            <span className="text-[#4ADE80]">&ge;{config.minUtilizationPercent ?? 80}.0% UTILIZATION TARGET</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
