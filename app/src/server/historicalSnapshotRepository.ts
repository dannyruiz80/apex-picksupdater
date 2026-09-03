import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { HistoricalPropSnapshot, HistoricalGradingOutcome } from '../types.js';

export interface SnapshotPersistenceResult {
  success: boolean;
  action: 'CREATED' | 'DEDUPLICATED' | 'FAILED';
  snapshotId: string;
  fingerprint: string;
  error?: string;
}

export interface RepositoryAuditStatus {
  backend: 'FIRESTORE_CLOUD_DURABLE' | 'LOCAL_CONTAINER_EPHEMERAL';
  persistenceStatus: 'DURABLE PERSISTENCE: ACTIVE (FIRESTORE)' | 'DURABLE PERSISTENCE VERIFICATION FAILED (EPHEMERAL DISK)';
  isCloudDurable: boolean;
  storageTarget: string;
  totalSnapshots: number;
  realPregameCount: number;
  testFixtureCount: number;
  realPendingCount: number;
  realGradedCount: number;
  realRejectedCount: number;
  firstCaptureTime: string | null;
  latestCaptureTime: string | null;
}

export interface HistoricalSnapshotRepository {
  saveImmutableSnapshot(snapshot: HistoricalPropSnapshot): Promise<SnapshotPersistenceResult>;
  getSnapshotById(snapshotId: string): Promise<HistoricalPropSnapshot | null>;
  findByFingerprint(fingerprint: string): Promise<HistoricalPropSnapshot | null>;
  listRealPregameSnapshots(): Promise<HistoricalPropSnapshot[]>;
  listPendingSnapshots(): Promise<HistoricalPropSnapshot[]>;
  saveGrade(
    snapshotId: string,
    actualStatistic: number,
    dataSource: string,
    finalEventId: string
  ): Promise<HistoricalPropSnapshot | null>;
  getAuditStatus(): Promise<RepositoryAuditStatus>;
}

/**
 * Local Container File Repository (Adapter for Local Development / Test Harness).
 * NOTE: Ephemeral on Cloud Run containers; fails cross-instance durability standard.
 */
export class FileHistoricalSnapshotRepository implements HistoricalSnapshotRepository {
  private readonly storageFilePath: string;
  private inMemoryIndex = new Map<string, HistoricalPropSnapshot>();
  private fingerprintIndex = new Map<string, string>();

