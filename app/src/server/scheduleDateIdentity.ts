import { ApexSport } from '../types.js';

export const APEX_SCHEDULE_TIME_ZONE = 'America/Chicago';

function validScheduleDate(value: string | null | undefined): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

export function scheduleDateForStartTime(
  startTime: string | null | undefined,
  timeZone = APEX_SCHEDULE_TIME_ZONE,
): string | null {
  if (!startTime) return null;
  const ms = Date.parse(startTime);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function isStartTimeOnScheduleDate(
  startTime: string | null | undefined,
  scheduleDate: string | null | undefined,
  timeZone = APEX_SCHEDULE_TIME_ZONE,
): boolean {
  if (!validScheduleDate(scheduleDate)) return false;
  return scheduleDateForStartTime(startTime, timeZone) === scheduleDate;
}

export function requiresStrictFootballDateIdentity(sport: ApexSport): boolean {
  return sport === 'NFL' || sport === 'NCAAF';
}

export function isCanonicalFootballScheduleDate(
  sport: ApexSport,
  eventStartTime: string | null | undefined,
  selectedScheduleDate: string | null | undefined,
): boolean {
  if (!requiresStrictFootballDateIdentity(sport)) return true;
  return isStartTimeOnScheduleDate(eventStartTime, selectedScheduleDate);
}

export function footballProviderEventDateMatches(
  sport: ApexSport,
  apexStartTime: string | null | undefined,
  providerStartTime: string | null | undefined,
  selectedScheduleDate?: string | null,
): boolean {
  if (!requiresStrictFootballDateIdentity(sport)) return true;
  const apexDate = scheduleDateForStartTime(apexStartTime);
  const providerDate = scheduleDateForStartTime(providerStartTime);
  if (!apexDate || !providerDate || apexDate !== providerDate) return false;
  if (selectedScheduleDate && validScheduleDate(selectedScheduleDate) && apexDate !== selectedScheduleDate) return false;
  return true;
}
