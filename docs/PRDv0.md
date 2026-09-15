## Product Requirement Document (PRD): Logistics Payload & Route Optimization Engine

### 1. Overview & Objective

Build an end-to-end web application and a two-phase optimization engine that processes sales register Excel files. The platform groups order line items into optimal vehicle dispatches while enforcing strict business rules: **minimizing total vehicle count**, **maximizing load utilization ($\ge 80\%$ target)**, **respecting hierarchical grouping priorities**, and **adhering to temporal SLA and spatial limits**.

---

### 2. System Architecture & Functional Flow

```
[ Excel Input File Upload ] 
       │
       ▼
[ Tab 1: Distance Matrix Engine (Script 1) ] ──► Saves ──► [ distanceMatrix File ]
  (OSM Table API ➔ Route API ➔ Haversine)                        │
                                                                 ▼
[ Tab 2: Optimization Engine (Script 2) ] ◄── Reads ─────────────┘
       │
       ├─► [ UI Summary Dashboard (Vehicle Counter) ]
       └─► [ Output Excel File Download ]

```

---

### 3. Application Interface (UI Requirements)

The application features a **two-tab navigation system** with continuous status updates and dynamic form validation:

#### Tab 1: Refresh Distance Matrix

* **Functionality:** Triggers **Script 1** to process unique coordinates ($\text{Lat}, \text{Lon}$) from the uploaded sales register, fetch road distances via OpenStreetMap (OSM) routing APIs, and persist the resulting matrix into a structured file named `distanceMatrix`.

#### Tab 2: Payload & Route Optimization

* **File Upload Component:** Allows users to upload the raw Input Sales Register Excel file.
* **Progress & Messaging Overlay:** Real-time feedback messages during processing (e.g., *"File read successfully"*, *"20% of data processed"*, *"50% of data processed"*, *"Finalizing Vehicle Allocations"*).
* **Execution Button:** Triggers **Script 2**. Clickable **ONLY** when all UI validation criteria pass.

#### UI Form Controls & Validation Rules

| Field Name | Control Type | Input / Validation Criteria | Warning Message (if invalid) |
| --- | --- | --- | --- |
| **Fleet Availability** | Checkboxes / Toggles | At least one vehicle size ($25\text{ MT}$, $30\text{ MT}$, or $35\text{ MT}$) must be selected | *"Select at least one vehicle type."* |
| **SLA Delivery Window** | Numeric Input (Hours) | Integer/Decimal between **1 and 4 Hours** | *"SLA window must be between 1 and 4 hours."* |
| **Max Multi-Drop Radius** | Numeric / Slider (km) | Value between **5 km and 100 km** | *"Multi-drop radius must be between 5 km and 100 km."* |
| **Operating Shift Start** | Timepicker | Valid time string | *"Provide a valid shift start time."* |
| **Operating Shift End** | Timepicker | Valid time string; **Must be strictly greater than Shift Start** | *"Shift end time must be after shift start time."* |

---

### 4. Distance Matrix API Fallback Strategy (Script 1)

To guarantee matrix generation without system crashes, Script 1 uses a **3-tier distance calculation strategy**:

1. **Primary Call (OSM Table API):** Issue a single batch call requesting distance and duration annotations:
`[https://routing.openstreetmap.de/routed-car/table/v1/driving/](https://routing.openstreetmap.de/routed-car/table/v1/driving/){lon1},{lat1};{lon2},{lat2};...??annotations=distance,duration`
2. **Secondary Call (OSM Route API Retry):** If specific coordinate pairs fail or time out in the Table API, iterate through $N \times N$ pairs using individual route calls:
`[https://routing.openstreetmap.de/routed-car/route/v1/driving/](https://routing.openstreetmap.de/routed-car/route/v1/driving/){lon1},{lat1};{lon2},{lat2}`
3. **Tertiary Fallback (Haversine Distance):** If both OSM calls fail or hit API rate limits, compute straight-line aerial distance using the Haversine formula multiplied by a $1.3\times$ road circuity factor factor:

$$d = 1.3 \times 2R \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right)}\right)$$



---

### 5. Grouping, SLA & Dispatch Logic

#### SLA Delivery Window & Temporal Constraint

* **Order Expiry Window:** Every order has a strict dispatch SLA calculated based on its creation date (`SO/PO Date`) and time (`SO/STO creation time`). Orders batched together in a single vehicle dispatch **MUST all share overlapping SLA windows** and be dispatched before the earliest order's SLA expires.
* **Shift Window Tracking:** SLA time accumulates strictly during operational hours ($\text{Start} \rightarrow \text{End}$).
* **EOD Roll-Over Handling:** Orders arriving **after Shift End** hold their SLA timer until **Shift Start the next operational day** (e.g., An order received at $6:00\text{ PM}$ on `01/10/2026` under a $10:00\text{ AM}$--$5:00\text{ PM}$ shift with a $2\text{ hr}$ SLA starts counting at $10:00\text{ AM}$ on `02/10/2026`, expiring at $12:00\text{ PM}$ on `02/10/2026`).

