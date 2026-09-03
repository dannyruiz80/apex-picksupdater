import { ApexGameStatus, ApexSport } from '../types.js';

/**
 * Normalizes ESPN status type to standard Apex Status
 */
export function normalizeStatus(
  statusName?: string,
  state?: string,
  completed?: boolean,
  detail?: string
): ApexGameStatus {
  const normName = (statusName || '').toUpperCase();
  const normState = (state || '').toLowerCase();
  const normDetail = (detail || '').toLowerCase();

  if (
    normName.includes('POSTPONED') ||
    normDetail.includes('postponed') ||
    normDetail.includes('rain delay') ||
    normDetail.includes('delayed')
  ) {
    return 'POSTPONED';
  }
  if (normName.includes('SUSPENDED') || normDetail.includes('suspended')) {
    return 'SUSPENDED';
  }
  if (normName.includes('CANCEL') || normDetail.includes('canceled') || normDetail.includes('cancelled')) {
    return 'CANCELLED';
  }
  if (
    completed ||
    normName === 'STATUS_FINAL' ||
    normName === 'STATUS_FULL_TIME' ||
    normName === 'STATUS_FINAL_PEN' ||
    normName === 'STATUS_FINAL_AET' ||
    normState === 'post' ||
    normDetail === 'final' ||
    normDetail === 'ft' ||
    normDetail === 'ft-pens' ||
    normDetail === 'aet'
  ) {
    return 'FINAL';
  }
  if (
    normName === 'STATUS_IN_PROGRESS' ||
    normName === 'STATUS_FIRST_HALF' ||
    normName === 'STATUS_SECOND_HALF' ||
    normName === 'STATUS_HALFTIME' ||
    normState === 'in' ||
    normName.includes('HALFTIME') ||
    normName.includes('INNING') ||
    normName.includes('QUARTER') ||
    normName.includes('PERIOD')
  ) {
    return 'LIVE';
  }
  if (normName === 'STATUS_SCHEDULED' || normName === 'STATUS_PRE_GAME' || normState === 'pre') {
    return 'UPCOMING';
  }

  if (normState === 'pre') return 'UPCOMING';
  if (normState === 'post') return 'FINAL';
  return 'UPCOMING';
}

/**
 * Get current date in America/Chicago timezone as YYYY-MM-DD
 */
export function getChicagoTodayDate(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

/**
 * Formats date input into valid YYYY-MM-DD, defaulting to America/Chicago today
 */
export function sanitizeScheduleDate(dateInput?: string): string {
  const trimmed = (dateInput || '').trim();
  if (trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return getChicagoTodayDate();
}
