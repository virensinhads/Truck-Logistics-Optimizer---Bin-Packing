# AI Agent Instructions & Conventions

This document defines the development standards, architecture rules, tech stack conventions, and domain guidelines for any AI coding agent modifying this repository.

---

## 1. Project Overview & Tech Stack

The **Logistics Payload & Route Optimization Engine** is a client-side Single Page Application (SPA) built with:
- **Framework**: React 19 + TypeScript (Strict Mode)
- **Bundler & Dev Server**: Vite 6 (`--port=3000 --host=0.0.0.0`)
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite` plugin (configured in `src/index.css` with `@import "tailwindcss";`)
- **Icons**: `lucide-react` (Strict requirement: do NOT write custom SVG icons)
- **Animation**: `motion` (imported from `motion/react`)
- **Spreadsheet Parsing & Export**: `xlsx` (SheetJS)
- **Executive Presentation Export**: `pptxgenjs` (16:9 widescreen PowerPoint deck generation)
- **Mapping & Geovisualization**: `leaflet` & `@types/leaflet`
- **Routing & Matrix APIs**: Open Source Routing Machine (OSRM) Table API with OpenStreetMap and Haversine (1.3x circuity) fallbacks

---

## 2. Directory Structure & Key Files

```
├── .antigravity/                   # AI Agent rule context
│   ├── rules.json
│   └── context.md
├── AGENT_INSTRUCTIONS.md           # Global rules, tech stack, and conventions for AI agents
├── README.md                       # Project landing page, quickstart & feature overview
├── EXTERNAL_DEPENDENCIES.md        # Comprehensive external libraries & services documentation
├── docs/
│   ├── PRD.md                      # Product Requirements Document
│   ├── 01_IDEATION.md              # Product Requirements, User Journeys & Scope
│   ├── 02_DATABASE.md              # Data Schema, ERD, Models & Migrations (Empty - Client-Side App)
│   ├── 03_BACKEND.md               # API Architecture, Endpoints, Auth & Business Logic (Empty - Client-Side App)
│   ├── 04_FRONTEND.md              # UI/UX Specs, Routes, Component Tree & State
│   └── 05_DEPLOYMENT.md            # CI/CD, Environment Variables & Hosting
├── scripts/
│   └── generate_osrm_matrix.ts     # Standalone CLI script for computing distance matrices
├── src/
│   ├── App.tsx                     # Main application container & tab switching
│   ├── main.tsx                    # React DOM root entry point
│   ├── index.css                   # Tailwind CSS v4 entry point (@import "tailwindcss";)
│   ├── types.ts                    # Global TypeScript interfaces, types, and enums
│   ├── components/
│   │   ├── Navbar.tsx              # Header navbar with presentation download & status
│   │   ├── TabDistanceMatrix.tsx   # Phase 1: Distance matrix evaluation, editing & export
│   │   ├── TabOptimization.tsx     # Phase 2: Payload optimization, fleet sizing & comparative audit
│   │   └── RouteMapModal.tsx       # Leaflet modal displaying interactive multi-drop route sequences
│   └── utils/
│       ├── distanceMatrixEngine.ts # OSRM Table API caller with fallback chain
│       ├── excelHandler.ts         # Sales register & distance matrix spreadsheet parsing & export
│       ├── haversine.ts            # Great-circle distance calculations & circuity scaling
│       ├── historicalMetricsCalculator.ts # Actual vs. Engine comparative performance metrics
│       ├── optimizationEngine.ts   # Bin-packing FFD algorithm & exact permutation route sequencing
│       ├── presentationGenerator.ts# Formatted PowerPoint deck generator (.pptx)
│       ├── sampleData.ts           # Pre-loaded sample orders and locations
│       └── slaCalculator.ts        # Order SLA window, cut-off evaluation, and delay calculation
└── package.json                    # Project configuration & npm scripts
```

---

## 3. Core Coding Rules for AI Agents

### A. TypeScript Standards
- **Strict Typing**: All variables, props, and functions must have explicit types or cleanly inferred types.
- **Top-Level Named Imports**: Always import named exports (e.g. `import { useState, useMemo } from 'react';`). Do NOT use destructuring on namespace imports.
- **No `const enum`**: Standard `enum` declarations only if needed; prefer string union types where applicable.
- **Do Not Break Builds**: Run `npm run lint` (`tsc --noEmit`) and `npm run build` after editing to ensure zero build errors.

### B. Styling & Design Standards
- **Tailwind CSS Utility Classes**: Use Tailwind utility classes directly in `className`.
- **No Custom CSS Files**: Do NOT create separate `.css` files (e.g. `App.css`). All styling resides in `src/index.css` via utility classes.
- **Design Aesthetic**:
  - Crisp, professional enterprise dashboard theme.
  - High-contrast typography (#0F172A slate text, #64748B muted labels).
  - Clear visual borders (`border border-[#E2E8F0]`) and subtle card backgrounds (`bg-white`, `bg-[#F8FAFC]`).
  - No purple-to-blue gradients, glowing neon drop shadows, or unstyled UI cards.
  - All interactive elements must have clear hover and active feedback.
  - Every significant interactive element, card, or button must have an `id` attribute.

### C. Domain Logic & Invariant Guidelines
1. **Capacity Enforcement**:
   - Total payload weight of an allocated truck must never exceed `vehicle.capacityMT`.
   - Total volume of an allocated truck must never exceed `vehicle.usableVolumeCFT`.
2. **Multi-Drop Clustering**:
   - A vehicle dispatch can only group multiple destination drop points if the inter-drop distance between all destination pairs is &le; `maxMultiDropRadiusKm` (default: 35 km).
   - Maximum drop count per vehicle is constrained to `maxDropsPerVehicle` (default: 3 drops).
3. **Route Sequence Optimization**:
   - Multi-drop route sequences are evaluated using exact permutation search across all permutations of drop locations to minimize cumulative travel distance from the warehouse origin.
4. **SLA Breach & Dispatch Delay Evaluation**:
   - Order SLA expiry is calculated using business shift timings (e.g. 10:00 to 17:00, standard 2-hour window).
   - E-Way Bill date & time represents actual dispatch time.
   - Any dispatch where `eWayBillTimestamp > expiryTimestamp` is flagged as an SLA breach, and the exact delay in hours is computed for statistical reporting (Max, Avg, Median).

---

## 4. Verification Workflow

Before concluding any development turn:
1. Check TypeScript compilation: `npm run lint`
2. Test full production build: `npm run build`
3. Ensure no runtime exceptions or console syntax errors exist.
