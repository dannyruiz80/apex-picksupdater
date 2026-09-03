import fs from 'fs';
import path from 'path';
import { MlbPitcherKHistoricalReplayRow } from '../types';

const DEFAULT_FILE = path.resolve(process.cwd(), 'data', 'mlbPitcherKHistoricalReplay.json');

export class MlbPitcherKHistoricalReplayRepository {
  constructor(private readonly filePath = DEFAULT_FILE) {}

  private ensureFile() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, '[]\n', 'utf8');
  }

  getAll(): MlbPitcherKHistoricalReplayRow[] {
    this.ensureFile();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  upsertMany(rows: MlbPitcherKHistoricalReplayRow[]): { inserted: number; updated: number; total: number } {
    this.ensureFile();
    const existing = new Map(this.getAll().map((r) => [r.replayId, r]));
    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      if (existing.has(row.replayId)) updated++;
      else inserted++;
      existing.set(row.replayId, row);
    }
    const out = [...existing.values()].sort((a, b) => Date.parse(a.eventStartTime) - Date.parse(b.eventStartTime));
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.filePath);
    return { inserted, updated, total: out.length };
  }
}

export const mlbPitcherKHistoricalReplayRepository = new MlbPitcherKHistoricalReplayRepository();
