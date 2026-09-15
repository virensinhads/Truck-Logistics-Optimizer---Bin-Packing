# Role & Operational Mode
You are a senior full-stack engineer and operations research specialist refactoring an existing, working codebase ("Anti-Gravity").

### Strict Rules of Engagement:
1. **Existing Base:** The core application, UI layout, routing, optimization solver, and state stores are already built and functioning.
2. **Non-Breaking Delta Only:** Do NOT rewrite unrelated modules, re-architect state management, or remove existing data fields. Only provide the net-new interfaces, modified utility functions, and incremental UI additions needed to satisfy the requirements below.
3. **Targeted Delivery:** Group your output by targeted file path (e.g., `types.ts`, `dataParser.ts`, `metricsCalculator.ts`, `SummaryDashboard.tsx`, `ManifestTab.tsx`) using clean `// BEFORE` vs `// AFTER` blocks or isolated additive functions.

---

## Task Scope: New Feature Integrations

### 1. Ingestion Layer & Sample Download (Tab 2: Sales Register)
* **New Columns to Ingest:**
  * `Club ID` (string | number): If numeric or non-zero, group rows into a single vehicle dispatch batch. If `"NA"`, `"None"`, `0`, or empty, treat as an unclubbed individual dispatch.
  * `Truck No.` (string): Dispatched vehicle license / identifier.
  * `Transp Name` (string): Transporter entity name.
  * `Truck Type` (string): Case-insensitive vehicle tier mapping:
    - `"12 wheeler"` -> `25` MT rated capacity
    - `"14 wheeler"` -> `30` MT rated capacity
    - `"16 wheeler"` -> `35` MT rated capacity
* **Template Export Update:**
  * Locate the existing sample file export function in Tab 2.
  * Append these four headers to the exported CSV/XLSX template, prepopulated with 3–4 dummy rows illustrating both clubbed (matching `Club ID` and `Truck No.`) and unclubbed dispatches.

---

### 2. Historical Aggregation & KPI Computation Module
Create or extend an analytical utility function (e.g., `calculateHistoricalMetrics(salesRegisterRows, configuredRadiusThreshold)`) to return:

1. **Fleet Count Breakdown:**
   * Total unique `Truck No.` count.
   * Total counts partitioned by tonnage bucket: 25 MT, 30 MT, and 35 MT.
2. **Overweight Dispatch Counter:**
   * Group rows by `Truck No.` (or unique `Club ID`).
   * Calculate $\sum \text{Order Weight}$ for each dispatch.
   * Flag as overweight when $\sum \text{Order Weight} > \text{Rated Capacity}$. Return the total count of overloaded dispatches and total excess MT.
3. **Historical Capacity Utilization:**
   * Compute per-dispatch utilization: $(\sum \text{Order Weight} / \text{Rated Capacity}) \times 100$.
   * Return average historical capacity utilization across all dispatches (include a division-by-zero check).
4. **Distance-Weighted Average Inter-Drop Distance:**
   * For multi-drop clubbed orders, obtain drop-to-drop transit distance $d_i$ and assigned vehicle capacity $w_i \in \{25, 30, 35\}$.
   * Calculate:
     $$\text{Weighted Distance} = \frac{\sum (w_i \cdot d_i)}{\sum w_i}$$
   * Return `0` or `null` if no multi-drop clubbed dispatches exist.
5. **Radius Threshold Breaches:**
   * Compare inter-drop distance $d_i$ to the user-configured clubbing radius threshold ($R_{\text{max}}$).
   * Count total instances where $d_i > R_{\text{max}}$.
6. **Clubbed Order Totals:**
   * Total count of orders flagged as clubbed in the historical dataset vs. the engine-recommended clubbed count.

---

### 3. UI Dashboard Updates (Vehicle Fleet Allocation & Summary View)
* In the existing Fleet Allocation / Summary dashboard component:
  * Mount a comparative visual section or KPI table placing **Historical Actuals** adjacent to **Optimization Engine Outputs**.
  * Display: Total Vehicles, 25 MT / 30 MT / 35 MT split, Total Clubbed Orders, Overweight Dispatches (with badge warning if > 0), Average Capacity Utilization %, Distance-Weighted Drop Distance, and Threshold Breaches.

---

### 4. Manifest Tab: Reactive Filter Metric
* In the existing Manifest table view component:
  * Add a derived counter above the table that reacts to table filtering state:
    `Showing {filteredRowCount} of {totalRowCount} rows ({totalRowCount - filteredRowCount} rows filtered out)`
  * Ensure this recalculates immediately whenever column filters or search queries are applied or cleared.

---

## Output Format Requested:
1. **Types / Interfaces:** New interfaces or field additions for the sales record and metric result models.
2. **Data Parsing & Template:** Specific code changes for ingestion and the download handler.
3. **Calculation Logic:** Standalone pure function for historical KPIs.
4. **UI Components:** Incremental JSX/TSX changes for the Dashboard and Manifest Tab.