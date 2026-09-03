import { ApexSport, NormalizedApexGame, MarketMatchingStats } from '../types';

export interface ProviderRawEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: any[];
}

export interface MatchResult {
  matched: boolean;
  apexGame?: NormalizedApexGame;
  providerEvent?: ProviderRawEvent;
  confidence: number;
  reason?: string;
  isAmbiguous?: boolean;
}

class MarketMatcherService {
  private stats: MarketMatchingStats = {
    providerEventsRetrieved: 0,
    successfullyMatched: 0,
    rejected: 0,
    ambiguous: 0,
    bySport: {
      MLB: { retrieved: 0, matched: 0, rejected: 0, ambiguous: 0 },
      NFL: { retrieved: 0, matched: 0, rejected: 0, ambiguous: 0 },
      NBA: { retrieved: 0, matched: 0, rejected: 0, ambiguous: 0 },
      WNBA: { retrieved: 0, matched: 0, rejected: 0, ambiguous: 0 },
      NHL: { retrieved: 0, matched: 0, rejected: 0, ambiguous: 0 },
      SOCCER: { retrieved: 0, matched: 0, rejected: 0, ambiguous: 0 },
      TENNIS: { retrieved: 0, matched: 0, rejected: 0, ambiguous: 0 },
    },
    recentRejections: [],
  };

