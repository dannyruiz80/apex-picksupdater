import fs from 'fs';
import path from 'path';
import { MlbPitcherKStarterShadowForecast } from '../types';

const DEFAULT_FILE = path.resolve(process.cwd(), 'data', 'mlbPitcherKStarterShadow.json');

export class MlbPitcherKStarterShadowRepository {
  constructor(private readonly filePath = DEFAULT_FILE) {}

  private ensureFile() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, '[]\n', 'utf8');
  }

  getAll(): MlbPitcherKStarterShadowForecast[] {
    this.ensureFile();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  upsertMany(rows: MlbPitcherKStarterShadowForecast[]): { inserted: number; updated: number; total: number } {
    this.ensureFile();
    const existing = new Map(this.getAll().map((r) => [r.forecastId, r]));
    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      const previous = existing.get(row.forecastId);
      if (!previous) {
        inserted++;
        existing.set(row.forecastId, row);
        continue;
      }
      // First valid prospective forecast is immutable. Later capture refreshes cannot move the
      // as-of timestamp or rewrite the feature vector. Grading may append the verified result.
      if (row.gradingStatus === 'GRADED' && previous.gradingStatus === 'PENDING') {
        updated++;
        existing.set(row.forecastId, {
          ...previous,
          gradingStatus: 'GRADED',
          actualStrikeouts: row.actualStrikeouts,
          gradedAt: row.gradedAt,
          gradingSource: row.gradingSource,
          rejectionReason: null,
        });
      } else if (previous.gradingStatus === 'REJECTED' && row.gradingStatus === 'PENDING') {
        // An earlier attempt may have lacked enough verified workload history. The first later
        // eligible pregame forecast may replace that rejected attempt, after which it is frozen.
        updated++;
        existing.set(row.forecastId, row);
      }
    }
    const out = [...existing.values()].sort((a, b) => Date.parse(a.eventStartTime) - Date.parse(b.eventStartTime));
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.filePath);
    return { inserted, updated, total: out.length };
  }
}

export const mlbPitcherKStarterShadowRepository = new MlbPitcherKStarterShadowRepository();
