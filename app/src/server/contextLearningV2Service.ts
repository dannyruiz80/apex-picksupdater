import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ApexSport, NormalizedApexGame } from '../types.js';
import type { GameMarketContextV2 } from './gameMarketContextService.js';

export type ContextFeatureStatus = 'ACTIVE' | 'OBSERVE_ONLY' | 'UNAVAILABLE';

export interface ContextFeatureContributionV2 {
  key: string;
  label: string;
  family: string;
  rawSignal: number | null;
  baseContribution: number;
  learnedMultiplier: number;
  appliedContribution: number;
  evidenceCount: number;
  source: string;
  status: ContextFeatureStatus;
  note?: string;
}

export interface ContextChallengerV2 {
  version: 'APEX_CONTEXT_LEARNING_V2';
  eventId: string;
  sport: ApexSport;
  generatedAt: string;
  evidenceCutoff: string;
  baseExpectedTotal: number;
  challengerExpectedTotal: number;
  totalAdjustment: number;
  featureHash: string;
  features: ContextFeatureContributionV2[];
  interactions: ContextFeatureContributionV2[];
  policy: string;
}

interface SnapshotLike {
  eventId?: string;
  sport?: string;
  eventStartTime?: string;
  gradedAt?: string | null;
  gradingStatus?: string;
  contextAudit?: any;
}

const SUPPORTED = new Set<ApexSport>(['MLB', 'SOCCER', 'WNBA', 'NFL', 'NCAAF']);
const MIN_FEATURE_EVIDENCE = 20;

