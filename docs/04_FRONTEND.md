# 04 - Frontend Architecture, UI/UX Specs & State Management

## 1. Frontend Technology Stack & Design System

The client-side interface is built on modern web standards prioritizing responsiveness, dense operational usability, and clean typographic hierarchy:
- **Framework**: React 19 (Functional Components with Hooks)
- **TypeScript**: Version ~5.8 (Strict type definitions across all UI and data models in `src/types.ts`)
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite`)
- **Iconography**: `lucide-react` exclusively
- **Motion & Transitions**: `motion/react`
- **Mapping**: `leaflet` with OpenStreetMap Carto tiles
- **Color Architecture**:
  - Primary Slate: `#0F172A` (Headings, titles, primary cards)
  - Secondary Slate: `#475569` & `#64748B` (Labels, secondary text, metadata)
  - Sky Accent: `#0284C7` & `#0EA5E9` (Interactive actions, links, primary buttons)
  - Emerald Positive: `#059669` (High utilization, SLA on-time badges, optimization wins)
  - Amber Warning: `#D97706` (Moderate delays, intermediate warnings)
  - Red Critical: `#DC2626` (SLA breaches, overweight dispatches, radius threshold violations)
  - Card & Background: `#FFFFFF` and `#F8FAFC` bordered with `#E2E8F0`

---

## 2. Component Hierarchy & Tree

```
src/
├── main.tsx                      # Root mounting to #root
└── App.tsx                       # Root App Container (activeTab, global state)
    │
    ├── Navbar.tsx                # Header bar, branding, PPTX presentation export button
    │
    ├── TabDistanceMatrix.tsx     # Tab 1: Distance Matrix Engine (Script 1)
    │   ├── Upload & Action Card  # File drag-and-drop, sample load, "Evaluate Distance" button
    │   ├── Calculation Status    # Progress bar, active OSRM tier, computation time
    │   ├── Custom Matrix Tools   # Upload pre-calculated matrix (Pairwise / Grid), Export matrix
    │   └── Matrix Grid Inspector # Paginated NxN table with search, filtering & inline editing
    │
    ├── TabOptimization.tsx       # Tab 2: Payload & Route Optimization (Script 2)
    │   ├── Config Panel          # Fleet selection, capacities (MT/CFT), SLA shift timings, radius limit
    │   ├── Audit Scorecard       # Historical vs. Engine Comparative Performance Table
    │   │   ├── Fleet Vehicle Requirements
    │   │   ├── Clubbed Multi-Drop Orders
    │   │   ├── SLA Breaches & Delays (Count, %, Max, Avg, Median Delay)
    │   │   ├── Distance-Weighted Inter-Drop Dist. (Vehicles, Orders & Fleet Breakup)
    │   │   ├── Radius Violations (>35km)
    │   │   └── Overweight Dispatches
    │   ├── Action Controls       # Run Optimizer button & Export Final Plan to Excel
    │   ├── Optimized Batches     # Cards per vehicle dispatch, payload utilization bars, stop sequences
    │   └── Historical Dispatches # Audit viewer with Delay Filter Bar (All, Met, Breached, >=2h..24h, custom)
    │
    └── RouteMapModal.tsx         # Leaflet GIS modal rendering origin, stops & routed polylines
```

---

## 3. UI/UX Specifications & Workflows

### 3.1 Tab 1: Distance Matrix Engine (`TabDistanceMatrix.tsx`)
- **Drag-and-Drop Dropzone**: Supports `.xlsx`, `.xls`, and `.csv`. Features automatic column header detection for latitude, longitude, and destination labels.
- **Evaluation Engine**: Triggers sequential or batched calls to OSRM with animated progress indicators. In case of local OSRM failure, shows transparent badge: `"Fallback Tier: OpenStreetMap"` or `"Fallback Tier: Haversine 1.3x"`.
- **Editable Distance Table**: Allows supply chain supervisors to click any distance cell, input a revised road distance in kilometers, and persist the modification in `localStorage`.

### 3.2 Tab 2: Payload & Route Optimization (`TabOptimization.tsx`)
- **Configuration Drawer**:
  - Depot Coordinates: Latitude and longitude of dispatch origin plant.
  - Fleet Allocation: Dynamic toggle for 25 MT, 30 MT, 35 MT, or custom capacity vehicles.
  - Multi-Drop Parameters: Max drops per vehicle (default: 3) and Max cluster radius (default: 35 km).
  - SLA Timing Windows: Shift start (default: 10:00), shift end (default: 17:00), and SLA turnaround window (default: 2 hours).
- **Comparative Analysis Table**:
  - Instant visual audit showing historical plant actuals versus optimization engine projections.
  - Highlights SLA breaches with badge indicators, average turnaround delay, and median delay.
  - Detailed breakdown of multi-drop vehicles, orders, and vehicle capacity distribution (25MT, 30MT, 35MT).
- **SLA Delay Filter Bar**:
  - Filter historical dispatches by SLA compliance:
    - `All SLA Statuses`
    - `Any SLA Breach (>0h delay)`
    - `SLA Met (On-Time)`
    - `Delay >= 2 Hours`
    - `Delay >= 4 Hours`
    - `Delay >= 8 Hours`
    - `Delay >= 24 Hours`
    - `Custom Delay >= X Hours` (with numeric input box)

### 3.3 Route Visualizer Modal (`RouteMapModal.tsx`)
- Uses Leaflet to dynamically fit map bounds to all coordinates in the active dispatch batch.
- Depot marked with a distinct green warehouse pin.
- Stops are numbered sequentially (1, 2, 3...) based on the exact permutation optimization.
- Displays inter-drop distances and total leg metrics.

---

## 4. State Management Architecture

The application relies on lightweight, reactive React state combined with browser `localStorage` caching:

| State Variable | Scope | Description |
|---|---|---|
| `activeTab` | `App.tsx` | Active view: `'matrix'` or `'optimization'`. |
| `activeOrders` | `App.tsx` | Ingested order line items parsed from Excel or loaded from sample dataset. |
| `cachedMatrix` | `App.tsx` | $N \times N$ road distances and durations cached in memory and synced to `localStorage`. |
| `config` | `TabOptimization.tsx` | User-configured fleet limits, depot coordinates, radius limits, and SLA windows. |
| `optimizationResult` | `TabOptimization.tsx` | Computed vehicle dispatch batches, unassigned orders, and summary metrics. |
| `histDelayFilter` | `TabOptimization.tsx` | Selected filter option for historical SLA delay auditing. |
| `histCustomDelayHours` | `TabOptimization.tsx` | User-defined threshold for minimum hours of SLA delay filter. |
| `activeMapBatch` | `TabOptimization.tsx` | Currently inspected vehicle dispatch batch displayed in the Leaflet modal. |
