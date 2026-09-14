import { OrderLineItem } from '../types';

/**
 * Parses date string in DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, ISO string, or numeric Excel timestamp format
 */
export function parseDateString(dateVal: any): { year: number; month: number; day: number } | null {
  if (dateVal === null || dateVal === undefined || dateVal === '') return null;

  // If already a JS Date
  if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
    return {
      year: dateVal.getFullYear(),
      month: dateVal.getMonth() + 1,
      day: dateVal.getDate(),
    };
  }

  // If number (Excel serial date)
  if (typeof dateVal === 'number') {
    // If it's pure fractional (time of day only), default date
    if (dateVal >= 0 && dateVal < 1) {
      return { year: 2026, month: 10, day: 1 };
    }
    // Excel epoch begins at 1899-12-30 (accounting for 1900 leap year bug)
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const targetDate = new Date(excelEpoch.getTime() + Math.floor(dateVal) * 86400000);
    return {
      year: targetDate.getUTCFullYear(),
      month: targetDate.getUTCMonth() + 1,
      day: targetDate.getUTCDate(),
    };
  }

  const str = String(dateVal).trim();
  if (!str) return null;

  // If contains 'T' or looks like an ISO string, e.g. "2026-10-01T18:30:00.000Z"
  if (str.includes('T')) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return {
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
      };
    }
  }

  // Try DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmyMatch = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    const year = parseInt(dmyMatch[3], 10);
    return { year, month, day };
  }

  // Try YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = str.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10);
    const day = parseInt(ymdMatch[3], 10);
    return { year, month, day };
  }

  // Fallback try standard Date parse
  const fallbackDate = new Date(str);
  if (!isNaN(fallbackDate.getTime())) {
    return {
      year: fallbackDate.getFullYear(),
      month: fallbackDate.getMonth() + 1,
      day: fallbackDate.getDate(),
    };
  }

  return null;
}

/**
 * Parses time string in HH:MM:SS, HH:MM, 12-hour AM/PM format, or numeric Excel fractional day / full timestamp
 */
