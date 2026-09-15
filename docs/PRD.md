# Product Requirements Document (PRD)

## Project Title: Logistics Payload & Route Optimization Engine
**Document Version:** 1.2.0  
**Target Users:** Supply Chain Managers, Dispatch Coordinators, Plant Logistics Planners, Fleet Operators  
**Platform:** Modern Web Browser (Client-Side Single Page Application)

---

## 1. Executive Summary & Problem Statement

### 1.1 The Problem
In industrial manufacturing and FMCG supply chains, dispatch planners daily receive hundreds of unorganized order line items across diverse dealers and destinations. Historically, dispatch teams manually assign orders to contracted trucks using static experience or arbitrary grouping. This manual dispatch planning results in:
- **Low Fleet Utilization**: Trucks dispatched with sub-optimal weight payloads (<75% capacity) or inefficient volumetric loading.
- **Excessive Delivery Mileage**: Multi-drop deliveries planned without road-distance validation, creating circuitous detours that violate maximum cluster radius thresholds.
- **Service Level Agreement (SLA) Breaches**: Orders dispatched past required cut-off deadlines, resulting in customer dissatisfaction, penalties, and delivery delays of several hours to days.
- **Lack of Auditing & Comparison**: Logistics leadership lacks automated side-by-side comparative benchmarking between historical actual dispatches and mathematically optimal dispatch plans.

### 1.2 The Solution
The **Logistics Payload & Route Optimization Engine** is a two-phase decision intelligence platform that ingests raw sales register spreadsheets, computes high-fidelity road distance matrices via an OSRM routing engine, executes multi-drop bin-packing and exact-permutation route sequencing, and provides comprehensive comparative analytics against historical dispatch actuals.

---

## 2. User Personas

| Persona | Role | Primary Goals | Key Pain Points |
|---|---|---|---|
| **Dispatch Planner** | Plant Logistics Executive | Pack today's unassigned orders into the minimum number of trucks while respecting weight, volume, and customer SLA windows. | Time-consuming manual spreadsheet manipulation; uncertainty about multi-drop driving distances. |
| **Fleet Manager** | Transport Operations Head | Maximize FTL (Full Truckload) payload utilization (target &ge; 85%) and eliminate unauthorized multi-drop mileage detours. | Drivers taking uncoordinated drop sequences; overweight vehicle penalties. |
| **Supply Chain VP** | Executive Leadership | Audit plant dispatch efficiency, quantify cost-reduction opportunities, and measure SLA compliance improvements. | Lack of clean executive reporting; no verifiable benchmark comparing historical actuals to optimal plans. |

---

## 3. Scope of the System

### In-Scope:
- Ingestion of raw Excel/CSV sales registers containing order IDs, quantities (MT), volume (CFT), dealer info, destination names, GPS coordinates, and historical dispatch data.
- Extraction of distinct destination waypoints and generation of pairwise road distance and driving duration matrices.
- Multi-tier routing fallback (Local OSRM $\to$ Public OpenStreetMap $\to$ Geodesic Haversine with 1.3x circuity factor).
- Interactive spreadsheet matrix viewer with search, filtering, and manual inline distance editing.
- Payload bin-packing engine supporting standard fleet profiles (e.g. 25MT, 30MT, 35MT, Bolero/Pickups) and configurable utilization targets.
- Multi-drop clustering constrained by maximum radius (&le; 35 km) and maximum drop stops (&le; 3 drops).
- Exact permutation route sequencing to mathematically prove minimal inter-drop mileage.
- Order SLA calculation engine evaluating order creation time against warehouse working hours (10:00 to 17:00) with next-day rollover logic.
- E-Way Bill actual dispatch comparison calculating SLA compliance, breach count, and delay durations (Max, Avg, Median).
- Interactive Leaflet geovisualization map displaying warehouse origins, drop pins, and animated multi-drop route polylines.
- Exporting multi-sheet formatted Excel reports and downloadable 16:9 executive PowerPoint presentations (`.pptx`).

### Out-of-Scope (for current phase):
- Real-time GPS telematics tracking of en-route vehicles.
- Direct live ERP API push (e.g. SAP / Oracle live write-back).
- Automated carrier rate contracting or automated spot auction bidding.

