import React, { useEffect, useRef } from 'react';
import { X, Truck, MapPin, Navigation, ArrowRight, ShieldCheck } from 'lucide-react';
import { VehicleDispatchBatch } from '../types';
import L from 'leaflet';

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

  const batchesToDisplay = batch ? [batch] : (allBatches || []);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Destroy existing instance if any
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    // Default center (e.g. Mumbai industrial region or first batch stop)
    let defaultCenter: [number, number] = [19.076, 72.8777];
    if (batchesToDisplay.length > 0 && batchesToDisplay[0].stops.length > 0) {
      defaultCenter = [batchesToDisplay[0].stops[0].lat, batchesToDisplay[0].stops[0].lon];
    }

    const map = L.map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: 11,
      scrollWheelZoom: true,
    });
    mapInstanceRef.current = map;

    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const latLngBounds = L.latLngBounds([]);
    const routeColors = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2'];

    batchesToDisplay.forEach((b, batchIdx) => {
      const color = routeColors[batchIdx % routeColors.length];
      const stopLatLngs: [number, number][] = [];

      b.stops.forEach((stop, stopIdx) => {
        const point: [number, number] = [stop.lat, stop.lon];
        stopLatLngs.push(point);
        latLngBounds.extend(point);

        // Custom HTML marker pin
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
            box-shadow: 0 3px 6px rgba(0,0,0,0.3);
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

        const marker = L.marker(point, { icon: customIcon }).addTo(map);

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
      });

      // Draw polyline connecting stops
      if (stopLatLngs.length > 1) {
        L.polyline(stopLatLngs, {
          color,
          weight: 4,
          opacity: 0.85,
          dashArray: b.priorityGroup === 'Priority III' ? '6, 8' : undefined,
        }).addTo(map);
      }
    });

    if (latLngBounds.isValid()) {
      map.fitBounds(latLngBounds, { padding: [40, 40], maxZoom: 13 });
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [batchesToDisplay]);

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
              <h3 className="text-sm sm:text-base font-bold font-mono text-white flex items-center gap-2">
                <span>{batch ? `Route Map: Vehicle ${batch.vehicleId}` : 'Fleet Multi-Drop Route Network'}</span>
                {batch && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-xs bg-[#1E293B] text-[#38BDF8] border border-[#334155]">
                    {batch.priorityGroup}
                  </span>
                )}
              </h3>
              <p className="text-[11px] font-mono text-[#94A3B8]">
                {batch
                  ? `${batch.stops.length} stops • ${batch.totalWeightMT} MT payload (${batch.utilizationPercent}%) • ${batch.cumulativeMultiDropDistanceKm} km multi-drop route`
                  : `Visualizing all dispatched vehicle routes`}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-xs text-[#94A3B8] hover:text-white hover:bg-[#1E293B] transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Route Stops Sequence Strip */}
        {batch && (
          <div className="p-2.5 bg-[#F8FAFC] border-b border-[#CBD5E1] flex items-center gap-2 overflow-x-auto text-xs font-mono">
            <span className="font-bold text-[#0F172A] uppercase text-[10px] shrink-0">Stop Sequence:</span>
            {batch.stops.map((stop, i) => (
              <div key={stop.sequence} className="flex items-center gap-1.5 shrink-0">
                {i > 0 && <ArrowRight className="w-3 h-3 text-[#94A3B8]" />}
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
            ))}
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
