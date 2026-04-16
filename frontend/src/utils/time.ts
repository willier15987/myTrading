export type AppTimeZone = 'local' | 'UTC' | 'Asia/Taipei';

const TAIPEI_OFFSET_MINUTES = 8 * 60;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function parseDateTimeParts(value: string): [number, number, number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return match.slice(1).map(Number) as [number, number, number, number, number];
}

function getTimeZoneOffsetMinutes(tsMs: number, timezone: AppTimeZone): number {
  switch (timezone) {
    case 'UTC':
      return 0;
    case 'Asia/Taipei':
      return TAIPEI_OFFSET_MINUTES;
    default:
      return -new Date(tsMs).getTimezoneOffset();
  }
}

function getZonedDate(tsMs: number, timezone: AppTimeZone): Date {
  const offsetMinutes = getTimeZoneOffsetMinutes(tsMs, timezone);
  return new Date(tsMs + offsetMinutes * 60_000);
}

export function formatChartTime(utcSec: number, timezone: AppTimeZone): string {
  const zoned = getZonedDate(utcSec * 1000, timezone);
  const yy = String(zoned.getUTCFullYear()).slice(2);
  const month = zoned.getUTCMonth() + 1;
  const day = zoned.getUTCDate();
  const hour = pad(zoned.getUTCHours());
  const minute = pad(zoned.getUTCMinutes());
  return `${yy}/${month}/${day}-${hour}:${minute}`;
}

export function formatDateTime(tsMs: number, timezone: AppTimeZone): string {
  const zoned = getZonedDate(tsMs, timezone);
  return `${zoned.getUTCFullYear()}-${pad(zoned.getUTCMonth() + 1)}-${pad(zoned.getUTCDate())} ${pad(zoned.getUTCHours())}:${pad(zoned.getUTCMinutes())}`;
}

export function toDateTimeInputValue(tsMs: number, timezone: AppTimeZone): string {
  const zoned = getZonedDate(tsMs, timezone);
  return `${zoned.getUTCFullYear()}-${pad(zoned.getUTCMonth() + 1)}-${pad(zoned.getUTCDate())}T${pad(zoned.getUTCHours())}:${pad(zoned.getUTCMinutes())}`;
}

export function parseDateTimeInput(value: string, timezone: AppTimeZone): number | null {
  const parts = parseDateTimeParts(value);
  if (!parts) return null;
  const [year, month, day, hour, minute] = parts;

  switch (timezone) {
    case 'UTC':
      return Date.UTC(year, month - 1, day, hour, minute);
    case 'Asia/Taipei':
      return Date.UTC(year, month - 1, day, hour, minute) - TAIPEI_OFFSET_MINUTES * 60_000;
    default: {
      const ts = new Date(value).getTime();
      return Number.isFinite(ts) ? ts : null;
    }
  }
}

export function getTimeZoneLabel(timezone: AppTimeZone): string {
  switch (timezone) {
    case 'UTC':
      return 'UTC';
    case 'Asia/Taipei':
      return 'UTC+8';
    default:
      return 'Local';
  }
}

// Backward-compatible wrapper for untouched callers.
export function formatTimeTW(utcSec: number): string {
  return formatChartTime(utcSec, 'Asia/Taipei');
}
