import { OrderLineItem } from '../types';

/**
 * Parses date string in DD/MM/YYYY or YYYY-MM-DD or numeric Excel timestamp format
 */
export function parseDateString(dateVal: any): { year: number; month: number; day: number } | null {
  if (!dateVal) return null;

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
    // Excel epoch begins at 1899-12-30
    const excelEpoch = new Date(1899, 11, 30);
    const targetDate = new Date(excelEpoch.getTime() + dateVal * 86400000);
    return {
      year: targetDate.getFullYear(),
      month: targetDate.getMonth() + 1,
      day: targetDate.getDate(),
    };
  }

  const str = String(dateVal).trim();

  // Try DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    const year = parseInt(dmyMatch[3], 10);
    return { year, month, day };
  }

  // Try YYYY-MM-DD
  const ymdMatch = str.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10);
    const day = parseInt(ymdMatch[3], 10);
    return { year, month, day };
  }

  return null;
}

/**
 * Parses time string in HH:MM:SS or HH:MM or fractional day
 */
export function parseTimeString(timeVal: any): { hours: number; minutes: number; seconds: number } {
  if (!timeVal) return { hours: 10, minutes: 0, seconds: 0 };

  // If number (Excel fraction of day, e.g. 0.5 = 12:00:00)
  if (typeof timeVal === 'number' && timeVal >= 0 && timeVal < 1) {
    const totalSeconds = Math.round(timeVal * 86400);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { hours, minutes, seconds };
  }

  const str = String(timeVal).trim();
  const match = str.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (match) {
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = match[3] ? parseInt(match[3], 10) : 0;
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
  const shiftDurationMins = shiftEndMins - shiftStartMins;

  const orderTimeMins = parsedTime.hours * 60 + parsedTime.minutes;
  const slaDurationMins = Math.round(slaWindowHours * 60);

  let effectiveStartDate = new Date(orderDate.getTime());
  let isRolledOver = false;

  // Determine starting point
  if (orderTimeMins < shiftStartMins) {
    // Arrived before shift on same day: Timer starts at shift start
    effectiveStartDate.setHours(Math.floor(shiftStartMins / 60), shiftStartMins % 60, 0, 0);
  } else if (orderTimeMins >= shiftEndMins) {
    // Arrived after shift end: Timer rolls over to next day's shift start
    isRolledOver = true;
    effectiveStartDate.setDate(effectiveStartDate.getDate() + 1);
    effectiveStartDate.setHours(Math.floor(shiftStartMins / 60), shiftStartMins % 60, 0, 0);
  } else {
    // Arrived during operational shift: starts immediately
    effectiveStartDate = new Date(orderDate.getTime());
  }

  // Calculate Expiry Date considering shift boundaries
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
