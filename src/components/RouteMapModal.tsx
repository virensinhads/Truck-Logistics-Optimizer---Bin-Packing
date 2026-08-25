import React, { useEffect, useRef, useState, useMemo } from 'react';
import { X, Navigation, ArrowRight, Route, Loader2 } from 'lucide-react';
import { VehicleDispatchBatch } from '../types';
import L from 'leaflet';
import { fetchRoadRouteGeometry, RouteLegDetail } from '../utils/distanceMatrixEngine';

interface RouteMapModalProps {
  batch: VehicleDispatchBatch | null;
  allBatches?: VehicleDispatchBatch[];
  onClose: () => void;
}

export const RouteMapModal: React.FC<RouteMapModalProps> = ({
  batch,
  allBatches,
  onClose,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const roadLayersRef = useRef<L.LayerGroup | null>(null);

  const [isLoadingRoads, setIsLoadingRoads] = useState(false);
  const [roadRoutingStatus, setRoadRoutingStatus] = useState<'loading' | 'road' | 'direct'>('loading');
  const [roadDistances, setRoadDistances] = useState<Record<string, { distanceKm: number; durationMin: number; legs: RouteLegDetail[] }>>({});

  // Compute a stable list of batches to render
  const batchesToDisplay = useMemo(() => {
    if (batch) return [batch];
    return allBatches || [];
  }, [batch, allBatches]);

  // Stable string key to prevent any accidental re-init loop
  const modalTargetKey = useMemo(() => {
    if (batch) return `batch_${batch.vehicleId}_${batch.stops.length}`;
    if (allBatches) return `all_${allBatches.length}`;
    return 'none';
  }, [batch, allBatches]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // 1. Teardown any existing map instance
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    if (batchesToDisplay.length === 0) return;

    let defaultCenter: [number, number] = [19.076, 72.8777];
    if (batchesToDisplay[0].stops.length > 0) {
      defaultCenter = [batchesToDisplay[0].stops[0].lat, batchesToDisplay[0].stops[0].lon];
    }

    const map = L.map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: 11,
      scrollWheelZoom: true,
    });
    mapInstanceRef.current = map;

    // OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const staticGroup = L.layerGroup().addTo(map);
    const roadGroup = L.layerGroup().addTo(map);
    roadLayersRef.current = roadGroup;

    const latLngBounds = L.latLngBounds([]);
    const routeColors = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2'];

    // 2. Add Stop Markers and initial straight lines
    batchesToDisplay.forEach((b, batchIdx) => {
      const color = routeColors[batchIdx % routeColors.length];

      b.stops.forEach((stop) => {
        const point: [number, number] = [stop.lat, stop.lon];
        latLngBounds.extend(point);

        const isFirst = stop.isFirstDrop;
        const iconHtml = `
          <div style="
            background: ${isFirst ? '#f59e0b' : color};
            color: white;
            font-weight: bold;
            font-size: 11px;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 3px 6px rgba(0,0,0,0.35);
            border: 2px solid white;
          ">
            ${stop.sequence}
          </div>
        `;

        const customIcon = L.divIcon({
          html: iconHtml,
          className: 'custom-map-pin',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        const marker = L.marker(point, { icon: customIcon });
        const popupContent = `
          <div style="font-family: sans-serif; font-size: 12px; line-height: 1.4;">
            <div style="font-weight: bold; color: #0f172a; margin-bottom: 2px;">
              ${isFirst ? '⭐ First Drop (Stop 1)' : `Stop ${stop.sequence}`} - ${stop.dest}
            </div>
            <div style="color: #475569; margin-bottom: 4px;"><strong>Vehicle:</strong> ${b.vehicleId} (${b.capacityMT} MT)</div>
            <div style="color: #475569;"><strong>Drop Tonnage:</strong> ${stop.weightMT} MT (${stop.orderCount} orders)</div>
            ${stop.distanceFromPreviousKm > 0 ? `<div style="color: #2563eb; margin-top: 2px;"><strong>Leg Distance:</strong> ${stop.distanceFromPreviousKm} km</div>` : ''}
          </div>
        `;
        marker.bindPopup(popupContent);
        staticGroup.addLayer(marker);
      });

      // Straight connection guide while roads are loading
      if (b.stops.length > 1) {
        const straightCoords: [number, number][] = b.stops.map((s) => [s.lat, s.lon]);
        const straightLine = L.polyline(straightCoords, {
          color,
          weight: 2.5,
          opacity: 0.4,
          dashArray: '4, 6',
        });
        staticGroup.addLayer(straightLine);
      }
    });

    if (latLngBounds.isValid()) {
      map.fitBounds(latLngBounds, { padding: [45, 45], maxZoom: 14 });
    }

    // 3. Pairwise N-1 Road Leg Asynchronous Fetching
    let isCancelled = false;
    setIsLoadingRoads(true);

    const fetchRoads = async () => {
      const distMap: Record<string, { distanceKm: number; durationMin: number; legs: RouteLegDetail[] }> = {};
      let anyRoadSuccess = false;

      for (let i = 0; i < batchesToDisplay.length; i++) {
        if (isCancelled) return;
        const b = batchesToDisplay[i];
        if (b.stops.length < 2) continue;

        const color = routeColors[i % routeColors.length];

        try {
          const roadResult = await fetchRoadRouteGeometry(b.stops);
          if (isCancelled) return;

          if (roadResult && roadResult.coordinates.length > 1) {
            anyRoadSuccess = true;
            distMap[b.vehicleId] = {
              distanceKm: roadResult.distanceKm,
              durationMin: roadResult.durationMin,
              legs: roadResult.legs,
            };

            if (roadLayersRef.current) {
              // 1. Outer white contrast casing for the entire combined route
              const casing = L.polyline(roadResult.coordinates, {
                color: '#ffffff',
                weight: 7,
                opacity: 0.9,
              });
              roadLayersRef.current.addLayer(casing);

              // 2. Individual pairwise leg polylines with detailed leg popups
              roadResult.legs.forEach((leg) => {
                const legLine = L.polyline(leg.coordinates, {
                  color,
                  weight: 4.5,
                  opacity: 0.95,
                  lineCap: 'round',
                  lineJoin: 'round',
                });

                legLine.bindPopup(`
                  <div style="font-family: sans-serif; font-size: 12px; line-height: 1.45; min-width: 170px;">
                    <div style="font-weight: bold; color: #0f172a; margin-bottom: 3px;">
                      Leg ${leg.fromIndex} → ${leg.toIndex}
                    </div>
                    <div style="color: #475569; font-size: 11px; margin-bottom: 4px;">
                      ${leg.fromDest || `Stop ${leg.fromIndex}`} ➔ ${leg.toDest || `Stop ${leg.toIndex}`}
                    </div>
                    <div style="color: #16a34a; font-weight: 600;">
                      🛣️ Leg Distance: ${leg.distanceKm} km
                    </div>
                    <div style="color: #0284c7; font-size: 11px;">
                      ⏱️ Est. Driving: ~${leg.durationMin} min
                    </div>
                    <div style="margin-top: 5px; padding-top: 4px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 10px;">
                      Vehicle: ${b.vehicleId} • Total: ${roadResult.distanceKm} km
                    </div>
                  </div>
                `);

                roadLayersRef.current?.addLayer(legLine);
              });
            }
          }
        } catch {
          // Ignore individual fetch failure
        }
      }

      if (!isCancelled) {
        setIsLoadingRoads(false);
        setRoadRoutingStatus(anyRoadSuccess ? 'road' : 'direct');
        setRoadDistances(distMap);
      }
    };

    fetchRoads();

    return () => {
      isCancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [modalTargetKey]);

  const activeBatchRoadInfo = batch ? roadDistances[batch.vehicleId] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-xs font-sans">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-[#334155]">
        {/* Header */}
        <div className="p-3 sm:p-4 bg-[#0F172A] text-white flex items-center justify-between border-b border-[#1E293B]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xs bg-[#1E293B] border border-[#334155] flex items-center justify-center text-[#38BDF8]">
              <Navigation className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm sm:text-base font-bold font-mono text-white flex items-center gap-2">
                  <span>{batch ? `Route Map: Vehicle ${batch.vehicleId}` : 'Fleet Multi-Drop Route Network'}</span>
                  {batch && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-xs bg-[#1E293B] text-[#38BDF8] border border-[#334155]">
                      {batch.priorityGroup}
                    </span>
                  )}
                </h3>

                {/* Road Network Routing Status Badge */}
                {isLoadingRoads ? (
                  <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-[#1E293B] text-[#93C5FD] border border-[#3B82F6]/40">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Evaluating pairwise N-1 road segments...</span>
                  </span>
                ) : roadRoutingStatus === 'road' ? (
                  <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-[#064E3B]/80 text-[#6EE7B7] border border-[#059669]">
                    <Route className="w-3 h-3 text-[#34D399]" />
                    <span>Point-to-Point Road Network (OSRM)</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-[#451A03] text-[#FCD34D] border border-[#D97706]/50">
                    <span>Euclidean Straight Line (Offline)</span>
                  </span>
                )}
              </div>

              <p className="text-[11px] font-mono text-[#94A3B8] mt-0.5">
                {batch
                  ? `${batch.stops.length} stops • ${batch.totalWeightMT} MT payload (${batch.utilizationPercent}%) • ` +
                    (activeBatchRoadInfo
                      ? `${activeBatchRoadInfo.distanceKm} km on-road (${activeBatchRoadInfo.legs.length} pairwise legs, ~${activeBatchRoadInfo.durationMin} min)`
                      : `${batch.cumulativeMultiDropDistanceKm} km multi-drop route`)
                  : `Visualizing all dispatched vehicle routes`}
              </p>
            </div>
          </div>

          <button
            id="btn-close-route-map"
            onClick={onClose}
            className="p-1 rounded-xs text-[#94A3B8] hover:text-white hover:bg-[#1E293B] transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Route Stops Sequence Strip with Pairwise Leg Distances */}
        {batch && (
          <div className="p-2.5 bg-[#F8FAFC] border-b border-[#CBD5E1] flex items-center justify-between gap-2 overflow-x-auto text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#0F172A] uppercase text-[10px] shrink-0">Stop Sequence:</span>
              {batch.stops.map((stop, i) => {
                const legInfo = activeBatchRoadInfo?.legs?.[i - 1];
                return (
                  <div key={stop.sequence} className="flex items-center gap-1.5 shrink-0">
                    {i > 0 && (
                      <div className="flex items-center gap-1 px-1 text-[10px] text-[#0284C7] font-semibold">
                        <ArrowRight className="w-3 h-3 text-[#94A3B8]" />
                        {legInfo ? (
                          <span className="px-1.5 py-0.5 rounded bg-[#E0F2FE] border border-[#BAE6FD] text-[#0369A1] font-bold">
                            {legInfo.distanceKm} km
                          </span>
                        ) : null}
                      </div>
                    )}
                    <div
                      className={`px-2 py-0.5 rounded-xs border flex items-center gap-1.5 ${
                        stop.isFirstDrop
                          ? 'bg-[#FFFBEB] border-[#F59E0B] text-[#B45309] font-bold'
                          : 'bg-white border-[#CBD5E1] text-[#334155] font-semibold'
                      }`}
                    >
                      <span
                        className={`w-3.5 h-3.5 rounded-full text-[9px] flex items-center justify-center font-bold ${
                          stop.isFirstDrop ? 'bg-[#D97706] text-white' : 'bg-[#E2E8F0] text-[#0F172A]'
                        }`}
                      >
                        {stop.sequence}
                      </span>
                      <span>{stop.dest}</span>
                      <span className="text-[10px] text-[#64748B]">({stop.weightMT} MT)</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {activeBatchRoadInfo && (
              <div className="hidden sm:flex items-center gap-1.5 shrink-0 text-[11px] text-[#0369A1] bg-[#E0F2FE] border border-[#BAE6FD] px-2 py-0.5 rounded font-bold">
                <Route className="w-3 h-3 text-[#0284C7]" />
                <span>Road Total: {activeBatchRoadInfo.distanceKm} km (~{activeBatchRoadInfo.durationMin}m)</span>
              </div>
            )}
          </div>
        )}

        {/* Map Canvas Container */}
        <div className="flex-1 min-h-[420px] relative bg-[#F1F5F9]">
          <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />
        </div>

        {/* Footer */}
        <div className="p-2.5 bg-[#0F172A] border-t border-[#1E293B] flex items-center justify-between text-xs font-mono text-[#94A3B8]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-[#D97706] border border-white inline-block shadow-2xs" />
              <span className="text-white text-[11px]">Stop 1 (First Drop / Highest Weight)</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0284C7] border border-white inline-block shadow-2xs" />
              <span className="text-white text-[11px]">Subsequent Multi-Drops</span>
            </span>
          </div>

          <button
            onClick={onClose}
            className="px-3 py-1 rounded-sm bg-[#1E293B] hover:bg-[#334155] text-white border border-[#475569] font-bold text-xs cursor-pointer transition shadow-2xs"
          >
            Close Map
          </button>
        </div>
      </div>
    </div>
  );
};
