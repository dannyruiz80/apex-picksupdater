import crypto from 'crypto';
import {
  ApexSport,
  ApexSportFilter,
  DecisionBoardPick,
  NormalizedApexGame,
  ParlayFunnelStats,
  ParlayLeg,
  ParlayScanResponse,
  ParlayTicket,
} from '../types.js';
import { decisionBoardService, rankDecisionBoardPicks } from './decisionBoardService.js';
import { bankrollService } from './bankrollService.js';

const MAX_QUOTE_AGE_SECONDS = 10 * 60;
const MAX_COMBINED_EV_FOR_AUTO_QUALIFY = 25;
const MIN_COMBINED_EV = 3;
const MIN_INDEPENDENCE_PROBABILITY = 0.12;
const PARLAY_SLATE_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PARLAY_MAX_GAMES = 24;
const MAX_PARLAY_SCAN_GAMES = 36;

interface ParlayBuildMetrics {
  combinationsConsidered: number;
  distinctEventCombinations: number;
  commonBookCombinations: number;
  valueClearedCombinations: number;
}
interface ParlayBuildResult {
  tickets: ParlayTicket[];
  reviewTickets: ParlayTicket[];
  metrics: ParlayBuildMetrics;
}
interface CachedParlaySlate {
  createdAtMs: number;
  rawPicks: DecisionBoardPick[];
  liveEventsEvaluated: number;
  cachedEventsSeeded: number;
  providerStatus: 'OK' | 'NOT_CONFIGURED' | 'QUOTA_BLOCKED';
}

function decimalFromAmerican(american:number){return american>0?1+american/100:1+100/Math.abs(american);}
function americanFromDecimal(decimal:number){if(decimal>=2)return Math.round((decimal-1)*100);return Math.round(-100/(decimal-1));}
function normalizeBook(v:string){return v.toLowerCase().replace(/[^a-z0-9]+/g,'').trim();}
function currentQuoteAgeSeconds(p:DecisionBoardPick){
  const t=Date.parse(p.quoteTimestamp); return Number.isFinite(t)?Math.max(0,Math.round((Date.now()-t)/1000)):null;
}
function isPushSensitive(p:DecisionBoardPick){
  if(p.line===null)return false;
  if(p.side!=='OVER'&&p.side!=='UNDER'&&p.gameMarketType!=='SPREAD'&&p.gameMarketType!=='TOTAL')return false;
  return Math.abs(p.line-Math.round(p.line))<1e-9;
}
function validLeg(p:DecisionBoardPick){
  if(!p.pointInTimeValid)return 'POINT_IN_TIME_INVALID';
  const age=currentQuoteAgeSeconds(p); if(age===null||age>MAX_QUOTE_AGE_SECONDS)return 'STALE_PRICE';
  if(p.pickType==='GAME_MARKET'&&p.gameIntegrityStatus!=='QUALIFIED')return 'GAME_MARKET_NOT_QUALIFIED';
  if(p.apexProbability<=0||p.apexProbability>=1)return 'INVALID_PROBABILITY';
  if(isPushSensitive(p))return 'PUSH_SENSITIVE_INTEGER_LINE';
  if(!(p.bookOffers?.length||p.sportsbook))return 'NO_EXECUTABLE_BOOK';
  return null;
}
function offersFor(p:DecisionBoardPick){
  const rows=(p.bookOffers?.length?p.bookOffers:[{sportsbook:p.sportsbook,oddsAmerican:p.oddsAmerican,quoteTimestamp:p.quoteTimestamp}])
    .filter(o=>typeof o.oddsAmerican==='number'&&Number.isFinite(o.oddsAmerican));
  const m=new Map<string,{sportsbook:string;oddsAmerican:number;quoteTimestamp:string}>();
  for(const o of rows){const k=normalizeBook(o.sportsbook);const ex=m.get(k);if(!ex||o.oddsAmerican>ex.oddsAmerican)m.set(k,o);}
  return m;
}
function combinations<T>(arr:T[],k:number):T[][]{
  const out:T[][]=[]; const cur:T[]=[];
  const rec=(start:number)=>{if(cur.length===k){out.push([...cur]);return;}for(let i=start;i<arr.length;i++){cur.push(arr[i]);rec(i+1);cur.pop();}};
  rec(0);return out;
}
function nChooseK(n:number,k:number){
  if(k<0||n<k)return 0; if(k===0||n===k)return 1; let v=1; const kk=Math.min(k,n-k);
  for(let i=1;i<=kk;i++)v=(v*(n-kk+i))/i; return Math.round(v);
}
function commonBook(legs:DecisionBoardPick[]){
  const maps=legs.map(offersFor); if(maps.some(m=>m.size===0))return null;
  const common=[...maps[0].keys()].filter(k=>maps.every(m=>m.has(k)));
  let best:null|{key:string;sportsbook:string;decimal:number;offers:Array<{sportsbook:string;oddsAmerican:number;quoteTimestamp:string}>}=null;
  for(const k of common){const offers=maps.map(m=>m.get(k)!);const dec=offers.reduce((d,o)=>d*decimalFromAmerican(o.oddsAmerican),1);if(!best||dec>best.decimal)best={key:k,sportsbook:offers[0].sportsbook,decimal:dec,offers};}
  return best;
}
function ticketStakeUnits(p:number,d:number,early:boolean){
  const b=d-1,q=1-p; const full=b>0?(b*p-q)/b:0; const quarter=Math.max(0,full/4); const units=quarter/0.01;
  const cap=early?0.25:0.50; return Math.max(0,Math.min(cap,Math.round(units*20)/20));
}
function toLeg(p:DecisionBoardPick,book:string,oddsAmerican:number):ParlayLeg{
  return {eventId:p.eventId,eventTitle:p.eventTitle,sport:p.sport,league:p.league,displayPick:p.displayPick||p.selectionLabel||p.marketCategory,
    pickType:p.pickType||'PLAYER_PROP',marketCategory:p.marketCategory,gameMarketType:p.gameMarketType??null,playerName:p.playerName,side:p.side,line:p.line,
    sportsbook:book,oddsAmerican,probability:p.apexProbability,breakEvenProbability:p.breakEvenProbability,expectedValuePercent:p.expectedValuePercent,
    reliabilityTier:p.reliabilityTier,modelVersion:p.modelVersion,modelValidationStatus:p.modelValidationStatus??null};
}

