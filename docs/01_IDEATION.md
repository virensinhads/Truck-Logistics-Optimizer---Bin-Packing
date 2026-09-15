# 01 - Ideation, User Journeys & Product Scope

## 1. Project Genesis & Core Vision

The **Logistics Payload & Route Optimization Engine** was conceived to solve the systemic inefficiency in industrial dispatch operations. Manufacturing and distribution hubs regularly generate daily sales register files detailing customer orders, invoiced weights, and destinations.

Traditionally, dispatch clerks manually pair orders to trucks using paper notes or rudimentary spreadsheet filtering. This results in:
- High freight cost per MT due to under-loaded trucks (carrying 18 MT on a 25 MT vehicle).
- Sub-optimal multi-drop sequencing, causing drivers to backtrack and add tens of kilometers to delivery circuits.
- Pervasive SLA breaches where high-priority orders sit in holding docks due to lack of visibility into dispatch cut-off windows.

**Vision**: Create an intelligent, instant client-side optimization suite that ingests daily registers, builds exact road-distance matrices, packs vehicles to near-100% capacity, guarantees strict radius thresholds, sequences drops with mathematical optimality, and produces board-ready audit reports.

---

## 2. Core User Journeys

### User Journey 1: The Daily Dispatch Planning Run
**Actor:** Plant Logistics Executive  
**Goal:** Convert morning order register into an actionable vehicle dispatch manifest in under 5 minutes.

1. **Ingestion**: Planner opens the app and navigates to **Tab 1: Distance Matrix Engine**.
2. **File Upload**: Drag-and-drops the morning sales register Excel file (`sales_register_2026-09-14.xlsx`).
3. **Distance Evaluation**: Clicks **"Evaluate distance for uploaded file"**. The system identifies unique destination coordinates and queries the OSRM routing server.
4. **Validation & Overrides**: Planner reviews the matrix grid. If a known local detour exists, the planner directly edits the cell distance in the matrix.
5. **Optimization Run**: Transitions to **Tab 2: Payload & Route Optimization**, reviews fleet limits (e.g. 25 MT, 30 MT, 35 MT available), sets the depot location, and clicks **"Run Multi-Drop Payload & Route Optimization"**.
6. **Manifest Generation**: Reviews packed vehicles, verifying that all trucks meet the >85% payload threshold and no multi-drop cluster exceeds 35 km.
7. **Export**: Clicks **"Export Final Optimization Plan (Excel)"** and shares the dispatch sheet with warehouse dock supervisors.

---

### User Journey 2: Route Visualizer & Driver Briefing
**Actor:** Transport Coordinator / Driver Supervisor  
**Goal:** Brief truck drivers on their specific drop sequence and driving directions.

1. **Filter Batches**: Coordinator filters optimized batches to view multi-drop dispatches.
2. **Inspect Route**: Clicks **"View Interactive Route Map"** on a 3-drop vehicle dispatch batch.
3. **Modal Map View**: An interactive Leaflet map opens displaying:
   - Green warehouse marker at plant coordinates.
   - Numbered orange/blue destination markers (Stop 1, Stop 2, Stop 3).
   - Animated SVG polyline connecting the sequence.
4. **Sequence Verification**: Confirms that Stop 1 is unloaded first, followed by Stop 2 and Stop 3, minimizing detour distance and avoiding reverse-direction driving.

---

### User Journey 3: Executive Audit & SLA Compliance Review
**Actor:** Head of Supply Chain / Logistics VP  
**Goal:** Audit historical plant dispatch efficiency, identify chronic SLA delay bottlenecks, and present executive findings to management.

1. **Performance Benchmark**: VP scrolls to the **Comprehensive Historical vs. Engine Optimization Audit** scorecard.
2. **SLA Breach Inspection**: VP reviews the **SLA Breaches & Delays** row:
   - Identifies that 18% of historical orders suffered SLA breaches.
   - Observes the Maximum Delay (e.g., 26.5 hours), Average Delay (e.g., 4.8 hours), and Median Delay (e.g., 3.2 hours).
   - Notes that the Engine Optimization achieves **0 SLA Breaches (100% On-Time Turnaround)** through automated rollover and dispatch prioritization.
3. **Multi-Drop Fleet Analysis**: VP examines the **Distance-Weighted Inter-Drop Distance** row:
   - Compares the total multi-drop vehicle and order counts between historical actuals and engine output.
   - Inspects the fleet capacity breakup (25MT vs 30MT vs 35MT) to determine if heavier trucks are being effectively deployed for clustered drops.
4. **Filter Investigation**: Uses the SLA Delay Filter dropdown to filter dispatches with delays &ge; 4 hours to pinpoint which dealers or regions experience the worst hold-ups.
5. **Executive Slide Deck**: Clicks **"Download Executive Presentation (.pptx)"** in the top navigation bar to obtain a 16:9 widescreen PowerPoint deck ready for C-suite presentation.

---

## 3. Product Scope & Functional Boundaries

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Product Scope Matrix                            │
├───────────────────────────────────┬────────────────────────────────────┤
│           IN SCOPE                │            OUT OF SCOPE            │
├───────────────────────────────────┼────────────────────────────────────┤
│ • Sales register spreadsheet      │ • Live GPS truck telematics        │
│   ingestion (XLSX, CSV)           │ • Integration with vehicle sensors │
│ • OSRM Table API integration with │ • Direct ERP database write-back   │
│   multi-tier fallbacks            │ • Driver mobile application        │
│ • Interactive distance matrix     │ • Dynamic fuel price spot auctions │
│   editing & export                │ • Live freight rate negotiations   │
│ • Volumetric & weight bin-packing │                                    │
│ • Exact permutation route search  │                                    │
│ • SLA cut-off & delay computation │                                    │
│ • Interactive Leaflet route map   │                                    │
│ • Comparative audit scorecard     │                                    │
│ • Excel and PPTX deck export      │                                    │
└───────────────────────────────────┴────────────────────────────────────┘
```