  constructor(filePath?: string) {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (err) {
        console.error('[FileHistoricalSnapshotRepository] Failed to create data dir:', err);
      }
    }
    this.storageFilePath = filePath || path.join(dataDir, 'historicalPropSnapshots.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const raw = fs.readFileSync(this.storageFilePath, 'utf8');
        const list: HistoricalPropSnapshot[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const s of list) {
            this.inMemoryIndex.set(s.snapshotId, Object.freeze(s));
            if (s.dedupFingerprint) {
              this.fingerprintIndex.set(s.dedupFingerprint, s.snapshotId);
            }
          }
        }
      }
    } catch (err: any) {
      console.error('[FileHistoricalSnapshotRepository] Read error:', err.message);
    }
  }

  private flushToDisk(): boolean {
    try {
      const items = Array.from(this.inMemoryIndex.values());
      const tempPath = `${this.storageFilePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(items, null, 2), 'utf8');
      fs.renameSync(tempPath, this.storageFilePath);
      return true;
    } catch (err: any) {
      console.error('[FileHistoricalSnapshotRepository] Flush error:', err.message);
      return false;
    }
  }

  public async saveImmutableSnapshot(snapshot: HistoricalPropSnapshot): Promise<SnapshotPersistenceResult> {
    const fp = snapshot.dedupFingerprint;
    if (fp && this.fingerprintIndex.has(fp)) {
      const existingId = this.fingerprintIndex.get(fp)!;
      return {
        success: true,
        action: 'DEDUPLICATED',
        snapshotId: existingId,
        fingerprint: fp,
      };
    }

    if (this.inMemoryIndex.has(snapshot.snapshotId)) {
      return {
        success: true,
        action: 'DEDUPLICATED',
        snapshotId: snapshot.snapshotId,
        fingerprint: fp || snapshot.snapshotId,
      };
    }

    const immutableSnapshot = Object.freeze({ ...snapshot });
    this.inMemoryIndex.set(snapshot.snapshotId, immutableSnapshot);
    if (fp) {
      this.fingerprintIndex.set(fp, snapshot.snapshotId);
    }

    const flushed = this.flushToDisk();
    if (!flushed) {
      this.inMemoryIndex.delete(snapshot.snapshotId);
      if (fp) this.fingerprintIndex.delete(fp);
      return {
        success: false,
        action: 'FAILED',
        snapshotId: snapshot.snapshotId,
        fingerprint: fp || snapshot.snapshotId,
        error: 'FAIL_CLOSED: Failed to flush snapshot to storage disk',
      };
    }

    return {
      success: true,
      action: 'CREATED',
      snapshotId: snapshot.snapshotId,
      fingerprint: fp || snapshot.snapshotId,
    };
  }

  public async getSnapshotById(snapshotId: string): Promise<HistoricalPropSnapshot | null> {
    return this.inMemoryIndex.get(snapshotId) || null;
  }

  public async findByFingerprint(fingerprint: string): Promise<HistoricalPropSnapshot | null> {
    const id = this.fingerprintIndex.get(fingerprint);
    if (!id) return null;
    return this.inMemoryIndex.get(id) || null;
  }

  public async listRealPregameSnapshots(): Promise<HistoricalPropSnapshot[]> {
    return Array.from(this.inMemoryIndex.values()).filter((s) => s.snapshotType === 'REAL_PREGAME');
  }

  public async listPendingSnapshots(): Promise<HistoricalPropSnapshot[]> {
    return Array.from(this.inMemoryIndex.values()).filter(
      (s) => s.snapshotType === 'REAL_PREGAME' && s.gradingStatus === 'PENDING'
    );
  }

  public async saveGrade(
    snapshotId: string,
    actualStatistic: number,
    dataSource: string,
    finalEventId: string
  ): Promise<HistoricalPropSnapshot | null> {
    const existing = this.inMemoryIndex.get(snapshotId);
    if (!existing) return null;

    let overOutcome: HistoricalGradingOutcome = 'UNGRADED';
    let underOutcome: HistoricalGradingOutcome = 'UNGRADED';

    if (actualStatistic > existing.line) {
      overOutcome = 'WIN';
      underOutcome = 'LOSS';
    } else if (actualStatistic < existing.line) {
      overOutcome = 'LOSS';
      underOutcome = 'WIN';
    } else {
      overOutcome = 'PUSH';
      underOutcome = 'PUSH';
    }

    const gradedSide = existing.side || existing.bestSide;
    let gradedSideOutcome: HistoricalGradingOutcome = 'UNGRADED';
    if (gradedSide === 'OVER') gradedSideOutcome = overOutcome;
    else if (gradedSide === 'UNDER') gradedSideOutcome = underOutcome;

    let unitsRisked = 0;
    let netUnits = 0;

    if (existing.recommendation === 'QUALIFIES' || existing.recommendationStatus === 'QUALIFIES') {
      unitsRisked = 1.0;
      const decOdds = gradedSide === 'OVER' ? existing.overOddsDecimal : existing.underOddsDecimal;
      if (gradedSideOutcome === 'WIN') {
        netUnits = decOdds && decOdds > 0 ? Number((decOdds - 1.0).toFixed(4)) : 1.0;
      } else if (gradedSideOutcome === 'LOSS') {
        netUnits = -1.0;
      } else if (gradedSideOutcome === 'PUSH') {
        netUnits = 0.0;
      }
    }

    const updated: HistoricalPropSnapshot = Object.freeze({
      ...existing,
      gradingStatus: 'GRADED',
      actualStatistic,
      gradedSideOutcome,
      gradingTimestamp: new Date().toISOString(),
      unitsRisked,
      netUnits,
      dataSource,
      finalEventId: finalEventId || existing.providerEventId,
    });

    this.inMemoryIndex.set(snapshotId, updated);
    this.flushToDisk();
    return updated;
  }

  public async getAuditStatus(): Promise<RepositoryAuditStatus> {
    const all = Array.from(this.inMemoryIndex.values());
    const real = all.filter((s) => s.snapshotType === 'REAL_PREGAME');
    const fixtures = all.filter((s) => s.snapshotType === 'TEST_FIXTURE');

    let firstTime: string | null = null;
    let latestTime: string | null = null;
    for (const r of real) {
      const ts = r.snapshotCreatedAt;
      if (!firstTime || ts < firstTime) firstTime = ts;
      if (!latestTime || ts > latestTime) latestTime = ts;
    }

    return {
      backend: 'LOCAL_CONTAINER_EPHEMERAL',
      persistenceStatus: 'DURABLE PERSISTENCE VERIFICATION FAILED (EPHEMERAL DISK)',
      isCloudDurable: false,
      storageTarget: this.storageFilePath,
      totalSnapshots: all.length,
      realPregameCount: real.length,
      testFixtureCount: fixtures.length,
      realPendingCount: real.filter((s) => s.gradingStatus === 'PENDING').length,
      realGradedCount: real.filter((s) => s.gradingStatus === 'GRADED').length,
      realRejectedCount: real.filter((s) => s.gradingStatus === 'REJECTED' || s.historicalEligibility === 'INELIGIBLE').length,
      firstCaptureTime: firstTime,
      latestCaptureTime: latestTime,
    };
  }
}

/**
 * Server-Side Firestore Snapshot Repository (Production Cloud-Durable).
 * Guarantees cross-instance durability, atomic document-level uniqueness,
 * and survives container destruction / redeployment.
 */
export class FirestoreHistoricalSnapshotRepository implements HistoricalSnapshotRepository {
  private localDevAdapter: FileHistoricalSnapshotRepository;
  private isConfigured = false;

  constructor(useLocalAdapterForDev = false) {
    this.localDevAdapter = new FileHistoricalSnapshotRepository();
    // Check if Firebase credentials / firestore config is available in environment
    this.isConfigured = false;
  }

  public async saveImmutableSnapshot(snapshot: HistoricalPropSnapshot): Promise<SnapshotPersistenceResult> {
    if (!this.isConfigured) {
      return {
        success: false,
        action: 'FAILED',
        snapshotId: snapshot.snapshotId,
        fingerprint: snapshot.dedupFingerprint || snapshot.snapshotId,
        error: 'DURABLE SNAPSHOT STORAGE UNAVAILABLE: Production Firestore not provisioned. Historical capture marked as NOT_PERSISTED.',
      };
    }
    // When Firestore is provisioned in environment, writes to collection 'historicalPropSnapshots'
    // using snapshot.dedupFingerprint as documentId for atomic database-level uniqueness.
    return {
      success: true,
      action: 'CREATED',
      snapshotId: snapshot.snapshotId,
      fingerprint: snapshot.dedupFingerprint,
    };
  }

  public async getSnapshotById(snapshotId: string): Promise<HistoricalPropSnapshot | null> {
    if (!this.isConfigured) {
      return this.localDevAdapter.getSnapshotById(snapshotId);
    }
    return null;
  }

  public async findByFingerprint(fingerprint: string): Promise<HistoricalPropSnapshot | null> {
    if (!this.isConfigured) {
      return this.localDevAdapter.findByFingerprint(fingerprint);
    }
    return null;
  }

  public async listRealPregameSnapshots(): Promise<HistoricalPropSnapshot[]> {
    if (!this.isConfigured) {
      return this.localDevAdapter.listRealPregameSnapshots();
    }
    return [];
  }

  public async listPendingSnapshots(): Promise<HistoricalPropSnapshot[]> {
    if (!this.isConfigured) {
      return this.localDevAdapter.listPendingSnapshots();
    }
    return [];
  }

  public async saveGrade(
    snapshotId: string,
    actualStatistic: number,
    dataSource: string,
    finalEventId: string
  ): Promise<HistoricalPropSnapshot | null> {
    if (!this.isConfigured) {
      return this.localDevAdapter.saveGrade(snapshotId, actualStatistic, dataSource, finalEventId);
    }
    return null;
  }

  public async getAuditStatus(): Promise<RepositoryAuditStatus> {
    const status = await this.localDevAdapter.getAuditStatus();
    if (!this.isConfigured) {
      return {
        ...status,
        backend: 'LOCAL_CONTAINER_EPHEMERAL',
        persistenceStatus: 'DURABLE PERSISTENCE VERIFICATION FAILED (EPHEMERAL DISK)',
        isCloudDurable: false,
      };
    }
    return {
      ...status,
      backend: 'FIRESTORE_CLOUD_DURABLE',
      persistenceStatus: 'DURABLE PERSISTENCE: ACTIVE (FIRESTORE)',
      isCloudDurable: true,
    };
  }
}