/** Round-robin slate selection keeps ALL SPORTS from becoming a one-sport scan. */
export function selectParlaySlateRows(
  games:NormalizedApexGame[],
  sportFilter:ApexSportFilter,
  maxGames:number,
  nowMs=Date.now(),
  preferredEventIds:ReadonlySet<string>=new Set<string>(),
):NormalizedApexGame[]{
  const candidates=games.filter(g=>g.status==='UPCOMING'&&g.startTime&&Date.parse(g.startTime)>nowMs&&(sportFilter==='ALL'||g.sport===sportFilter))
    .sort((a,b)=>{
      const pa=preferredEventIds.has(a.eventId)?0:1; const pb=preferredEventIds.has(b.eventId)?0:1;
      if(pa!==pb)return pa-pb;
      return Date.parse(a.startTime)-Date.parse(b.startTime);
    });
  if(sportFilter!=='ALL')return candidates.slice(0,maxGames);
  const bySport=new Map<ApexSport,NormalizedApexGame[]>();
  for(const g of candidates){const bucket=bySport.get(g.sport)||[];bucket.push(g);bySport.set(g.sport,bucket);}
  // Fairness remains round-robin by sport, but within each sport events from the most
  // recent Picks scan are evaluated first so Parlay Lab reuses proven candidates.
  const sports=[...bySport.keys()]; const out:NormalizedApexGame[]=[]; let round=0;
  while(out.length<maxGames){let added=false;for(const sport of sports){const g=bySport.get(sport)?.[round];if(g){out.push(g);added=true;if(out.length>=maxGames)break;}}if(!added)break;round++;}
  return out;
}

/** Primary parlay pool = strongest production-qualified leg from each event. */
export function selectEventRepresentatives(eligible:DecisionBoardPick[]):DecisionBoardPick[]{
  const ranked=rankDecisionBoardPicks(eligible,200); const seen=new Set<string>(); const out:DecisionBoardPick[]=[];
  for(const p of ranked){if(seen.has(p.eventId))continue;seen.add(p.eventId);out.push(p);}return out;
}
export function selectStraightAlternatives(eligible:DecisionBoardPick[],limit=3):DecisionBoardPick[]{
  return selectEventRepresentatives(eligible).slice(0,Math.max(0,limit));
}