function dataDir() { return process.env.APEX_DATA_DIR || path.join(process.cwd(), 'data'); }
function repoPath() { return path.join(dataDir(), 'gameMarketPredictionSnapshots.json'); }
function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
function finite(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function mean(values: Array<number | null | undefined>): number | null {
  const xs = values.map(finite).filter((v): v is number => v !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function sameSign(a: number, b: number) { return (a >= 0 && b >= 0) || (a <= 0 && b <= 0); }

function readRows(): SnapshotLike[] {
  try {
    const p = repoPath();
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function priorFeatureEvidence(sport: ApexSport, featureKey: string, eventStartTime: string) {
  const cutoff = Date.parse(eventStartTime);
  const observations: Array<{ delta: number; helped: boolean }> = [];
  if (!Number.isFinite(cutoff)) return observations;
  for (const row of readRows()) {
    if (row.sport !== sport || row.gradingStatus !== 'GRADED' || !row.contextAudit) continue;
    const start = Date.parse(String(row.eventStartTime || ''));
    const graded = Date.parse(String(row.gradedAt || ''));
    if (!Number.isFinite(start) || start >= cutoff) continue;
    // A result is allowed to teach only a later event if the result was known before that event.
    if (Number.isFinite(graded) && graded >= cutoff) continue;
    const audit = row.contextAudit;
    const base = finite(audit.baseExpectedTotal);
    const actual = finite(audit.actualTotal);
    if (base === null || actual === null) continue;
    const all = [...(audit.featureContributions || []), ...(audit.interactionContributions || [])];
    const f = all.find((x: any) => x?.key === featureKey);
    const contribution = finite(f?.appliedContribution ?? f?.baseContribution);
    if (contribution === null || Math.abs(contribution) < 1e-9) continue;
    const baseErr = Math.abs(base - actual);
    const singleErr = Math.abs(base + contribution - actual);
    observations.push({ delta: baseErr - singleErr, helped: singleErr < baseErr });
  }
  return observations;
}

function learnedMultiplier(sport: ApexSport, key: string, eventStartTime: string) {
  const obs = priorFeatureEvidence(sport, key, eventStartTime);
  const n = obs.length;
  if (n < MIN_FEATURE_EVIDENCE) return { multiplier: 1, evidenceCount: n };
  const helpRate = obs.filter((o) => o.helped).length / n;
  const meanGain = mean(obs.map((o) => o.delta)) ?? 0;
  // Conservative walk-forward adaptation: bounded around 1.0 and learned only from prior completed games.
  const multiplier = clamp(1 + (helpRate - 0.5) * 0.55 + clamp(meanGain, -1.5, 1.5) * 0.08, 0.65, 1.35);
  return { multiplier, evidenceCount: n };
}

function feature(params: {
  sport: ApexSport; eventStartTime: string; key: string; label: string; family: string; rawSignal: number | null;
  baseContribution: number; source: string; status?: ContextFeatureStatus; note?: string;
}): ContextFeatureContributionV2 {
  const status = params.status ?? (params.rawSignal === null ? 'UNAVAILABLE' : 'ACTIVE');
  if (status !== 'ACTIVE') {
    return { key: params.key, label: params.label, family: params.family, rawSignal: params.rawSignal, baseContribution: 0,
      learnedMultiplier: 1, appliedContribution: 0, evidenceCount: 0, source: params.source, status, note: params.note };
  }
  const learned = learnedMultiplier(params.sport, params.key, params.eventStartTime);
  return {
    key: params.key, label: params.label, family: params.family, rawSignal: params.rawSignal,
    baseContribution: params.baseContribution, learnedMultiplier: learned.multiplier,
    appliedContribution: params.baseContribution * learned.multiplier, evidenceCount: learned.evidenceCount,
    source: params.source, status, note: params.note,
  };
}

function mlbFeatures(game: NormalizedApexGame, baseTotal: number, c: GameMarketContextV2) {
  const m = c.mlb;
  if (!m) return { features: [] as ContextFeatureContributionV2[], interactions: [] as ContextFeatureContributionV2[], maxAbs: 1.8 };
  const avgEra = mean([m.homeStarterEra, m.awayStarterEra].filter((v): v is number => v !== null));
  const avgWhip = mean([m.homeStarterWhip, m.awayStarterWhip].filter((v): v is number => v !== null));
  const kbb = mean([
    m.homeStarterK9 !== null && m.homeStarterBb9 !== null ? m.homeStarterK9 - m.homeStarterBb9 : null,
    m.awayStarterK9 !== null && m.awayStarterBb9 !== null ? m.awayStarterK9 - m.awayStarterBb9 : null,
  ].filter((v): v is number => v !== null));
  const avgHr9 = mean([m.homeStarterHr9, m.awayStarterHr9].filter((v): v is number => v !== null));
  const parkFactor = finite((m as any).empiricalVenueRunFactor);
  const bullpen = mean([m.homeBullpenInningsLast3, m.awayBullpenInningsLast3].filter((v): v is number => v !== null));

  const features = [
    feature({ sport: 'MLB', eventStartTime: game.startTime, key: 'mlb_starter_run_prevention', label: 'Starter run prevention', family: 'STARTER', rawSignal: avgEra,
      baseContribution: clamp(((avgEra ?? 4.25) - 4.25) * 0.20 + ((avgWhip ?? 1.28) - 1.28) * 0.60, -0.65, 0.65), source: 'MLB StatsAPI pregame season-to-date ERA/WHIP' }),
    feature({ sport: 'MLB', eventStartTime: game.startTime, key: 'mlb_starter_kbb', label: 'Starter K-BB run suppression', family: 'STARTER', rawSignal: kbb,
      baseContribution: kbb === null ? 0 : clamp((6.0 - kbb) * 0.055, -0.32, 0.32), source: 'MLB StatsAPI season-to-date K/9 minus BB/9' }),
    feature({ sport: 'MLB', eventStartTime: game.startTime, key: 'mlb_starter_hr9', label: 'Starter home-run risk', family: 'CONTACT', rawSignal: avgHr9,
      baseContribution: avgHr9 === null ? 0 : clamp((avgHr9 - 1.20) * 0.24, -0.28, 0.34), source: 'MLB StatsAPI season-to-date HR/9' }),
    feature({ sport: 'MLB', eventStartTime: game.startTime, key: 'mlb_bullpen_workload', label: 'Bullpen workload', family: 'BULLPEN', rawSignal: bullpen,
      baseContribution: bullpen === null ? 0 : clamp((bullpen - 9.0) * 0.05, -0.25, 0.45), source: 'MLB completed relief innings across up to three recent games' }),
    feature({ sport: 'MLB', eventStartTime: game.startTime, key: 'mlb_temperature', label: 'Pregame temperature', family: 'WEATHER', rawSignal: m.temperatureF,
      baseContribution: m.temperatureF === null ? 0 : clamp((m.temperatureF - 70) * 0.018, -0.35, 0.35), source: 'MLB StatsAPI pregame weather' }),
    feature({ sport: 'MLB', eventStartTime: game.startTime, key: 'mlb_park_proxy', label: 'Empirical home-venue scoring factor', family: 'VENUE', rawSignal: parkFactor,
      baseContribution: parkFactor === null ? 0 : clamp((parkFactor - 1) * Math.max(6, baseTotal) * 0.45, -0.45, 0.45), source: 'Point-in-time home-team venue scoring history',
      note: 'This is an empirical venue scoring proxy, not a fabricated published park factor.' }),
    feature({ sport: 'MLB', eventStartTime: game.startTime, key: 'mlb_wind_observed', label: 'Pregame wind', family: 'WEATHER', rawSignal: m.windMph,
      baseContribution: 0, source: 'MLB StatsAPI pregame weather', status: 'OBSERVE_ONLY', note: 'Wind speed is frozen, but direction is not consistently structured; no scoring sign is inferred.' }),
  ];
  const starter = features.find((f) => f.key === 'mlb_starter_run_prevention')!;
  const park = features.find((f) => f.key === 'mlb_park_proxy')!;
  const hr = features.find((f) => f.key === 'mlb_starter_hr9')!;
  const interactions: ContextFeatureContributionV2[] = [];
  if (starter.status === 'ACTIVE' && park.status === 'ACTIVE' && sameSign(starter.baseContribution, park.baseContribution)) {
    interactions.push(feature({ sport: 'MLB', eventStartTime: game.startTime, key: 'mlb_starter_x_park', label: 'Starter × venue synergy', family: 'INTERACTION', rawSignal: starter.rawSignal,
      baseContribution: Math.sign(starter.baseContribution) * Math.min(Math.abs(starter.baseContribution), Math.abs(park.baseContribution)) * 0.22,
      source: 'Derived only from independently verified pregame starter and empirical venue features' }));
  }
  if (hr.status === 'ACTIVE' && park.status === 'ACTIVE' && sameSign(hr.baseContribution, park.baseContribution)) {
    interactions.push(feature({ sport: 'MLB', eventStartTime: game.startTime, key: 'mlb_hr_risk_x_park', label: 'HR-risk × venue interaction', family: 'INTERACTION', rawSignal: hr.rawSignal,
      baseContribution: Math.sign(hr.baseContribution) * Math.min(Math.abs(hr.baseContribution), Math.abs(park.baseContribution)) * 0.18,
      source: 'Derived from verified starter HR/9 and empirical venue scoring proxy' }));
  }
  return { features, interactions, maxAbs: 1.8 };
}

function soccerFeatures(game: NormalizedApexGame, baseTotal: number, c: GameMarketContextV2) {
  const s = c.soccer;
  const features: ContextFeatureContributionV2[] = [];
  if (!s) return { features, interactions: [] as ContextFeatureContributionV2[], maxAbs: 0.9 };
  const xgReady = [s.homeRecent5XgFor, s.homeRecent5XgAgainst, s.awayRecent5XgFor, s.awayRecent5XgAgainst].every((v) => v !== null);
  const projectedXg = xgReady
    ? ((s.homeRecent5XgFor! + s.awayRecent5XgAgainst!) / 2) + ((s.awayRecent5XgFor! + s.homeRecent5XgAgainst!) / 2)
    : null;
  const projectedSot = [s.homeRecent5ShotsOnTargetFor, s.homeRecent5ShotsOnTargetAgainst, s.awayRecent5ShotsOnTargetFor, s.awayRecent5ShotsOnTargetAgainst].every((v) => v !== null)
    ? ((s.homeRecent5ShotsOnTargetFor! + s.awayRecent5ShotsOnTargetAgainst!) / 2) + ((s.awayRecent5ShotsOnTargetFor! + s.homeRecent5ShotsOnTargetAgainst!) / 2)
    : null;
  const shotVolume = mean([s.homeRecent5ShotsFor, s.homeRecent5ShotsAgainst, s.awayRecent5ShotsFor, s.awayRecent5ShotsAgainst].filter((v): v is number => v !== null));
  const keeperSuppression = mean([s.homeKeeperXgSuppression, s.awayKeeperXgSuppression].filter((v): v is number => v !== null));
  const possessionGap = s.homeRecent5PossessionPct !== null && s.awayRecent5PossessionPct !== null ? Math.abs(s.homeRecent5PossessionPct - s.awayRecent5PossessionPct) : null;
  features.push(
    feature({ sport: 'SOCCER', eventStartTime: game.startTime, key: 'soccer_xg_total', label: 'Recent xG total', family: 'XG', rawSignal: projectedXg,
      baseContribution: projectedXg === null ? 0 : clamp((projectedXg - baseTotal) * 0.30, -0.58, 0.58), source: 'Completed pregame ESPN match summaries; missing xG stays null' }),
    feature({ sport: 'SOCCER', eventStartTime: game.startTime, key: 'soccer_sot_volume', label: 'Shots-on-target volume', family: 'CHANCE_QUALITY', rawSignal: projectedSot,
      baseContribution: projectedSot === null ? 0 : clamp((projectedSot - 8.0) * 0.045, -0.25, 0.25), source: 'Completed pregame ESPN match summaries' }),
    feature({ sport: 'SOCCER', eventStartTime: game.startTime, key: 'soccer_keeper_suppression', label: 'Goalkeeper xG suppression', family: 'KEEPER', rawSignal: keeperSuppression,
      baseContribution: keeperSuppression === null ? 0 : clamp(-keeperSuppression * 0.10, -0.22, 0.22), source: 'Pregame completed-match xG minus goals-against history' }),
    feature({ sport: 'SOCCER', eventStartTime: game.startTime, key: 'soccer_shot_transition_proxy', label: 'Shot-volume / transition proxy', family: 'TACTICAL_PROXY', rawSignal: shotVolume,
      baseContribution: shotVolume === null ? 0 : clamp((shotVolume - 12) * 0.018, -0.20, 0.20), source: 'Pregame completed-match shot volume',
      note: 'Apex labels this as a proxy; it is not relabeled as verified pressing data.' }),
    feature({ sport: 'SOCCER', eventStartTime: game.startTime, key: 'soccer_possession_shape', label: 'Possession-shape proxy', family: 'TACTICAL_PROXY', rawSignal: possessionGap,
      baseContribution: 0, source: 'Pregame completed-match possession', status: 'OBSERVE_ONLY', note: 'Possession imbalance is logged for attribution but receives no scoring sign until proven.' }),
  );
  const xg = features[0], sot = features[1];
  const interactions: ContextFeatureContributionV2[] = [];
  if (xg.status === 'ACTIVE' && sot.status === 'ACTIVE' && sameSign(xg.baseContribution, sot.baseContribution)) {
    interactions.push(feature({ sport: 'SOCCER', eventStartTime: game.startTime, key: 'soccer_xg_x_sot', label: 'xG × SOT confirmation', family: 'INTERACTION', rawSignal: projectedXg,
      baseContribution: Math.sign(xg.baseContribution) * Math.min(Math.abs(xg.baseContribution), Math.abs(sot.baseContribution)) * 0.20,
      source: 'Interaction between independently captured xG and shots-on-target signals' }));
  }
  return { features, interactions, maxAbs: 0.9 };
}

function wnbaFeatures(game: NormalizedApexGame, baseTotal: number, c: GameMarketContextV2) {
  const w = c.wnba;
  if (!w) return { features: [] as ContextFeatureContributionV2[], interactions: [] as ContextFeatureContributionV2[], maxAbs: 5.0 };
  const poss = mean([w.homeEstimatedPossessions, w.awayEstimatedPossessions].filter((v): v is number => v !== null));
  const homeEff = w.homeOffensiveRating !== null && w.awayDefensiveRating !== null ? (w.homeOffensiveRating + w.awayDefensiveRating) / 2 : null;
  const awayEff = w.awayOffensiveRating !== null && w.homeDefensiveRating !== null ? (w.awayOffensiveRating + w.homeDefensiveRating) / 2 : null;
  const derivedTotal = poss !== null && homeEff !== null && awayEff !== null ? poss * (homeEff + awayEff) / 100 : null;
  const recentTotal = mean([w.homeRecent5Total, w.awayRecent5Total].filter((v): v is number => v !== null));
  const fast = mean([w.homeFastBreakPoints, w.awayFastBreakPoints].filter((v): v is number => v !== null));
  const features = [
    feature({ sport: 'WNBA', eventStartTime: game.startTime, key: 'wnba_pace_efficiency_total', label: 'Pace × efficiency total', family: 'PACE_EFFICIENCY', rawSignal: derivedTotal,
      baseContribution: derivedTotal === null ? 0 : clamp((derivedTotal - baseTotal) * 0.22, -3.0, 3.0), source: 'Point-in-time ESPN boxscore possessions + offensive/defensive efficiency' }),
    feature({ sport: 'WNBA', eventStartTime: game.startTime, key: 'wnba_recent_total_form', label: 'Recent total form', family: 'FORM', rawSignal: recentTotal,
      baseContribution: recentTotal === null ? 0 : clamp((recentTotal - baseTotal) * 0.12, -2.0, 2.0), source: 'Point-in-time completed WNBA game totals' }),
    feature({ sport: 'WNBA', eventStartTime: game.startTime, key: 'wnba_fastbreak_context', label: 'Fast-break scoring context', family: 'TRANSITION', rawSignal: fast,
      baseContribution: fast === null ? 0 : clamp((fast - 11.0) * 0.07, -0.65, 0.65), source: 'Point-in-time ESPN fast-break points when exposed' }),
    feature({ sport: 'WNBA', eventStartTime: game.startTime, key: 'wnba_rest_b2b', label: 'Rest / back-to-back state', family: 'SCHEDULE', rawSignal: (w.homeBackToBack ? 1 : 0) + (w.awayBackToBack ? 1 : 0),
      baseContribution: 0, source: 'Verified prior-game timestamps', status: 'OBSERVE_ONLY', note: 'Rest is frozen and audited but does not manufacture a total edge until evidence supports a sign.' }),
  ];
  const pace = features[0], fastFeature = features[2];
  const interactions: ContextFeatureContributionV2[] = [];
  if (pace.status === 'ACTIVE' && fastFeature.status === 'ACTIVE' && sameSign(pace.baseContribution, fastFeature.baseContribution)) {
    interactions.push(feature({ sport: 'WNBA', eventStartTime: game.startTime, key: 'wnba_pace_x_transition', label: 'Pace × transition confirmation', family: 'INTERACTION', rawSignal: poss,
      baseContribution: Math.sign(pace.baseContribution) * Math.min(Math.abs(pace.baseContribution), Math.abs(fastFeature.baseContribution)) * 0.24,
      source: 'Interaction of verified pace/efficiency and fast-break context' }));
  }
  return { features, interactions, maxAbs: 5.0 };
}

function footballFeatures(game: NormalizedApexGame, baseTotal: number, c: GameMarketContextV2, sport: 'NFL' | 'NCAAF') {
  const f = sport === 'NFL' ? c.nfl : c.ncaaf;
  if (!f) return { features: [] as ContextFeatureContributionV2[], interactions: [] as ContextFeatureContributionV2[], maxAbs: sport === 'NFL' ? 4.0 : 5.5 };
  const plays = mean([f.homeOffensivePlaysPerGame, f.awayOffensivePlaysPerGame].filter((v): v is number => v !== null));
  const rz = mean([f.homeRedZoneTdRate, f.awayRedZoneTdRate].filter((v): v is number => v !== null));
  const recentTotal = mean([f.homeRecent5Total, f.awayRecent5Total].filter((v): v is number => v !== null));
  const wind = f.windMph;
  const features = [
    feature({ sport, eventStartTime: game.startTime, key: `${sport.toLowerCase()}_pace`, label: 'Offensive pace / plays', family: 'PACE', rawSignal: plays,
      baseContribution: plays === null ? 0 : clamp((plays - 64) * (sport === 'NFL' ? 0.10 : 0.08), -1.6, 1.6), source: 'Point-in-time ESPN offensive plays per game' }),
    feature({ sport, eventStartTime: game.startTime, key: `${sport.toLowerCase()}_redzone`, label: 'Red-zone touchdown efficiency', family: 'RED_ZONE', rawSignal: rz,
      baseContribution: rz === null ? 0 : clamp((rz - 0.60) * 4.2, -0.85, 0.85), source: 'Point-in-time ESPN red-zone efficiency when available' }),
    feature({ sport, eventStartTime: game.startTime, key: `${sport.toLowerCase()}_recent_totals`, label: 'Recent total scoring', family: 'FORM', rawSignal: recentTotal,
      baseContribution: recentTotal === null ? 0 : clamp((recentTotal - baseTotal) * (sport === 'NFL' ? 0.10 : 0.08), -1.8, 1.8), source: 'Point-in-time completed football totals' }),
    feature({ sport, eventStartTime: game.startTime, key: `${sport.toLowerCase()}_wind`, label: 'Pregame wind suppression', family: 'WEATHER', rawSignal: wind,
      baseContribution: wind === null ? 0 : clamp(-(Math.max(0, wind - 10)) * 0.14, -2.2, 0), source: 'Verified ESPN pregame weather' }),
    feature({ sport, eventStartTime: game.startTime, key: `${sport.toLowerCase()}_pressure`, label: 'Pressure / pass-rush rate', family: 'PRESSURE', rawSignal: null,
      baseContribution: 0, source: 'Unavailable verified public pregame source', status: 'UNAVAILABLE', note: 'Apex does not relabel yards/play as pressure rate.' }),
  ];
  const pace = features[0], rzFeature = features[1];
  const interactions: ContextFeatureContributionV2[] = [];
  if (pace.status === 'ACTIVE' && rzFeature.status === 'ACTIVE' && sameSign(pace.baseContribution, rzFeature.baseContribution)) {
    interactions.push(feature({ sport, eventStartTime: game.startTime, key: `${sport.toLowerCase()}_pace_x_redzone`, label: 'Pace × red-zone interaction', family: 'INTERACTION', rawSignal: plays,
      baseContribution: Math.sign(pace.baseContribution) * Math.min(Math.abs(pace.baseContribution), Math.abs(rzFeature.baseContribution)) * 0.20,
      source: 'Interaction of independently captured pace and red-zone context' }));
  }
  return { features, interactions, maxAbs: sport === 'NFL' ? 4.0 : 5.5 };
}

export function buildContextChallengerV2(game: NormalizedApexGame, baseExpectedTotal: number, context: GameMarketContextV2): ContextChallengerV2 | null {
  if (!SUPPORTED.has(game.sport) || !Number.isFinite(baseExpectedTotal)) return null;
  let built: { features: ContextFeatureContributionV2[]; interactions: ContextFeatureContributionV2[]; maxAbs: number };
  if (game.sport === 'MLB') built = mlbFeatures(game, baseExpectedTotal, context);
  else if (game.sport === 'SOCCER') built = soccerFeatures(game, baseExpectedTotal, context);
  else if (game.sport === 'WNBA') built = wnbaFeatures(game, baseExpectedTotal, context);
  else if (game.sport === 'NFL') built = footballFeatures(game, baseExpectedTotal, context, 'NFL');
  else built = footballFeatures(game, baseExpectedTotal, context, 'NCAAF');
  const active = [...built.features, ...built.interactions].filter((f) => f.status === 'ACTIVE');
  const adjustment = clamp(active.reduce((s, f) => s + f.appliedContribution, 0), -built.maxAbs, built.maxAbs);
  const fingerprint = JSON.stringify(active.map((f) => [f.key, f.rawSignal, f.learnedMultiplier, f.appliedContribution]));
  const featureHash = crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 20);
  return {
    version: 'APEX_CONTEXT_LEARNING_V2', eventId: game.eventId, sport: game.sport, generatedAt: new Date().toISOString(), evidenceCutoff: game.startTime,
    baseExpectedTotal, challengerExpectedTotal: Math.max(0.05, baseExpectedTotal + adjustment), totalAdjustment: adjustment, featureHash,
    features: built.features, interactions: built.interactions,
    policy: 'Pregame-only feature freeze. Learned multipliers use only earlier completed graded events, remain bounded, and stay shadow-only until sport-specific walk-forward evidence clears promotion gates.',
  };
}

export function contextFeatureWeightDiagnostics(sport: ApexSport, eventStartTime = new Date(8640000000000000).toISOString()) {
  const keys = new Set<string>();
  for (const row of readRows()) {
    if (row.sport !== sport || !row.contextAudit) continue;
    for (const f of [...(row.contextAudit.featureContributions || []), ...(row.contextAudit.interactionContributions || [])]) if (f?.key) keys.add(String(f.key));
  }
  return [...keys].sort().map((key) => {
    const obs = priorFeatureEvidence(sport, key, eventStartTime);
    const n = obs.length;
    const helpRate = n ? obs.filter((o) => o.helped).length / n : null;
    const meanErrorGain = n ? mean(obs.map((o) => o.delta)) : null;
    const learned = learnedMultiplier(sport, key, eventStartTime);
    return { key, evidenceCount: n, helpRate, meanErrorGain, learnedMultiplier: learned.multiplier };
  });
}
