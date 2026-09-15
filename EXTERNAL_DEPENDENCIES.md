# External Dependencies & Services

This document details all external libraries, SDKs, development tools, and external APIs used across the **Logistics Payload & Route Optimization Engine**.

---

## 1. Runtime Dependencies (`dependencies`)

| Package | Version | Purpose | Usage in Project |
|---|---|---|---|
| **react** | `^19.0.1` | Core UI library | Powers declarative component tree and reactive state hooks (`useState`, `useMemo`, `useEffect`, `useCallback`). |
| **react-dom** | `^19.0.1` | React DOM renderer | Renders React application to the browser DOM (`src/main.tsx`). |
| **xlsx** | `^0.18.5` | Excel / Spreadsheet parser & generator | Reads uploaded sales registers (`.xlsx`, `.xls`, `.csv`), parses distance matrices, and exports multi-sheet dispatch manifests. |
| **pptxgenjs** | `^4.0.1` | PowerPoint presentation generation | Generates executive 16:9 PowerPoint pitch decks (`.pptx`) with visual slides explaining optimization methodology, fleet sizing, and audit comparisons. |
| **leaflet** | `^1.9.4` | Geovisualization & mapping library | Interactive map engine in `RouteMapModal.tsx` rendering origin depots, drop points, waypoint markers, and routed multi-drop polylines. |
| **lucide-react** | `^0.546.0` | SVG icon library | Provides standardized iconography across all dashboard components (navigation, badges, status indicators, metrics). |
| **motion** | `^12.23.24` | Animation engine | Smooth UI transitions, accordions, animated modals, and progress bars (`motion/react`). |
| **@tailwindcss/vite** | `^4.1.14` | Vite plugin for Tailwind CSS v4 | High-performance atomic CSS processing engine directly integrated into Vite pipeline. |
| **dotenv** | `^17.2.3` | Environment variable loader | Supports local configuration loading from `.env` files. |
| **express** | `^4.21.2` | Optional HTTP server framework | Embedded in repository to allow optional backend server wrapping or API hosting if required. |
| **@google/genai** | `^2.4.0` | Official Google GenAI SDK | Available for server-side Gemini AI model integrations and reasoning workflows. |

---

## 2. Developer & Build Dependencies (`devDependencies`)

| Package | Version | Purpose |
|---|---|---|
| **typescript** | `~5.8.2` | Static type checking and compiler. |
| **vite** | `^6.2.3` | Fast next-generation frontend tooling and bundler. |
| **@vitejs/plugin-react** | `^5.0.4` | Vite plugin enabling React fast refresh and JSX compilation. |
| **tsx** | `^4.21.0` | TypeScript execute engine for running standalone CLI scripts (e.g. `scripts/generate_osrm_matrix.ts`). |
| **esbuild** | `^0.25.0` | Fast bundler used for bundling CLI utilities or optional server bundles. |
| **tailwindcss** | `^4.1.14` | Tailwind CSS v4 core engine. |
| **autoprefixer** | `^10.4.21` | PostCSS vendor prefix parser. |
| **@types/node** | `^22.14.0` | TypeScript definitions for Node.js runtime. |
| **@types/leaflet** | `^1.9.22` | TypeScript definitions for Leaflet GIS mapping objects. |
| **@types/express** | `^4.17.21` | TypeScript definitions for Express. |

---

## 3. External Services & APIs

### A. Open Source Routing Machine (OSRM) Table API
- **Endpoint**: `http://<OSRM_HOST>:<PORT>/table/v1/driving/{coordinates}?annotations=distance,duration&sources={i}`
- **Default Base URL**: `http://localhost:5001` (configurable in settings and script arguments)
- **Role**: Primary routing engine used to compute high-accuracy road distances (in meters/kilometers) and estimated travel durations (in seconds/minutes) for $N \times N$ destination coordinates.
- **Failover Strategy**: If the local OSRM host is unreachable or times out, the system automatically cascades to Tier 2 (Public OpenStreetMap) and Tier 3 (Haversine circuity).

### B. Public OpenStreetMap Routing Service
- **Endpoint**: `https://routing.openstreetmap.de/routed-car/table/v1/driving/{coordinates}?annotations=distance,duration&sources={i}`
- **Role**: Secondary failover routing server used when local OSRM instance is not running or unreachable.
- **Throttling Policy**: The client engine staggers batched requests to remain compliant with public usage terms.

### C. OpenStreetMap Carto Tile Service
- **Endpoint**: `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`
- **Role**: Base raster map tile provider for the Leaflet route map modal.
- **Attribution**: `&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors`.

### D. Geodesic Haversine Engine (Tier 3 Offline Fallback)
- **Role**: Pure mathematical fallback embedded directly in `src/utils/haversine.ts`.
- **Method**: Calculates great-circle sphere distance using latitude/longitude and applies a 1.3x road circuity factor:
  $$\text{Road Distance} \approx 1.3 \times 2 R \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right)}\right)$$
- **Guarantee**: Guarantees that distance evaluation and payload optimization will never crash or fail due to network outages or API rate limits.