  /**
   * Normalizes a string by lowercasing, removing diacritics, and stripping special characters.
   */
  public normalizeName(name: string): string {
    if (!name) return '';
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove accents
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Token-based similarity calculation between two strings.
   */
  public calculateSimilarity(str1: string, str2: string): number {
    const s1 = this.normalizeName(str1);
    const s2 = this.normalizeName(str2);

    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0;

    // Check substring / inclusion
    if (s1.includes(s2) || s2.includes(s1)) {
      const minLen = Math.min(s1.length, s2.length);
      const maxLen = Math.max(s1.length, s2.length);
      return Math.max(0.85, minLen / maxLen);
    }

    const tokens1 = new Set(s1.split(' ').filter((t) => t.length > 1));
    const tokens2 = new Set(s2.split(' ').filter((t) => t.length > 1));

    if (tokens1.size === 0 || tokens2.size === 0) return 0;

    let matchCount = 0;
    for (const t1 of tokens1) {
      for (const t2 of tokens2) {
        if (t1 === t2 || (t1.length >= 4 && t2.length >= 4 && (t1.includes(t2) || t2.includes(t1)))) {
          matchCount++;
          break;
        }
      }
    }

    const totalTokens = Math.max(tokens1.size, tokens2.size);
    return matchCount / totalTokens;
  }

  /**
   * Compares two tennis player names (handles "Last, First", "First Last", and initials).
   */
  public matchTennisPlayers(p1: string, p2: string): number {
    const n1 = this.normalizeName(p1);
    const n2 = this.normalizeName(p2);

    if (n1 === n2) return 1.0;

    const parts1 = n1.split(' ').filter(Boolean);
    const parts2 = n2.split(' ').filter(Boolean);

    if (parts1.length === 0 || parts2.length === 0) return 0;

    // Compare last names (usually the last word)
    const lastName1 = parts1[parts1.length - 1];
    const lastName2 = parts2[parts2.length - 1];

    if (lastName1 === lastName2 && lastName1.length >= 3) {
      // Check first initial if available
      const first1 = parts1[0];
      const first2 = parts2[0];
      if (first1[0] === first2[0]) {
        return 0.95;
      }
      return 0.85;
    }

    return this.calculateSimilarity(n1, n2);
  }

  /**
   * Strictly matches a single Apex game with candidate provider events.
   */
  public findBestMatch(
    apexGame: NormalizedApexGame,
    providerEvents: ProviderRawEvent[]
  ): MatchResult {
    const sport = apexGame.sport;
    this.recordRetrieved(sport, 1);

    const candidates: Array<{ event: ProviderRawEvent; confidence: number; reason: string }> = [];

    const apexTime = apexGame.startTime ? new Date(apexGame.startTime).getTime() : NaN;

    for (const pEvent of providerEvents) {
      const pTime = new Date(pEvent.commence_time).getTime();
      const hoursDiff = isNaN(apexTime) ? 0 : Math.abs(apexTime - pTime) / (1000 * 60 * 60);

      // Must be scheduled within 36 hours of each other
      if (!isNaN(apexTime) && hoursDiff > 36) {
        continue;
      }

      if (sport === 'TENNIS') {
        const aName = apexGame.playerAName || '';
        const bName = apexGame.playerBName || '';

        // Compare both (A vs home, B vs away) and (A vs away, B vs home)
        const matchDirectA = this.matchTennisPlayers(aName, pEvent.home_team);
        const matchDirectB = this.matchTennisPlayers(bName, pEvent.away_team);
        const directConf = (matchDirectA + matchDirectB) / 2;

        const matchSwapA = this.matchTennisPlayers(aName, pEvent.away_team);
        const matchSwapB = this.matchTennisPlayers(bName, pEvent.home_team);
        const swapConf = (matchSwapA + matchSwapB) / 2;

        const bestConf = Math.max(directConf, swapConf);

        // Strict threshold: both participants must pass >= 0.75
        const validDirect = matchDirectA >= 0.75 && matchDirectB >= 0.75;
        const validSwap = matchSwapA >= 0.75 && matchSwapB >= 0.75;

        if (bestConf >= 0.8 && (validDirect || validSwap)) {
          candidates.push({
            event: pEvent,
            confidence: bestConf,
            reason: `Tennis participants matched with ${(bestConf * 100).toFixed(1)}% confidence`,
          });
        }
      } else {
        // Team sports
        const homeName = apexGame.homeTeam || '';
        const awayName = apexGame.awayTeam || '';

        const directHome = this.calculateSimilarity(homeName, pEvent.home_team);
        const directAway = this.calculateSimilarity(awayName, pEvent.away_team);
        const directConf = (directHome + directAway) / 2;

        const swapHome = this.calculateSimilarity(homeName, pEvent.away_team);
        const swapAway = this.calculateSimilarity(awayName, pEvent.home_team);
        const swapConf = (swapHome + swapAway) / 2;

        const bestConf = Math.max(directConf, swapConf);
        const validDirect = directHome >= 0.65 && directAway >= 0.65;
        const validSwap = swapHome >= 0.65 && swapAway >= 0.65;

        if (bestConf >= 0.75 && (validDirect || validSwap)) {
          candidates.push({
            event: pEvent,
            confidence: bestConf,
            reason: `Teams matched with ${(bestConf * 100).toFixed(1)}% confidence`,
          });
        }
      }
    }

    if (candidates.length === 0) {
      this.recordRejection(
        sport,
        `No provider event met participant/team threshold for ${
          sport === 'TENNIS'
            ? `${apexGame.playerAName} vs ${apexGame.playerBName}`
            : `${apexGame.awayTeam} @ ${apexGame.homeTeam}`
        }`,
        apexGame.eventId
      );
      return {
        matched: false,
        confidence: 0,
        reason: 'No eligible candidate reached threshold',
      };
    }

    // Sort by confidence descending
    candidates.sort((a, b) => b.confidence - a.confidence);

    // Check for ambiguity if multiple close matches exist
    if (candidates.length > 1) {
      const topDiff = candidates[0].confidence - candidates[1].confidence;
      if (topDiff < 0.05 && candidates[0].confidence < 0.95) {
        this.recordAmbiguous(
          sport,
          `Ambiguous candidates for Apex event ${apexGame.eventId} (${candidates[0].event.id} vs ${candidates[1].event.id})`
        );
        return {
          matched: false,
          confidence: candidates[0].confidence,
          isAmbiguous: true,
          reason: 'Ambiguous matching candidates — rejected to prevent incorrect market linkage',
        };
      }
    }

    const winner = candidates[0];
    this.recordMatch(sport);
    return {
      matched: true,
      apexGame,
      providerEvent: winner.event,
      confidence: winner.confidence,
      reason: winner.reason,
    };
  }

  public recordRetrieved(sport: ApexSport, count: number = 1): void {
    this.stats.providerEventsRetrieved += count;
    if (this.stats.bySport[sport]) {
      this.stats.bySport[sport].retrieved += count;
    }
  }

  public recordMatch(sport: ApexSport): void {
    this.stats.successfullyMatched++;
    if (this.stats.bySport[sport]) {
      this.stats.bySport[sport].matched++;
    }
  }

  public recordRejection(sport: ApexSport, reason: string, providerEvent: string, candidate?: string): void {
    this.stats.rejected++;
    if (this.stats.bySport[sport]) {
      this.stats.bySport[sport].rejected++;
    }
    this.stats.recentRejections.unshift({
      timestamp: new Date().toISOString(),
      sport,
      reason,
      providerEvent,
      closestApexCandidate: candidate,
    });
    if (this.stats.recentRejections.length > 25) {
      this.stats.recentRejections.pop();
    }
  }

  public recordAmbiguous(sport: ApexSport, reason: string): void {
    this.stats.ambiguous++;
    if (this.stats.bySport[sport]) {
      this.stats.bySport[sport].ambiguous++;
    }
    this.stats.recentRejections.unshift({
      timestamp: new Date().toISOString(),
      sport,
      reason,
      providerEvent: 'AMBIGUOUS_CANDIDATES',
    });
    if (this.stats.recentRejections.length > 25) {
      this.stats.recentRejections.pop();
    }
  }

  public getStats(): MarketMatchingStats {
    return { ...this.stats };
  }
}

export const marketMatcher = new MarketMatcherService();