#### Primary Grouping Hierarchy Rules

When grouping orders into a single shipment within the same SLA window, the engine evaluates candidates based on the following strict priority sequence:

1. **Priority I:** Same Dealer (`Sold to Party`), Same Location (`Dest.`)
2. **Priority II:** Same Dealer (`Sold to Party`), Different Location (`Dest.`)
3. **Priority III:** Different Dealer (`Sold to Party`)

#### Multi-Drop Proximity & First Drop Rule

* **First Drop Determination:** The first drop ($\text{Stop}_1$) is designated as the destination of the highest-weight order line item in the vehicle batch (ties broken by earliest SLA expiry).
* **Route Deviation Limit:** For orders grouped under Priority II or III, cumulative road distance between stops after the first drop must satisfy:

$$\sum_{i=1}^{m-1} \text{RoadDistance}(\text{Stop}_i, \text{Stop}_{i+1}) \le D_{\text{Max}} \quad (D_{\text{Max}} \text{ configured between } 5\text{--}100\text{ km})$$



#### Bin-Packing Objectives & Vehicle Capacity Rules

* **Vehicle Minimization Priority:** Always select a single larger vehicle over multiple smaller vehicles if the load fits (e.g., a $28\text{ MT}$ load takes **one 30 MT vehicle**, NOT two $25\text{ MT}$ vehicles; a $34\text{ MT}$ load takes **one 35 MT vehicle**, NOT two $25\text{ MT}$ vehicles).
* **Minimum Utilization Threshold:** All allocated vehicles must achieve **at least $>80\%$ weight capacity utilization**:
* **25 MT Vehicle:** Minimum load $> 20\text{ MT}$
* **30 MT Vehicle:** Minimum load $> 24\text{ MT}$
* **35 MT Vehicle:** Minimum load $> 28\text{ MT}$ (enforcing the core $>30\text{ MT}$ rule)



#### Large Weight Grouping & Split Rules ($>35\text{ MT}$)

When grouped candidates exceed the single max vehicle capacity ($35\text{ MT}$):

* **Single High-Tonnage Order Case (e.g., $35\text{ MT} + 15\text{ MT} = 50\text{ MT}$):** Allocate the $35\text{ MT}$ order into a single $35\text{ MT}$ vehicle (`35MT_<Counter>`). The remaining $15\text{ MT}$ order falls below the $20\text{ MT}$ ($80\%$) threshold and is routed to the depot backlog (`NA`).
* **Multi-Order Split Case (e.g., $20\text{ MT} + 20\text{ MT} + 10\text{ MT} = 50\text{ MT}$):** Re-apply Primary Grouping Hierarchy rules to form valid sub-batches that each satisfy the $>80\%$ utilization rule:
* Sub-batch A: $20\text{ MT} + 10\text{ MT} = 30\text{ MT}$ $\rightarrow$ **Allocate 30 MT Vehicle** ($100\%$ utilization)
* Sub-batch B: $20\text{ MT}$ $\rightarrow$ **Allocate 25 MT Vehicle** ($80\%$ utilization)



---

### 6. Input & Output Data Specifications

#### Input File Field Mapping

| Column Header | Field Description | Data Type / Format |
| --- | --- | --- |
| `Inv Qt.(MT)` | Order Weight / Quantity | Numeric (Float) |
| `SO/PO Date` | Order Placement Date | Date in **`DD/MM/YYYY`** format |
| `SO/STO creation time` | Order Placement Time | Time (`HH:MM:SS`) |
| `Sold to Party (dealer)` | Unique Dealer ID | String / Text |
| `Ship To Party Name` | Sub-dealer / Secondary Receiver Name | String / Text |
| `Dest.` | Destination Name | String / Text |
| `Lat` | Destination Latitude | Coordinate (Float) |
| `Lon` | Destination Longitude | Coordinate (Float) |

#### Output Artifacts

**1. Output Excel File:** Preserves all input rows intact and appends two allocation columns:

* `Vehicle Type Allotted`: Output options: `25`, `30`, `35`, or `NA`.
* `Vehicle ID`: Formatted as `<Vehicle_Capacity>_<Vehicle_Capacity_Counter>` (e.g., `25MT_1`, `35MT_4`). Rows routed to the depot receive `"NA"`. All $N$ orders sharing the same batched dispatch inherit the exact same `Vehicle ID` and increment the capacity counter by only 1.

**2. UI Summary Table:** Displays fleet requirements upon run completion:

| Vehicle Capacity | Fleet Count Required |
| --- | --- |
| **25 MT Fleet** | Count of unique active `25MT` vehicles used |
| **30 MT Fleet** | Count of unique active `30MT` vehicles used |
| **35 MT Fleet** | Count of unique active `35MT` vehicles used |
| **Total Fleet Executed** | **Sum of all unique vehicles dispatched** |