import { ApexSport, NormalizedApexGame } from '../types';

export interface VerifiedRosterAthlete {
  id: string; // ESPN Athlete ID
  displayName: string;
  fullName?: string;
  shortName?: string;
  normalizedName: string;
  normalizedLastName: string;
  position?: string;
  jersey?: string;
  teamId: string;
  teamName: string;
}

export interface PlayerVerificationResult {
  verified: boolean;
  status: 'VERIFIED' | 'REJECTED';
  rejectionReason?:
    | 'WRONG_TEAM'
    | 'UNKNOWN_PLAYER'
    | 'AMBIGUOUS_NAME'
    | 'EVENT_NOT_UPCOMING'
    | 'SPORT_UNSUPPORTED';
  rejectionDetail?: string;
  athleteId: string | null;
  playerDisplayName: string;
  verifiedTeam: string;
  verifiedOpponent: string;
  position?: string | null;
  jersey?: string | null;
  rosterSource: string;
}

class PlayerRosterService {
  // In-memory cache for team rosters: key -> athletes list
  private rosterCache: Map<
    string,
    { athletes: VerifiedRosterAthlete[]; cachedAt: number }
  > = new Map();
  private readonly CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 Hours

  /**
   * Normalizes player name for matching while preserving alphanumeric tokens.
   * Strips accents/diacritics, periods, apostrophes, hyphens, and standardizes suffixes.
   */
  public normalizePlayerName(name: string): string {
    if (!name) return '';
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove diacritics
      .toLowerCase()
      .replace(/['"`\.]/g, '') // remove apostrophes, quotes, dots
      .replace(/[\-_]/g, ' ') // convert hyphens to space
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '') // strip common suffixes for token matching
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extracts the primary normalized surname.
   */
  public getNormalizedLastName(name: string): string {
    const norm = this.normalizePlayerName(name);
    const parts = norm.split(' ').filter(Boolean);
    if (parts.length === 0) return '';
    return parts[parts.length - 1];
  }

  /**
   * Fetches official team roster from ESPN.
   */
  public async getTeamRoster(
    sport: ApexSport,
    teamId: string | null,
    teamName: string,
    league?: string
  ): Promise<VerifiedRosterAthlete[]> {
    if (!teamId && !teamName) return [];

    const cacheKey = `ROSTER::${sport}::${teamId || teamName}`;
    const cached = this.rosterCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.athletes;
    }

    const athletes: VerifiedRosterAthlete[] = [];

    try {
      let endpoint = '';
      if (sport === 'MLB' && teamId) {
        endpoint = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/${teamId}/roster`;
      } else if (sport === 'NFL' && teamId) {
        endpoint = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`;
      } else if (sport === 'NBA' && teamId) {
        endpoint = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`;
      } else if (sport === 'WNBA' && teamId) {
        endpoint = `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/${teamId}/roster`;
      } else if (sport === 'NHL' && teamId) {
        endpoint = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${teamId}/roster`;
      } else if (sport === 'SOCCER' && teamId) {
        const l = (league || 'eng.1').toLowerCase();
        endpoint = `https://site.api.espn.com/apis/site/v2/sports/soccer/${l}/teams/${teamId}/roster`;
      }

      if (endpoint) {
        const res = await fetch(endpoint, {
          headers: {
            'User-Agent': 'ApexPicks/1.0 (RosterVerificationEngine)',
            Accept: 'application/json',
          },
        });

        if (res.ok) {
          const data: any = await res.json();
          const groups = Array.isArray(data.athletes) ? data.athletes : [];
          for (const group of groups) {
            const items = Array.isArray(group.items) ? group.items : [];
            for (const item of items) {
              const displayName = item.displayName || item.fullName || item.name || '';
              if (!displayName) continue;

              athletes.push({
                id: String(item.id || ''),
                displayName,
                fullName: item.fullName || displayName,
                shortName: item.shortName,
                normalizedName: this.normalizePlayerName(displayName),
                normalizedLastName: this.getNormalizedLastName(displayName),
                position: item.position?.abbreviation || group.position || null,
                jersey: item.jersey || null,
                teamId: teamId || '',
                teamName,
              });
            }
          }
        }
      }
    } catch (err: any) {
      console.warn(`[PlayerRosterService] Failed to fetch roster for ${teamName} (${sport}):`, err.message);
    }

    this.rosterCache.set(cacheKey, { athletes, cachedAt: Date.now() });
    return athletes;
  }

  /**
   * Strictly verifies a player against the two participating teams (or tennis participants) in an event.
   */
  public async verifyAndResolvePlayer(
    sport: ApexSport,
    apexGame: NormalizedApexGame,
    rawPlayerName: string
  ): Promise<PlayerVerificationResult> {
    if (!rawPlayerName || !rawPlayerName.trim()) {
      return {
        verified: false,
        status: 'REJECTED',
        rejectionReason: 'UNKNOWN_PLAYER',
        rejectionDetail: 'Empty or missing player name in provider quote',
        athleteId: null,
        playerDisplayName: rawPlayerName || 'Unknown',
        verifiedTeam: '',
        verifiedOpponent: '',
        rosterSource: 'None',
      };
    }

    // 1. Tennis Participant Verification (Individual Sport)
    if (sport === 'TENNIS') {
      return this.verifyTennisParticipant(apexGame, rawPlayerName);
    }

    // 2. Team-Sport Roster Verification
    const homeTeam = apexGame.homeTeam || 'Home Team';
    const awayTeam = apexGame.awayTeam || 'Away Team';
    const homeTeamId = apexGame.homeTeamId;
    const awayTeamId = apexGame.awayTeamId;

    const [homeRoster, awayRoster] = await Promise.all([
      this.getTeamRoster(sport, homeTeamId, homeTeam, apexGame.league),
      this.getTeamRoster(sport, awayTeamId, awayTeam, apexGame.league),
    ]);

    const targetNorm = this.normalizePlayerName(rawPlayerName);
    const targetLastName = this.getNormalizedLastName(rawPlayerName);

    // Exact full normalized name match
    const homeExact = homeRoster.find((a) => a.normalizedName === targetNorm);
    const awayExact = awayRoster.find((a) => a.normalizedName === targetNorm);

    if (homeExact && !awayExact) {
      return {
        verified: true,
        status: 'VERIFIED',
        athleteId: homeExact.id,
        playerDisplayName: homeExact.displayName,
        verifiedTeam: homeTeam,
        verifiedOpponent: awayTeam,
        position: homeExact.position,
        jersey: homeExact.jersey,
        rosterSource: 'ESPN Official Team Roster',
      };
    }

    if (awayExact && !homeExact) {
      return {
        verified: true,
        status: 'VERIFIED',
        athleteId: awayExact.id,
        playerDisplayName: awayExact.displayName,
        verifiedTeam: awayTeam,
        verifiedOpponent: homeTeam,
        position: awayExact.position,
        jersey: awayExact.jersey,
        rosterSource: 'ESPN Official Team Roster',
      };
    }

    // Check token-based matching (handles middle names or inverted formats)
    const homeTokenMatches = homeRoster.filter((a) =>
      this.isPlayerTokenMatch(targetNorm, a.normalizedName)
    );
    const awayTokenMatches = awayRoster.filter((a) =>
      this.isPlayerTokenMatch(targetNorm, a.normalizedName)
    );

    const totalTokenMatches = [...homeTokenMatches, ...awayTokenMatches];

    if (totalTokenMatches.length === 1) {
      const match = totalTokenMatches[0];
      const isHome = homeTokenMatches.length === 1;
      return {
        verified: true,
        status: 'VERIFIED',
        athleteId: match.id,
        playerDisplayName: match.displayName,
        verifiedTeam: isHome ? homeTeam : awayTeam,
        verifiedOpponent: isHome ? awayTeam : homeTeam,
        position: match.position,
        jersey: match.jersey,
        rosterSource: 'ESPN Official Team Roster',
      };
    }

    if (totalTokenMatches.length > 1) {
      return {
        verified: false,
        status: 'REJECTED',
        rejectionReason: 'AMBIGUOUS_NAME',
        rejectionDetail: `Player name "${rawPlayerName}" matches multiple athletes across event rosters (${totalTokenMatches
          .map((m) => m.displayName)
          .join(', ')})`,
        athleteId: null,
        playerDisplayName: rawPlayerName,
        verifiedTeam: '',
        verifiedOpponent: '',
        rosterSource: 'ESPN Official Team Roster',
      };
    }

    // Check if player surname only was provided and is ambiguous
    const homeLastNameMatches = homeRoster.filter((a) => a.normalizedLastName === targetLastName);
    const awayLastNameMatches = awayRoster.filter((a) => a.normalizedLastName === targetLastName);
    const totalLastNameMatches = [...homeLastNameMatches, ...awayLastNameMatches];

    if (totalLastNameMatches.length > 1) {
      return {
        verified: false,
        status: 'REJECTED',
        rejectionReason: 'AMBIGUOUS_NAME',
        rejectionDetail: `Surname "${targetLastName}" is ambiguous and matches multiple athletes on the event rosters`,
        athleteId: null,
        playerDisplayName: rawPlayerName,
        verifiedTeam: '',
        verifiedOpponent: '',
        rosterSource: 'ESPN Official Team Roster',
      };
    }

    // If rosters were populated but player is not found on either roster
    if (homeRoster.length > 0 || awayRoster.length > 0) {
      return {
        verified: false,
        status: 'REJECTED',
        rejectionReason: 'WRONG_TEAM',
        rejectionDetail: `Player "${rawPlayerName}" was not found on the active roster for either ${homeTeam} or ${awayTeam}`,
        athleteId: null,
        playerDisplayName: rawPlayerName,
        verifiedTeam: '',
        verifiedOpponent: '',
        rosterSource: 'ESPN Official Team Roster',
      };
    }

    // Fallback if rosters couldn't be retrieved: reject as UNKNOWN_PLAYER to fail closed
    return {
      verified: false,
      status: 'REJECTED',
      rejectionReason: 'UNKNOWN_PLAYER',
      rejectionDetail: `Unable to verify roster membership for "${rawPlayerName}" against event teams`,
      athleteId: null,
      playerDisplayName: rawPlayerName,
      verifiedTeam: '',
      verifiedOpponent: '',
      rosterSource: 'None',
    };
  }

  /**
   * Compares player tokens strictly (requires same first name initial or full first name + same last name).
   */
  private isPlayerTokenMatch(norm1: string, norm2: string): boolean {
    if (norm1 === norm2) return true;
    const parts1 = norm1.split(' ').filter(Boolean);
    const parts2 = norm2.split(' ').filter(Boolean);

    if (parts1.length < 2 || parts2.length < 2) return false;

    const last1 = parts1[parts1.length - 1];
    const last2 = parts2[parts2.length - 1];

    if (last1 !== last2) return false;

    const first1 = parts1[0];
    const first2 = parts2[0];

    // Same full first name OR matching initial with length >= 1
    if (first1 === first2) return true;
    if (first1.length === 1 || first2.length === 1) {
      return first1[0] === first2[0];
    }

    return false;
  }

  /**
   * Verifies an individual tennis participant against the event draw.
   */
  private verifyTennisParticipant(
    apexGame: NormalizedApexGame,
    rawPlayerName: string
  ): PlayerVerificationResult {
    const pAName = apexGame.playerAName || '';
    const pBName = apexGame.playerBName || '';

    const normTarget = this.normalizePlayerName(rawPlayerName);
    const normA = this.normalizePlayerName(pAName);
    const normB = this.normalizePlayerName(pBName);

    const matchA = this.isPlayerTokenMatch(normTarget, normA) || normTarget === normA;
    const matchB = this.isPlayerTokenMatch(normTarget, normB) || normTarget === normB;

    if (matchA && !matchB) {
      return {
        verified: true,
        status: 'VERIFIED',
        athleteId: apexGame.playerAId || null,
        playerDisplayName: pAName,
        verifiedTeam: pAName,
        verifiedOpponent: pBName,
        rosterSource: 'Tournament Draw Participant',
      };
    }

    if (matchB && !matchA) {
      return {
        verified: true,
        status: 'VERIFIED',
        athleteId: apexGame.playerBId || null,
        playerDisplayName: pBName,
        verifiedTeam: pBName,
        verifiedOpponent: pAName,
        rosterSource: 'Tournament Draw Participant',
      };
    }

    return {
      verified: false,
      status: 'REJECTED',
      rejectionReason: 'UNKNOWN_PLAYER',
      rejectionDetail: `Player "${rawPlayerName}" does not match either tournament draw participant (${pAName} vs ${pBName})`,
      athleteId: null,
      playerDisplayName: rawPlayerName,
      verifiedTeam: '',
      verifiedOpponent: '',
      rosterSource: 'Tournament Draw Participant',
    };
  }

  /**
   * Manually seeds a roster into cache (useful for deterministic negative tests).
   */
  public seedRoster(
    sport: ApexSport,
    teamId: string,
    teamName: string,
    athletes: VerifiedRosterAthlete[]
  ): void {
    const cacheKey = `ROSTER::${sport}::${teamId || teamName}`;
    this.rosterCache.set(cacheKey, { athletes, cachedAt: Date.now() });
  }
}

export const playerRosterService = new PlayerRosterService();