---

## 4. Functional Specifications

### Phase 1: Distance Matrix Engine
1. **Spreadsheet Ingestion**:
   - Detects column headers dynamically (`Latitude`, `Longitude`, `Destination`, `Invoice No`, `Quantity`, etc.).
   - Normalizes coordinate representations and cleans whitespace.
2. **Matrix Construction**:
   - Compiles list of unique $(Lat, Lon)$ destination pairs.
   - Executes batched queries against OSRM Table API (`/table/v1/driving/...`) setting `sources=0..N-1`.
   - Populates a symmetric or directed $N \times N$ road distance matrix (km) and duration matrix (minutes).
3. **Resilient Fallback Pipeline**:
   - Primary: Internal OSRM instance (`http://localhost:5001`).
   - Secondary: Public OpenStreetMap routing server with rate-limiting backoff.
   - Tertiary: Geodesic Haversine calculation scaled by 1.3x road circuity factor.
4. **Custom Matrix Import & Editing**:
   - Supports uploading pre-computed distance matrices in Pairwise List format or $N \times N$ Grid format.
   - Inline cell editing allows logistics supervisors to manually override specific road segments (e.g. temporary bridge closures or ferry crossings).

### Phase 2: Payload & Route Optimizer
1. **Fleet Capacity Configuration**:
   - Allows users to define available vehicle fleet types, rated payload capacity (MT), usable volume (CFT), and count.
   - Enforces strict upper bound checks (no vehicle will be loaded over 100% capacity).
2. **Multi-Drop Clustering & Bin-Packing**:
   - Applies First-Fit Decreasing (FFD) heuristic to group destination orders into single-drop or multi-drop batches.
   - Enforces `maxMultiDropRadiusKm` (&le; 35 km) between all drop destinations in a single run.
   - Enforces `maxDropsPerVehicle` (&le; 3 drops) to preserve driver turnaround time.
3. **Exact Permutation Route Sequencing**:
   - For all multi-drop batches, evaluates every permutation of drop sequences from the depot origin ($Depot \to Drop_{\pi_1} \to Drop_{\pi_2} \dots \to Drop_{\pi_K}$).
   - Selects the sequence with the lowest cumulative inter-drop road distance.
4. **SLA Window & Rollover Verification**:
   - Computes delivery cut-off based on order creation time and business shift hours (10:00 to 17:00).
   - Orders placed after cut-off or taking longer than remaining shift duration roll over to the next business morning.
   - Evaluates historical E-Way Bill date & time to measure delay duration in hours and minutes.

### Phase 3: Analytics, Auditing & Reporting
1. **Historical Actuals vs. Engine Optimization Benchmark**:
   - Side-by-side performance scorecard comparing:
     - Total vehicle count needed.
     - Number of clubbed multi-drop orders.
     - SLA breach count and breach percentage.
     - Delay metrics: Maximum delay, Average delay, Median delay.
     - Distance-weighted average inter-drop distance with vehicle count, order count, and fleet capacity breakdown (25MT, 30MT, 35MT).
     - Radius threshold violations count.
     - Overweight vehicle dispatches count.
2. **Interactive Delay Filter Bar**:
   - Filter dispatches by SLA compliance: All, Met (On-Time), Breached, Delay &ge; 2h, 4h, 8h, 24h, or custom user-specified &ge; X hours.
3. **Executive Export Modules**:
   - Multi-sheet Excel workbook (`.xlsx`) containing dispatch plans, vehicle manifests, and audit comparisons.
   - Automated 16:9 executive presentation (`.pptx`) generated in-browser via `pptxgenjs`.

---

## 5. Non-Functional Requirements

- **Performance & Scalability**: Computes distance matrix and optimization for 500+ orders in under 3 seconds using client-side algorithms.
- **Zero Data Leakage**: All spreadsheet data, dealer identities, and invoice records remain strictly inside the client browser session unless user explicitly queries an internal OSRM endpoint.
- **Responsiveness**: Fully responsive desktop and tablet interface with responsive flex layouts and touch-friendly controls.
- **Reliability & Fault Tolerance**: Multi-tier routing fallback ensures zero crashes even if the external routing service is unavailable.
