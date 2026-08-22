import { OrderLineItem } from '../types';

/**
 * Realistic sample dataset demonstrating various grouping scenarios:
 * - Priority I: Same dealer, same destination (multi-order loads, high tonnage splits e.g. 35MT+15MT=50MT or 20+20+10=50MT)
 * - Priority II: Same dealer, multi-drop destinations within proximity
 * - Priority III: Cross-dealer proximate destinations
 * - SLA temporal cases: within shift, before shift, after shift (EOD rollover)
 * - Depot backlog cases: single isolated small order <20 MT that cannot be combined
 */
export const SAMPLE_SALES_REGISTER_ORDERS: Array<Omit<OrderLineItem, 'calculatedSla' | 'vehicleTypeAllotted' | 'vehicleId' | 'allocationReason'>> = [
  // Group A: Dealer DLR-101 - Direct full load 35 MT (Priority I)
  {
    id: 1,
    invQt: 35.0,
    soPoDate: '01/10/2026',
    soStoCreationTime: '10:15:00',
    soldToParty: 'DLR-101 (Apex Infra)',
    shipToPartyName: 'Apex Yard Alpha',
    dest: 'Metro Hub North',
    lat: 19.0760,
    lon: 72.8777,
    rawRowData: {
      'Order No': 'SO-9001',
      'Inv Qt.(MT)': 35.0,
      'SO/PO Date': '01/10/2026',
      'SO/STO creation time': '10:15:00',
      'Sold to Party (dealer)': 'DLR-101 (Apex Infra)',
      'Ship To Party Name': 'Apex Yard Alpha',
      'Dest.': 'Metro Hub North',
      'Lat': 19.0760,
      'Lon': 72.8777,
      'Product Code': 'CEM-OPC-53',
      'Customer Region': 'North Zone'
    }
  },
  // Group B: Dealer DLR-102 - 50 MT Split Case (20MT + 20MT + 10MT = 50MT) -> 30 MT (20+10) + 25 MT (20) (Priority I)
  {
    id: 2,
    invQt: 20.0,
    soPoDate: '01/10/2026',
    soStoCreationTime: '10:30:00',
    soldToParty: 'DLR-102 (Horizon Builders)',
    shipToPartyName: 'Horizon Project Site 1',
    dest: 'Navi Logistics Park',
    lat: 19.0330,
    lon: 73.0297,
    rawRowData: {
      'Order No': 'SO-9002',
      'Inv Qt.(MT)': 20.0,
      'SO/PO Date': '01/10/2026',
      'SO/STO creation time': '10:30:00',
      'Sold to Party (dealer)': 'DLR-102 (Horizon Builders)',
      'Ship To Party Name': 'Horizon Project Site 1',
      'Dest.': 'Navi Logistics Park',
      'Lat': 19.0330,
      'Lon': 73.0297,
      'Product Code': 'CEM-PPC',
      'Customer Region': 'East Zone'
    }
  },
  {
    id: 3,
    invQt: 20.0,
    soPoDate: '01/10/2026',
    soStoCreationTime: '10:45:00',
    soldToParty: 'DLR-102 (Horizon Builders)',
    shipToPartyName: 'Horizon Project Site 2',
    dest: 'Navi Logistics Park',
    lat: 19.0330,
    lon: 73.0297,
    rawRowData: {
      'Order No': 'SO-9003',
      'Inv Qt.(MT)': 20.0,
      'SO/PO Date': '01/10/2026',
      'SO/STO creation time': '10:45:00',
      'Sold to Party (dealer)': 'DLR-102 (Horizon Builders)',
      'Ship To Party Name': 'Horizon Project Site 2',
      'Dest.': 'Navi Logistics Park',
      'Lat': 19.0330,
      'Lon': 73.0297,
      'Product Code': 'CEM-PPC',
      'Customer Region': 'East Zone'
    }
  },
  {
    id: 4,
    invQt: 10.0,
    soPoDate: '01/10/2026',
    soStoCreationTime: '11:00:00',
    soldToParty: 'DLR-102 (Horizon Builders)',
    shipToPartyName: 'Horizon Depot Store',
    dest: 'Navi Logistics Park',
    lat: 19.0330,
    lon: 73.0297,
    rawRowData: {
      'Order No': 'SO-9004',
      'Inv Qt.(MT)': 10.0,
      'SO/PO Date': '01/10/2026',
      'SO/STO creation time': '11:00:00',
      'Sold to Party (dealer)': 'DLR-102 (Horizon Builders)',
      'Ship To Party Name': 'Horizon Depot Store',
      'Dest.': 'Navi Logistics Park',
      'Lat': 19.0330,
      'Lon': 73.0297,
      'Product Code': 'CEM-PPC',
      'Customer Region': 'East Zone'
    }
  },
  // Group C: Dealer DLR-103 - High Tonnage Split Case (35 MT + 15 MT = 50 MT) -> 35 MT dispatched, 15 MT to backlog (Priority I)
  {
    id: 5,
    invQt: 35.0,
    soPoDate: '01/10/2026',
    soStoCreationTime: '11:15:00',
    soldToParty: 'DLR-103 (Supreme Cements)',
    shipToPartyName: 'Supreme Warehouse Central',
    dest: 'Thane Industrial Zone',
    lat: 19.2183,
    lon: 72.9781,
    rawRowData: {
      'Order No': 'SO-9005',
      'Inv Qt.(MT)': 35.0,
      'SO/PO Date': '01/10/2026',
      'SO/STO creation time': '11:15:00',
      'Sold to Party (dealer)': 'DLR-103 (Supreme Cements)',
      'Ship To Party Name': 'Supreme Warehouse Central',
      'Dest.': 'Thane Industrial Zone',
      'Lat': 19.2183,
      'Lon': 72.9781,
      'Product Code': 'CEM-OPC-43',
      'Customer Region': 'Central Zone'
    }
  },
  {
    id: 6,
    invQt: 15.0,
    soPoDate: '01/10/2026',
    soStoCreationTime: '11:20:00',
    soldToParty: 'DLR-103 (Supreme Cements)',
    shipToPartyName: 'Supreme Satellite Yard',
    dest: 'Thane Industrial Zone',
    lat: 19.2183,
    lon: 72.9781,
    rawRowData: {
      'Order No': 'SO-9006',
      'Inv Qt.(MT)': 15.0,
      'SO/PO Date': '01/10/2026',
      'SO/STO creation time': '11:20:00',
      'Sold to Party (dealer)': 'DLR-103 (Supreme Cements)',
      'Ship To Party Name': 'Supreme Satellite Yard',
      'Dest.': 'Thane Industrial Zone',
      'Lat': 19.2183,
      'Lon': 72.9781,
      'Product Code': 'CEM-OPC-43',
      'Customer Region': 'Central Zone'
    }
  },
  // Group D: Dealer DLR-104 - Multi-drop Same Dealer (Priority II) (18 MT + 14 MT = 32 MT -> 35 MT vehicle)
  {
    id: 7,
    invQt: 18.0,
    soPoDate: '01/10/2026',
    soStoCreationTime: '12:00:00',
    soldToParty: 'DLR-104 (Zenith Logistics)',
    shipToPartyName: 'Zenith Hub A',
    dest: 'Bhiwandi Cargo City',
    lat: 19.2967,
    lon: 73.0631,
    rawRowData: {
      'Order No': 'SO-9007',
      'Inv Qt.(MT)': 18.0,
      'SO/PO Date': '01/10/2026',
      'SO/STO creation time': '12:00:00',
      'Sold to Party (dealer)': 'DLR-104 (Zenith Logistics)',
      'Ship To Party Name': 'Zenith Hub A',
      'Dest.': 'Bhiwandi Cargo City',
      'Lat': 19.2967,
      'Lon': 73.0631,
      'Product Code': 'CEM-OPC-53',
      'Customer Region': 'North-East'
    }
  },
  {
    id: 8,
    invQt: 14.0,
    soPoDate: '01/10/2026',
    soStoCreationTime: '12:15:00',
    soldToParty: 'DLR-104 (Zenith Logistics)',
    shipToPartyName: 'Zenith Hub B',
    dest: 'Kalyan Freight Terminal',
    lat: 19.2403,
    lon: 73.1305,
    rawRowData: {
      'Order No': 'SO-9008',
      'Inv Qt.(MT)': 14.0,
      'SO/PO Date': '01/10/2026',
      'SO/STO creation time': '12:15:00',
      'Sold to Party (dealer)': 'DLR-104 (Zenith Logistics)',
      'Ship To Party Name': 'Zenith Hub B',
      'Dest.': 'Kalyan Freight Terminal',
      'Lat': 19.2403,
      'Lon': 73.1305,
      'Product Code': 'CEM-OPC-53',
      'Customer Region': 'North-East'
    }
  },
  // Group E: Priority III Cross-Dealer Multi-Drop (DLR-105 & DLR-106: 15 MT + 13 MT = 28 MT -> 30 MT vehicle)
  {
    id: 9,
    invQt: 15.0,
    soPoDate: '01/10/2026',
    soStoCreationTime: '13:00:00',
    soldToParty: 'DLR-105 (Prime Structures)',
    shipToPartyName: 'Prime Site Panvel',
    dest: 'Panvel Industrial Estate',
    lat: 18.9894,
    lon: 73.1175,
    rawRowData: {
      'Order No': 'SO-9009',
      'Inv Qt.(MT)': 15.0,
      'SO/PO Date': '01/10/2026',
      'SO/STO creation time': '13:00:00',
      'Sold to Party (dealer)': 'DLR-105 (Prime Structures)',
      'Ship To Party Name': 'Prime Site Panvel',
      'Dest.': 'Panvel Industrial Estate',
      'Lat': 18.9894,
      'Lon': 73.1175,
      'Product Code': 'CEM-PPC',
      'Customer Region': 'South Zone'
    }
  },
  {
    id: 10,
    invQt: 13.0,
    soPoDate: '01/10/2026',
    soStoCreationTime: '13:30:00',
    soldToParty: 'DLR-106 (Crown Concrete)',
    shipToPartyName: 'Crown RMC Plant',
    dest: 'Taloja MIDC',
    lat: 19.0620,
    lon: 73.1250,
    rawRowData: {
      'Order No': 'SO-9010',
      'Inv Qt.(MT)': 13.0,
      'SO/PO Date': '01/10/2026',
      'SO/STO creation time': '13:30:00',
      'Sold to Party (dealer)': 'DLR-106 (Crown Concrete)',
      'Ship To Party Name': 'Crown RMC Plant',
      'Dest.': 'Taloja MIDC',
      'Lat': 19.0620,
      'Lon': 73.1250,
      'Product Code': 'CEM-PPC',
      'Customer Region': 'South Zone'
    }
  },
  // Group F: EOD Roll-over order (arriving at 18:00 on 01/10/2026 after 17:00 shift end)
  {
    id: 11,
    invQt: 24.0,
    soPoDate: '01/10/2026',
    soStoCreationTime: '18:00:00',
    soldToParty: 'DLR-107 (Overnight Infra)',
    shipToPartyName: 'Overnight Depot Vashi',
    dest: 'Vashi Freight Yard',
    lat: 19.0771,
    lon: 72.9986,
    rawRowData: {
      'Order No': 'SO-9011',
      'Inv Qt.(MT)': 24.0,
      'SO/PO Date': '01/10/2026',
      'SO/STO creation time': '18:00:00',
      'Sold to Party (dealer)': 'DLR-107 (Overnight Infra)',
      'Ship To Party Name': 'Overnight Depot Vashi',
      'Dest.': 'Vashi Freight Yard',
      'Lat': 19.0771,
      'Lon': 72.9986,
      'Product Code': 'CEM-OPC-53',
      'Customer Region': 'West Zone'
    }
  },
  // Group G: Priority I single 30 MT direct load (28 MT in 30 MT vehicle)
  {
    id: 12,
    invQt: 28.0,
    soPoDate: '02/10/2026',
    soStoCreationTime: '10:05:00',
    soldToParty: 'DLR-108 (Falcon Heavy)',
    shipToPartyName: 'Falcon Bridge Project',
    dest: 'JNPT Port Road',
    lat: 18.9500,
    lon: 72.9500,
    rawRowData: {
      'Order No': 'SO-9012',
      'Inv Qt.(MT)': 28.0,
      'SO/PO Date': '02/10/2026',
      'SO/STO creation time': '10:05:00',
      'Sold to Party (dealer)': 'DLR-108 (Falcon Heavy)',
      'Ship To Party Name': 'Falcon Bridge Project',
      'Dest.': 'JNPT Port Road',
      'Lat': 18.9500,
      'Lon': 72.9500,
      'Product Code': 'CEM-SRC',
      'Customer Region': 'Port Zone'
    }
  },
  // Group H: Small isolated order that fails >80% threshold and stays in depot backlog
  {
    id: 13,
    invQt: 8.5,
    soPoDate: '02/10/2026',
    soStoCreationTime: '14:00:00',
    soldToParty: 'DLR-109 (Remote Retailer)',
    shipToPartyName: 'Remote Retailer Shop',
    dest: 'Alibaug Outpost',
    lat: 18.6414,
    lon: 72.8722,
    rawRowData: {
      'Order No': 'SO-9013',
      'Inv Qt.(MT)': 8.5,
      'SO/PO Date': '02/10/2026',
      'SO/STO creation time': '14:00:00',
      'Sold to Party (dealer)': 'DLR-109 (Remote Retailer)',
      'Ship To Party Name': 'Remote Retailer Shop',
      'Dest.': 'Alibaug Outpost',
      'Lat': 18.6414,
      'Lon': 72.8722,
      'Product Code': 'CEM-PPC',
      'Customer Region': 'Coastal Zone'
    }
  }
];