/**
 * Bound the fallback search so a slate with dozens of qualified markets cannot explode
 * into millions of 4-leg combinations. Keep at most two strong alternatives per event
 * across the best 16 distinct events; this is enough to recover common-book compatibility
 * without freezing Parlay Lab.
 */
export function selectBoundedAlternativeLegPool(eligible:DecisionBoardPick[],maxEvents=16,perEvent=2):DecisionBoardPick[]{
  const ranked=rankDecisionBoardPicks(eligible,500);
  const eventOrder:string[]=[]; const byEvent=new Map<string,DecisionBoardPick[]>();
  for(const pick of ranked){
    if(!byEvent.has(pick.eventId)){
      if(eventOrder.length>=Math.max(1,maxEvents))continue;
      eventOrder.push(pick.eventId); byEvent.set(pick.eventId,[]);
    }
    const bucket=byEvent.get(pick.eventId);
    if(bucket&&bucket.length<Math.max(1,perEvent))bucket.push(pick);
  }
  return eventOrder.flatMap(id=>byEvent.get(id)||[]);
}

export class ParlayService {
  private slateCache=new Map<string,CachedParlaySlate>();

  buildTickets(eligible:DecisionBoardPick[],legCount:number,rejectedReasons:Record<string,number>):ParlayBuildResult{
    const tickets:ParlayTicket[]=[]; const reviews:ParlayTicket[]=[];
    const metrics:ParlayBuildMetrics={combinationsConsidered:0,distinctEventCombinations:0,commonBookCombinations:0,valueClearedCombinations:0};
    for(const combo of combinations(eligible,legCount)){
      metrics.combinationsConsidered++;
      if(new Set(combo.map(x=>x.eventId)).size!==combo.length){rejectedReasons.SAME_EVENT_CORRELATION_BLOCKED=(rejectedReasons.SAME_EVENT_CORRELATION_BLOCKED||0)+1;continue;}
      metrics.distinctEventCombinations++;
      const common=commonBook(combo); if(!common){rejectedReasons.NO_COMMON_SPORTSBOOK=(rejectedReasons.NO_COMMON_SPORTSBOOK||0)+1;continue;}
      metrics.commonBookCombinations++;
      const p=combo.reduce((v,l)=>v*l.apexProbability,1); const d=common.decimal; const be=1/d; const ev=(p*d-1)*100;
      if(ev<MIN_COMBINED_EV){rejectedReasons.COMBINED_EV_BELOW_3_PERCENT=(rejectedReasons.COMBINED_EV_BELOW_3_PERCENT||0)+1;continue;}
      metrics.valueClearedCombinations++;
      const early=combo.some(l=>l.pickType==='GAME_MARKET'&&l.modelValidationStatus==='EARLY_EVIDENCE');
      const reasons=['DISTINCT_EVENTS_ONLY','SINGLE_EXECUTABLE_SPORTSBOOK','INDEPENDENCE_BASELINE_NOT_JOINT_MODEL'];
      let status:ParlayTicket['status']='QUALIFIED';
      if(ev>MAX_COMBINED_EV_FOR_AUTO_QUALIFY){status='REVIEW';reasons.push('COMBINED_EV_HEIGHTENED_REVIEW');}
      if(p<MIN_INDEPENDENCE_PROBABILITY){status='REVIEW';reasons.push('LOW_COMBINED_HIT_PROBABILITY_REVIEW');}
      if(early)reasons.push('EARLY_GAME_MODEL_STAKE_CAP');
      const legs=combo.map((l,i)=>toLeg(l,common.sportsbook,common.offers[i].oddsAmerican));
      const id='par_'+crypto.createHash('sha256').update(`${common.key}|${legs.map(l=>`${l.eventId}:${l.displayPick}:${l.oddsAmerican}`).join('|')}`).digest('hex').slice(0,18);
      const rawStakeUnits=ticketStakeUnits(p,d,early);
      const ticket:ParlayTicket={ticketId:id,status,sportsbook:common.sportsbook,legs,legCount,combinedAmericanOdds:americanFromDecimal(d),combinedDecimalOdds:d,
        independenceProbability:p,combinedBreakEvenProbability:be,independenceExpectedValuePercent:ev,correlationRisk:'LOW_UNMODELED',
        correlationNote:'All legs are from distinct events. Combined probability is an independence baseline, not a validated correlated joint probability.',
        suggestedStakeUnits:rawStakeUnits,bankrollStake:bankrollService.previewStake(rawStakeUnits,'PARLAY'),stakeSizingMethod:'QUARTER_KELLY_CAPPED',reasons};
      (status==='QUALIFIED'?tickets:reviews).push(ticket);
    }
    const score=(t:ParlayTicket)=>t.independenceProbability*(1+Math.min(25,t.independenceExpectedValuePercent)/100);
    tickets.sort((a,b)=>score(b)-score(a)); reviews.sort((a,b)=>score(b)-score(a));
    return {tickets:tickets.slice(0,8),reviewTickets:reviews.slice(0,8),metrics};
  }