export function parseTimeString(timeVal: any): { hours: number; minutes: number; seconds: number } {
  if (timeVal === null || timeVal === undefined || timeVal === '') {
    return { hours: 10, minutes: 0, seconds: 0 };
  }

  // If already a JS Date
  if (timeVal instanceof Date && !isNaN(timeVal.getTime())) {
    return {
      hours: timeVal.getHours(),
      minutes: timeVal.getMinutes(),
      seconds: timeVal.getSeconds(),
    };
  }

  // If number (Excel fraction of day or serial number)
  if (typeof timeVal === 'number') {
    const frac = timeVal % 1;
    const effectiveFrac = frac >= 0 ? frac : 1 + frac;
    const totalSeconds = Math.round(effectiveFrac * 86400);
    const hours = Math.floor(totalSeconds / 3600) % 24;
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { hours, minutes, seconds };
  }

  const str = String(timeVal).trim();

  // Check if it's an ISO datetime string like "2026-10-01T18:30:00"
  if (str.includes('T')) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return {
        hours: d.getHours(),
        minutes: d.getMinutes(),
        seconds: d.getSeconds(),
      };
    }
  }

  // Match 12-hour format with AM/PM (e.g., "6:30 PM", "06:30:00 PM", "11:15am")
  const ampmMatch = str.match(/(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*([aApP][mM])/i);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = parseInt(ampmMatch[2], 10);
    const seconds = ampmMatch[3] ? parseInt(ampmMatch[3], 10) : 0;
    const meridiem = ampmMatch[4].toUpperCase();

    if (meridiem === 'PM' && hours < 12) {
      hours += 12;
    } else if (meridiem === 'AM' && hours === 12) {
      hours = 0;
    }

    return { hours, minutes, seconds };
  }

  // Match 24-hour format HH:MM:SS or HH:MM
  const match = str.match(/(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (match) {
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = match[3] ? parseInt(match[3], 10) : 0;
    return { hours, minutes, seconds };
  }

  // Check if string contains a float number representing fraction of day
  const floatVal = parseFloat(str);
  if (!isNaN(floatVal) && floatVal >= 0 && floatVal < 1) {
    const totalSeconds = Math.round(floatVal * 86400);
    const hours = Math.floor(totalSeconds / 3600) % 24;
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { hours, minutes, seconds };
  }

  return { hours: 10, minutes: 0, seconds: 0 };
}

/**
 * Parses "HH:MM" shift time string to minutes from midnight
 */
export function parseShiftTimeToMinutes(timeStr: string): number {
  const { hours, minutes } = parseTimeString(timeStr);
  return hours * 60 + minutes;
}

/**
 * Formats a Date object to readable "DD/MM/YYYY HH:MM"
 */
export function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = pad(date.getDate());
  const m = pad(date.getMonth() + 1);
  const y = date.getFullYear();
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${d}/${m}/${y} ${h}:${min}`;
}

/**
 * Computes the operational SLA Window for an order line item
 * Taking into account Shift Start, Shift End, SLA duration, and EOD Roll-over logic.
 * 
 * Rules:
 * 1. Before Shift Start (e.g. < 10:00): Timer starts on the SAME day at Shift Start (10:00).
 * 2. During Shift (e.g. 10:00 <= Order Time < 17:00): Timer starts IMMEDIATELY at Order Time.
 * 3. At or After Shift End (e.g. >= 17:00): Timer is rolled over (EOD Rollover),
 *    so Effective Start Time starts on the NEXT operational day at Shift Start (10:00 of Day+1).
 *    Expiry Time is calculated starting from this next day's shift start.
 * 4. Multi-day SLA overflow: If remaining SLA minutes exceed remaining shift duration on any day,
 *    the timer rolls into subsequent operating days at Shift Start until SLA duration is satisfied.
 */
export function calculateOrderSla(
  soPoDateStr: string,
  soCreationTimeStr: string,
  slaWindowHours: number,
  shiftStartStr: string = '10:00',
  shiftEndStr: string = '17:00'
) {
  const parsedDate = parseDateString(soPoDateStr) || { year: 2026, month: 10, day: 1 };
  const parsedTime = parseTimeString(soCreationTimeStr);

  const orderDate = new Date(
    parsedDate.year,
    parsedDate.month - 1,
    parsedDate.day,
    parsedTime.hours,
    parsedTime.minutes,
    parsedTime.seconds
  );

  const shiftStartMins = parseShiftTimeToMinutes(shiftStartStr);
  const shiftEndMins = parseShiftTimeToMinutes(shiftEndStr);

  const orderTimeMins = parsedTime.hours * 60 + parsedTime.minutes;
  const slaDurationMins = Math.round(slaWindowHours * 60);

  // Initialize effectiveStartDate
  const effectiveStartDate = new Date(
    parsedDate.year,
    parsedDate.month - 1,
    parsedDate.day,
    0,
    0,
    0,
    0
  );
  let isRolledOver = false;

  // Determine starting point
  if (orderTimeMins < shiftStartMins) {
    // Arrived before shift on same day: Timer starts at shift start on same day
    effectiveStartDate.setHours(Math.floor(shiftStartMins / 60), shiftStartMins % 60, 0, 0);
  } else if (orderTimeMins >= shiftEndMins) {
    // Arrived after shift end (or exactly at shift end):
    // SLA Effective Start rolls over to the NEXT day at shift start
    isRolledOver = true;
    effectiveStartDate.setDate(effectiveStartDate.getDate() + 1);
    effectiveStartDate.setHours(Math.floor(shiftStartMins / 60), shiftStartMins % 60, 0, 0);
  } else {
    // Arrived during operational shift: starts immediately at order time
    effectiveStartDate.setHours(parsedTime.hours, parsedTime.minutes, parsedTime.seconds, 0);
  }

  // Calculate Expiry Date considering operational shift boundaries
  let remainingSlaMins = slaDurationMins;
  let currentDate = new Date(effectiveStartDate.getTime());

  while (remainingSlaMins > 0) {
    const currentMinsFromMidnight = currentDate.getHours() * 60 + currentDate.getMinutes();
    const availableTodayMins = shiftEndMins - currentMinsFromMidnight;

    if (availableTodayMins <= 0) {
      // Advance to next day's shift start
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(Math.floor(shiftStartMins / 60), shiftStartMins % 60, 0, 0);
      continue;
    }

    if (remainingSlaMins <= availableTodayMins) {
      // Expires within current shift day
      currentDate.setMinutes(currentDate.getMinutes() + remainingSlaMins);
      remainingSlaMins = 0;
    } else {
      // Consumes rest of today's shift and rolls remaining SLA to next day
      remainingSlaMins -= availableTodayMins;
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(Math.floor(shiftStartMins / 60), shiftStartMins % 60, 0, 0);
    }
  }

  const expiryDate = currentDate;

  return {
    orderTimestamp: orderDate.getTime(),
    effectiveStartTimestamp: effectiveStartDate.getTime(),
    expiryTimestamp: expiryDate.getTime(),
    formattedStartTime: formatTimestamp(effectiveStartDate),
    formattedExpiryTime: formatTimestamp(expiryDate),
    isRolledOver,
  };
}

/**
 * Formats a delay duration in minutes to a human-readable string (e.g. "+3.5 hrs", "+1d 4h", "SLA Met")
 */
export function formatDelayString(delayMinutes: number): string {
  if (delayMinutes <= 0) return 'SLA Met';
  const hours = delayMinutes / 60;
  if (delayMinutes < 60) {
    return `+${delayMinutes}m delay`;
  }
  if (delayMinutes < 1440) {
    return `+${(Math.round(hours * 10) / 10).toFixed(1)} hrs`;
  }
  const days = Math.floor(delayMinutes / 1440);
  const remHours = Math.round(((delayMinutes % 1440) / 60) * 10) / 10;
  return `+${days}d ${remHours > 0 ? `${remHours}h` : ''} (+${hours.toFixed(1)}h)`;
}

/**
 * Parses an E-Way Bill date & time string, serial timestamp, or Date object
 */
export function parseEWayBillTimestamp(
  ewbVal: any,
  fallbackDateStr?: string,
  fallbackTimeStr?: string
): { timestamp: number; formatted: string } | null {
  if (ewbVal === null || ewbVal === undefined || ewbVal === '') {
    if (!fallbackDateStr) return null;
    const pDate = parseDateString(fallbackDateStr);
    if (!pDate) return null;
    const pTime = parseTimeString(fallbackTimeStr || '18:00:00');
    const dt = new Date(pDate.year, pDate.month - 1, pDate.day, pTime.hours, pTime.minutes, pTime.seconds);
    return {
      timestamp: dt.getTime(),
      formatted: formatTimestamp(dt),
    };
  }

  // If already a JS Date
  if (ewbVal instanceof Date && !isNaN(ewbVal.getTime())) {
    return {
      timestamp: ewbVal.getTime(),
      formatted: formatTimestamp(ewbVal),
    };
  }

  // If Excel serial number (integer date + fractional time)
  if (typeof ewbVal === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const targetDate = new Date(excelEpoch.getTime() + ewbVal * 86400000);
    return {
      timestamp: targetDate.getTime(),
      formatted: formatTimestamp(targetDate),
    };
  }

  const str = String(ewbVal).trim();
  if (!str || str.toLowerCase() === 'na' || str.toLowerCase() === 'null') {
    return null;
  }

  // If ISO string e.g. "2026-10-01T14:30:00"
  if (str.includes('T')) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return {
        timestamp: d.getTime(),
        formatted: formatTimestamp(d),
      };
    }
  }

  // Try parsing date and time components
  const pDate = parseDateString(str);
  if (pDate) {
    let timeStr = '';
    const parts = str.split(/[ T]/).filter(Boolean);
    if (parts.length > 1) {
      timeStr = parts.slice(1).join(' ');
    }
    const pTime = timeStr ? parseTimeString(timeStr) : parseTimeString(fallbackTimeStr || '18:00:00');
    const dt = new Date(pDate.year, pDate.month - 1, pDate.day, pTime.hours, pTime.minutes, pTime.seconds);
    return {
      timestamp: dt.getTime(),
      formatted: formatTimestamp(dt),
    };
  }

  // Fallback to JS Date parse
  const fallback = new Date(str);
  if (!isNaN(fallback.getTime())) {
    return {
      timestamp: fallback.getTime(),
      formatted: formatTimestamp(fallback),
    };
  }

  return null;
}

/**
 * Calculates the SLA window and compares against historical E-Way Bill date & time to measure SLA breaches and delays
 */
export function evaluateOrderSlaWithActuals(
  order: OrderLineItem,
  slaWindowHours: number,
  shiftStartStr: string = '10:00',
  shiftEndStr: string = '17:00'
): NonNullable<OrderLineItem['calculatedSla']> {
  const soDate = order.soPoDate || order.rawRowData?.['SO/PO Date'] || order.rawRowData?.['SO Date'] || order.rawRowData?.['PO Date'] || '01/10/2026';
  const soTime = order.soStoCreationTime || order.rawRowData?.['SO/STO creation time'] || order.rawRowData?.['Creation Time'] || '10:00:00';

  const baseSla = calculateOrderSla(soDate, soTime, slaWindowHours, shiftStartStr, shiftEndStr);

  // Extract E-Way Bill value
  const rawEwb = order.eWayBillDateTime 
    || order.rawRowData?.['E-Way Bill date & time']
    || order.rawRowData?.['E-Way Bill Date & Time']
    || order.rawRowData?.['Eway Bill date & time']
    || order.rawRowData?.['E-Way Bill Date/Time']
    || order.eWayBillDate
    || order.rawRowData?.['E-Way Bill Date']
    || order.rawRowData?.['Dispatch Date'];

  const ewbParsed = parseEWayBillTimestamp(rawEwb, order.eWayBillDate || soDate, soTime);

  let isSlaBreached = false;
  let delayMinutes = 0;
  let delayHours = 0;
  let formattedDelay = 'SLA Met';

  if (ewbParsed) {
    const diffMs = ewbParsed.timestamp - baseSla.expiryTimestamp;
    if (diffMs > 0) {
      delayMinutes = Math.round(diffMs / 60000);
      delayHours = Math.round((delayMinutes / 60) * 10) / 10;
      isSlaBreached = delayMinutes > 0;
      formattedDelay = formatDelayString(delayMinutes);
    }
  }

  const enrichedSla = {
    ...baseSla,
    eWayBillTimestamp: ewbParsed?.timestamp,
    formattedEWayBillTime: ewbParsed?.formatted,
    isSlaBreached,
    delayMinutes,
    delayHours,
    formattedDelay,
  };

  order.calculatedSla = enrichedSla;
  return enrichedSla;
}

/**
 * Checks if a group of orders share an overlapping SLA dispatch window.
 * All orders batched together MUST overlap:
 * max(effectiveStartTimestamps) <= min(expiryTimestamps)
 */
export function doOrdersOverlapSla(orders: OrderLineItem[]): boolean {
  if (orders.length <= 1) return true;

  let maxStart = -Infinity;
  let minExpiry = Infinity;

  for (const order of orders) {
    if (!order.calculatedSla) continue;
    if (order.calculatedSla.effectiveStartTimestamp > maxStart) {
      maxStart = order.calculatedSla.effectiveStartTimestamp;
    }
    if (order.calculatedSla.expiryTimestamp < minExpiry) {
      minExpiry = order.calculatedSla.expiryTimestamp;
    }
  }

  return maxStart <= minExpiry;
}
