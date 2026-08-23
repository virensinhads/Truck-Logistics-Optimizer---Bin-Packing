# Logistics Payload & Route Optimization Engine

A comprehensive logistics payload optimization, distance matrix evaluation, and multi-drop route planning application designed for supply chain operators, logistics planners, and fleet managers.

---

## 📋 Table of Contents
1. [Overview](#overview)
2. [Key Capabilities](#key-capabilities)
3. [Architecture & Workflow](#architecture--workflow)
4. [Distance Matrix Engine (Script 1)](#distance-matrix-engine-script-1)
5. [Payload & Route Optimizer (Script 2)](#payload--route-optimizer-script-2)
6. [Prerequisites & Installation](#prerequisites--installation)
7. [Running the Web Application](#running-the-web-application)
8. [Using the Standalone CLI Scripts](#using-the-standalone-cli-scripts)
9. [File Formats & Schema Guidelines](#file-formats--schema-guidelines)
10. [SLA & Cluster Tracking](#sla--cluster-tracking)

---

## 🌟 Overview

The **Logistics Payload & Route Optimization Engine** addresses the challenge of transforming raw daily sales register spreadsheets into cost-optimized, SLA-compliant vehicle dispatch plans. It executes a two-phase workflow:

1. **Phase 1: Distance Matrix Engine (Script 1)**: Evaluates the pairwise road distances ($N \times N$) between all unique customer/destination coordinates using an OSRM routing server with resilient multi-tier fallbacks.
2. **Phase 2: Vehicle Bin-Packing & Route Optimizer (Script 2)**: Groups destination orders into geographical clusters, bin-packs orders into standard vehicle categories (e.g., 32ft MXL, 24ft, 20ft, 14ft, 7ft/Pickup), sequences multi-drop delivery routes, and verifies customer Delivery SLAs.

---

## 🚀 Key Capabilities

- **Automated Distance Matrix Evaluation**:
  - Automatically extracts all unique latitude and longitude coordinates from uploaded sales registers.
  - Queries the OSRM Table endpoint iterating across all $N$ destinations (`sources=0..N-1`) to construct high-accuracy road distances and estimated driving durations.
  - Fallback support: Public OpenStreetMap routing and 1.3x road circuity Haversine calculation.
- **Custom Distance Matrix Upload & Manual Overrides**:
  - Upload custom pre-calculated distance matrices in either **Pairwise Distances List** format or **$N \times N$ Grid** format.
  - Interactive grid viewer with inline cell editing to adjust specific road distances on the fly.
- **Multi-Drop Payload Optimization & Bin-Packing**:
  - First-Fit Decreasing (FFD) and Best-Fit multi-drop vehicle clustering constrained by volumetric weight (MT) and cubic capacity (CFT).
  - Dynamic vehicle fleet selection (32ft Multi-Axle, 32ft SXL, 24ft, 20ft, 17ft, 14ft, Bolero/Pickups) with target payload utilization thresholds (>85%).
- **Route Sequencing & Traveling Salesperson Problem (TSP)**:
  - Nearest-Neighbor and 2-Opt heuristic route sequencing starting from warehouse/depot coordinates.
  - Generates drop sequences, per-leg distances, and cumulative route mileage.
- **Delivery SLA Verification**:
  - Calculates Expected Time of Arrival (ETA) based on distance, driving speeds, mandatory rest stops, unloading time per drop (e.g., 45–60 mins), and delivery time windows.
  - Flags potential SLA breaches, delayed shipments, and bottleneck destinations.
- **Interactive Route Map Visualizer**:
  - Interactive Leaflet map displaying warehouse origin, customer delivery waypoints, and animated polyline routes per vehicle cluster.
- **Multi-Sheet Excel & JSON Export**:
  - Export complete dispatch summaries, detailed load manifests, vehicle cluster breakdowns, and SLA tracking reports.

---

## 🏗 Architecture & Workflow

```
┌────────────────────────────────────────────────────────┐
│                   Sales Register Excel                 │
│      (Invoice, Dest, Lat, Lon, Weight MT, Volume CFT)   │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│             Phase 1: Distance Matrix Engine            │
│   - Extract unique destination coordinates             │
│   - Rotate sources=0..N-1 against OSRM Table API       │
│   - Generate full N x N Road Distance & Duration Matrix│
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│            Phase 2: Payload & Route Optimizer          │
│   - Density & Proximity Clustering (K-Means / Radius)  │
│   - Fleet Bin-Packing (Weight & Volume Capacity)       │
│   - Route Sequencing (Nearest-Neighbor / 2-Opt TSP)    │
│   - SLA Tracking & Trip Duration Calculations          │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Outputs & Exports                    │
│   - Interactive Map with Route Polylines               │
│   - Full Dispatch Plan (Vehicles, Drops, Load % )      │
│   - Detailed Multi-Sheet Excel & JSON Reports          │
└────────────────────────────────────────────────────────┘
```

---

## 📍 Distance Matrix Engine (Script 1)

The Distance Matrix Engine computes pairwise travel distance and duration between all distinct destination coordinates in the dataset.

### OSRM Table Request Methodology
For a dataset containing $N$ unique locations, the engine queries the OSRM Table API endpoint $N$ times, setting the source index `sources=i` from `0` to `N-1`:

$$\text{URL Pattern: } \texttt{http://<OSRM\_HOST>:<PORT>/table/v1/driving/lon}_1,\text{lat}_1;\text{lon}_2,\text{lat}_2;\dots;\text{lon}_N,\text{lat}_N\texttt{?annotations=distance,duration\&sources=}i$$

**Sample Query**:
```
http://192.168.157.174:5001/table/v1/driving/92.2072,23.946;92.74221,24.689?annotations=distance,duration&sources=0
```

### Multi-Tier Fallback Structure:
1. **Tier 1 (Primary)**: Default internal OSRM routing server (`http://192.168.157.174:5001`).
2. **Tier 2 (Fallback)**: Public OpenStreetMap routing service (`https://routing.openstreetmap.de/routed-car`).
3. **Tier 3 (Fallback)**: Geodesic Haversine formula with a 1.3x road circuity factor to ensure uninterrupted calculations under all network conditions.

---

## 🚛 Payload & Route Optimizer (Script 2)

The optimization engine performs bin-packing and vehicle routing:

- **Weight Capacity Limit**: Ensures total payload in Metric Tonnes (MT) does not exceed vehicle rated gross payload.
- **Volume Capacity Limit**: Ensures total shipment volume in Cubic Feet (CFT) does not exceed vehicle usable volume.
- **Multi-Drop Clustered Routing**: Limits drops per vehicle to configured thresholds (e.g., maximum 3–5 drops per run) while minimizing total circuit distance.
- **Route Optimization**: Solves route traversal starting from origin depot $\to$ Drop 1 $\to$ Drop 2 $\to \dots \to$ Drop $K$.

---

## ⚙ Prerequisites & Installation

### Requirements
- **Node.js**: Version 18.0.0 or higher
- **npm** or **bun** / **yarn**

### Installation
Clone the repository and install project dependencies:

```bash
# Clone the repository
git clone <repository-url>
cd payload-and-route-optimizer

# Install dependencies
npm install
```

---

## 🖥 Running the Web Application

To run the full interactive web application with live preview:

```bash
# Start Vite development server
npm run dev
```

Open your browser and navigate to:
```
http://localhost:3000
```

### Web App Tabs Overview:
- **Tab 1: Distance Matrix Engine (Script 1)**:
  - Upload sales register spreadsheet.
  - Click **"Evaluate distance for uploaded file"** to compute road distances.
  - Download sample matrix template or upload pre-calculated distance matrices.
  - Inspect, filter, and manually override distance values directly in the matrix grid.
- **Tab 2: Payload & Route Optimization (Script 2)**:
  - Configure fleet capacity limits and depot location.
  - Run multi-drop optimization.
  - View interactive vehicle route maps and load utilization KPIs.
  - Export final dispatch plans to formatted Excel files (`.xlsx`).

---

## 💻 Using the Standalone CLI Scripts

You can also run the distance matrix generator directly from the terminal against any sales register Excel file without opening the browser.

### Script Command Syntax

```bash
npx tsx scripts/generate_osrm_matrix.ts <sales_register.xlsx> [output_matrix.xlsx] [osrm_base_url]
```

### Arguments:
| Argument | Description | Default Value |
|---|---|---|
| `<sales_register.xlsx>` | Path to your input sales register Excel file | *(Required)* |
| `[output_matrix.xlsx]` | Output destination path for the generated Excel matrix | `./distanceMatrix.xlsx` |
| `[osrm_base_url]` | OSRM routing server base URL | `http://192.168.157.174:5001` |

### Example Usages:

```bash
# 1. Run with default OSRM server:
npx tsx scripts/generate_osrm_matrix.ts ./sample_orders.xlsx

# 2. Run specifying custom output file and local OSRM server:
npx tsx scripts/generate_osrm_matrix.ts ./daily_orders.xlsx ./outputs/august_matrix.xlsx http://localhost:5001

# 3. Run against custom network IP:
npx tsx scripts/generate_osrm_matrix.ts ./sales_register.xlsx ./distanceMatrix.xlsx http://192.168.157.174:5001
```

---

## 📊 File Formats & Schema Guidelines

### 1. Sales Register Input Format (`.xlsx`, `.xls`, `.csv`)
The engine dynamically detects columns from your spreadsheet. Ensure your file contains headers similar to:

| Column Name | Type | Description | Example |
|---|---|---|---|
| `Invoice No` / `Order ID` | String | Unique delivery/order identifier | `INV-2026-0089` |
| `Customer` / `Party Name` | String | Destination business name | `Alpha Logistics Hub` |
| `Destination` / `City` | String | Delivery location name | `Guwahati Hub` |
| `Latitude` / `Lat` | Number | Destination latitude | `26.1445` |
| `Longitude` / `Lon` / `Long` | Number | Destination longitude | `91.7362` |
| `Weight (MT)` / `Weight (Kg)` | Number | Shipment weight in MT or KG | `4.2` |
| `Volume (CFT)` / `CFT` | Number | Shipment cubic volume in CFT | `480` |
| `SLA (Days)` / `SLA Target` | Number | Delivery SLA target in days | `2` |

### 2. Distance Matrix File Format (`.xlsx`)
If uploading a pre-calculated distance matrix, the application supports two formats:

#### Format A: Pairwise Distances List (Recommended)
| From Location | From Lat | From Lon | To Location | To Lat | To Lon | Distance (km) | Est. Duration (min) |
|---|---|---|---|---|---|---|---|
| Guwahati Hub | 26.1445 | 91.7362 | Silchar Depot | 24.8333 | 92.7789 | 312.40 | 480.0 |
| Guwahati Hub | 26.1445 | 91.7362 | Shillong DC | 25.5788 | 91.8933 | 98.20 | 165.0 |

#### Format B: $N \times N$ Matrix Grid
A square table where row headers represent origins and column headers represent destination coordinates/names.

---

## ⏱ SLA & Cluster Tracking

- **Transit Time Model**: Estimated based on real road geometry, terrain speed profiles (35–55 km/h depending on distance), and mandatory driver break times.
- **Handling Overhead**: Configurable unloading buffers per multi-drop stop (default: 45 minutes per intermediate drop).
- **SLA Breach Detection**: Highlights orders where computed transit time + unloading exceeds agreed client service level agreements.

---

## 🛡 License & Support

Built for internal logistics and supply chain optimization workflows. For questions or enhancements, contact the supply chain engineering team.