  private getEligible(raw:DecisionBoardPick[],rejectedReasons:Record<string,number>){
    const eligible:DecisionBoardPick[]=[];
    for(const p of rankDecisionBoardPicks(raw,200)){const reason=validLeg(p);if(reason){rejectedReasons[reason]=(rejectedReasons[reason]||0)+1;continue;}eligible.push(p);}return eligible;
  }

  private cacheKey(rows:NormalizedApexGame[],sportFilter:ApexSportFilter,scheduleDate:string,maxGames:number){
    return `${sportFilter}|${scheduleDate}|${maxGames}|${rows.map(g=>g.eventId).join(',')}`;
  }

  async scan(games:NormalizedApexGame[],sportFilter:ApexSportFilter,scheduleDate:string,legCountRaw:number,maxGamesRaw:number,scheduleDatesScanned:string[]=[]):Promise<ParlayScanResponse>{
    const legCount=Math.max(2,Math.min(4,Math.floor(legCountRaw||2)));
    const maxGames=Math.max(legCount,Math.min(MAX_PARLAY_SCAN_GAMES,Math.floor(maxGamesRaw||DEFAULT_PARLAY_MAX_GAMES)));
    const scanDates=scheduleDatesScanned.length?scheduleDatesScanned:[scheduleDate];
    const recentBoardPicks=rankDecisionBoardPicks(scanDates.flatMap(d=>decisionBoardService.getRecentQualifiedPicks(sportFilter,d)),500);
    const preferredEventIds=new Set(recentBoardPicks.map(p=>p.eventId));
    const rows=selectParlaySlateRows(games,sportFilter,maxGames,Date.now(),preferredEventIds);
    const dates=scheduleDatesScanned.length?scheduleDatesScanned:[...new Set(rows.map(g=>(g.startTime||'').slice(0,10)).filter(Boolean))];
    const emptyFunnel:ParlayFunnelStats={scheduleEventsConsidered:rows.length,cachedEventsSeeded:0,liveEventsEvaluated:0,distinctEligibleEvents:0,representativeLegs:0,possibleIndependentCombinations:0,commonBookCombinations:0,valueClearedCombinations:0,fallbackAlternativeLegsUsed:false};
    if(!rows.length)return {status:'NO_UPCOMING_EVENTS',message:'No verified upcoming events are available for parlay scanning.',generatedAt:new Date().toISOString(),sportFilter,scheduleDate,scheduleDatesScanned:dates,
      requestedLegCount:legCount,gamesScanned:0,eligibleLegCount:0,qualifiedTicketCount:0,tickets:[],reviewTickets:[],eligibleLegs:[],straightAlternatives:[],rejectedReasons:{},funnel:emptyFunnel,cacheStatus:'MISS',notes:['No keyed provider request was made because no eligible event existed.']};

    const key=this.cacheKey(rows,sportFilter,scheduleDate,maxGames); const cached=this.slateCache.get(key); const now=Date.now();
    let raw:DecisionBoardPick[]=[]; let liveEventsEvaluated=0; let cachedEventsSeeded=0; let providerStatus:CachedParlaySlate['providerStatus']='OK'; let cacheStatus:ParlayScanResponse['cacheStatus']='MISS';
    const cachedEligible=cached&&now-cached.createdAtMs<=PARLAY_SLATE_CACHE_TTL_MS?this.getEligible(cached.rawPicks,{}):[];
    const cachedHasEnoughFreshEvents=new Set(cachedEligible.map(p=>p.eventId)).size>=legCount;
    if(cached&&now-cached.createdAtMs<=PARLAY_SLATE_CACHE_TTL_MS&&cachedHasEnoughFreshEvents){raw=[...cached.rawPicks];liveEventsEvaluated=0;cachedEventsSeeded=new Set(cached.rawPicks.map(p=>p.eventId)).size;providerStatus=cached.providerStatus;cacheStatus='HIT';}
    else {
      if(cached)this.slateCache.delete(key);
      // Zero-credit current Picks-board recommendations seed first. Saved prop snapshots
      // are merged next. This prevents Parlay Lab from ignoring a slate that the user
      // just proved contains many production-qualified recommendations.
      const selectedIds=new Set(rows.map(g=>g.eventId));
      const recentSeed=recentBoardPicks.filter(p=>selectedIds.has(p.eventId));
      const saved:DecisionBoardPick[]=[];
      for(const d of [...new Set(rows.map(g=>(g.startTime||'').slice(0,10)).filter(Boolean))]){
        saved.push(...decisionBoardService.getSavedBoard(sportFilter,d).picks.filter(p=>selectedIds.has(p.eventId)));
      }
      raw.push(...recentSeed,...saved);
      const seededEventIds=new Set([...recentSeed,...saved].map(p=>p.eventId));
      cachedEventsSeeded=seededEventIds.size;
      if(recentSeed.length)cacheStatus='SAVED_SEED'; else if(saved.length)cacheStatus='SAVED_SEED';

      const preliminaryReasons:Record<string,number>={}; const preliminaryEligible=this.getEligible(raw,preliminaryReasons); const preliminaryReps=selectEventRepresentatives(preliminaryEligible);
      const preliminaryBuilt=this.buildTickets(preliminaryReps,legCount,{});
      const enoughCachedBreadth=preliminaryReps.length>=Math.min(maxGames,Math.max(6,legCount+2));
      // A production-qualified ticket from the already-verified Picks slate is enough
      // to avoid unnecessary provider calls. Review-only output still seeks more breadth.
      const canUseSavedOnly=preliminaryBuilt.tickets.length>0||(enoughCachedBreadth&&preliminaryBuilt.reviewTickets.length>=2);

      if(!canUseSavedOnly){
        // Evaluate unseeded events first. Events already represented by fresh board/cache
        // picks are enrichment-only and run last.
        const liveOrder=[...rows.filter(g=>!seededEventIds.has(g.eventId)),...rows.filter(g=>seededEventIds.has(g.eventId))];
        for(const game of liveOrder){
          const evaluated=await decisionBoardService.evaluateEvent(game); liveEventsEvaluated++; raw.push(...evaluated.picks);
          if(evaluated.status==='NOT_CONFIGURED'){providerStatus='NOT_CONFIGURED';break;}
          if(evaluated.status==='QUOTA_BLOCKED'){providerStatus='QUOTA_BLOCKED';break;}
          // Stop enrichment once enough distinct breadth exists and multiple executable
          // tickets have been proven. The minimum grows with requested leg count.
          if(liveEventsEvaluated>=Math.min(Math.max(6,legCount+2),rows.length)){
            const quickReasons:Record<string,number>={}; const quickEligible=this.getEligible(raw,quickReasons); const quickReps=selectEventRepresentatives(quickEligible); const quick=this.buildTickets(quickReps,legCount,{});
            if(quick.tickets.length>=3)break;
          }
        }
      }
      this.slateCache.set(key,{createdAtMs:now,rawPicks:[...raw],liveEventsEvaluated,cachedEventsSeeded,providerStatus});
    }

    const rejectedReasons:Record<string,number>={}; const eligible=this.getEligible(raw,rejectedReasons); const representatives=selectEventRepresentatives(eligible);
    const preferred=this.buildTickets(representatives,legCount,rejectedReasons); let built=preferred; let fallbackAlternativeLegsUsed=false;
    if(preferred.tickets.length===0&&eligible.length>representatives.length){
      const fallbackReasons:Record<string,number>={};
      const boundedAlternatives=selectBoundedAlternativeLegPool(eligible,Math.min(16,maxGames),2);
      const fallback=this.buildTickets(boundedAlternatives,legCount,fallbackReasons);
      if(fallback.tickets.length>0||fallback.reviewTickets.length>preferred.reviewTickets.length){built=fallback;fallbackAlternativeLegsUsed=true;for(const [k,v] of Object.entries(fallbackReasons))rejectedReasons[k]=(rejectedReasons[k]||0)+v;}
    }
    const straightAlternatives=selectStraightAlternatives(eligible,3);
    let status:ParlayScanResponse['status']='NO_QUALIFIED_PICKS';
    if(built.tickets.length)status='SUCCESS'; else if(providerStatus==='NOT_CONFIGURED')status='NOT_CONFIGURED'; else if(providerStatus==='QUOTA_BLOCKED')status='QUOTA_BLOCKED';
    const funnel:ParlayFunnelStats={scheduleEventsConsidered:rows.length,cachedEventsSeeded,liveEventsEvaluated,distinctEligibleEvents:new Set(eligible.map(p=>p.eventId)).size,
      representativeLegs:representatives.length,possibleIndependentCombinations:nChooseK(representatives.length,legCount),commonBookCombinations:built.metrics.commonBookCombinations,
      valueClearedCombinations:built.metrics.valueClearedCombinations,fallbackAlternativeLegsUsed};
    const noParlayMessage=status==='NOT_CONFIGURED'?'Odds provider is not configured.':status==='QUOTA_BLOCKED'?'Provider quota guard stopped the live scan; any fresh cached straight alternatives remain visible.':
      `No parlay cleared all leg, sportsbook, correlation and ticket-value gates.${straightAlternatives.length?' Best straight alternatives are shown below.':''}`;
    return {status,message:built.tickets.length?`${built.tickets.length} executable ${legCount}-leg parlay candidate${built.tickets.length===1?'':'s'} cleared the parlay gate.`:noParlayMessage,
      generatedAt:new Date().toISOString(),sportFilter,scheduleDate,scheduleDatesScanned:dates,requestedLegCount:legCount,gamesScanned:rows.length,eligibleLegCount:eligible.length,
      qualifiedTicketCount:built.tickets.length,tickets:built.tickets,reviewTickets:built.reviewTickets,eligibleLegs:eligible,straightAlternatives:built.tickets.length?[]:straightAlternatives,rejectedReasons,funnel,cacheStatus,
      notes:['Parlay discovery considers up to 24 events by default (36 maximum) and can span the next seven schedule days when the selected date is late or sparse.',
        'ALL SPORTS mode round-robins sports before repeating one sport so a single league cannot dominate the scan.',
        'Fresh recommendations from the current Picks-board scan seed Parlay Lab at zero provider credits; saved prop snapshots are merged next, and a five-minute slate cache prevents repeated clicks or leg-count changes from refetching the same live slate.',
        'The first parlay pass uses only the strongest production-qualified leg from each event. If common-book compatibility fails, a bounded fallback considers up to two strong alternatives per event without combinatorial explosion.',
        'Only production QUALIFIED legs are eligible. REVIEW/VERIFY/PASS game markets cannot enter a recommended parlay.',
        'Same-event parlays are blocked until Apex has a validated joint-distribution/correlation model.',
        'A recommended ticket must have one common sportsbook offering the exact line/side for every leg.',
        'Combined probability is explicitly an independence baseline. It is not presented as a precise correlated fair probability.',
        'Integer push-sensitive spread/total/prop lines are excluded from auto-generated tickets because parlay push rules vary by sportsbook.',
        'Suggested ticket stake uses quarter-Kelly converted to units and is capped at 0.25u when any early-evidence game-market leg is present; otherwise 0.50u. When bankroll tracking is configured, dollar sizing is exposure-adjusted against the current bankroll, daily risk cap and open-exposure cap.']};
  }
}
export const parlayService=new ParlayService();
