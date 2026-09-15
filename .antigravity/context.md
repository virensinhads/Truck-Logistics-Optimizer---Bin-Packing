# Antigravity AI Agent Context & Guidelines

## Mission
You are working on the **Logistics Payload & Route Optimization Engine**, a mission-critical supply chain web application designed to transform raw daily sales register spreadsheets into cost-optimized, SLA-compliant vehicle dispatch plans.

## Core Constraints & Principles
1. **User Intent is the Highest Priority**: Build exactly what is requested with high craftsmanship in typography, layout, spacing, and math accuracy.
2. **Deterministic Computations**:
   - Haversine distance uses spherical trigonometry with an average Earth radius of 6371 km.
   - Road distance circuity multiplier is set to 1.3x for geodesic fallbacks.
   - Vehicle capacities (25MT, 30MT, 35MT, etc.) and volume limits must never be exceeded.
   - Multi-drop clustering checks max stop limits (default: 3 drops) and max cluster radius (default: 35 km).
   - Exact permutation route search evaluates all sequence permutations to guarantee minimum route mileage.
3. **No Database / External Backend Assumptions**:
   - The application is a client-side Single Page Application (SPA).
   - Do not invent backend databases or external API servers unless explicitly requested.
4. **Icons & UI**:
   - Always import icons from `lucide-react`.
   - Never create custom SVG icon components.
   - Style exclusively using Tailwind CSS v4 utility classes.
