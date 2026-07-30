import type { Photo, DuplicateGroup, CullingDecision, CullingItem } from '../types';
import { ALL_MIGRATIONS } from './schema';

export interface DbAdapter {
  execute(sql: string, params?: unknown[]): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

// Raw DB row types
interface PhotoRow {
  id: string;
  uri: string;
  filename: string;
  timestamp: number;
  width: number;
  height: number;
  file_size: number;
  is_screenshot: number;
  tags: string;
  album_id: string;
  quality_sharpness: number | null;
  quality_exposure: string | null;
  quality_noise: number | null;
  quality_has_face: number | null;
  quality_face_score: number | null;
  quality_composition_score: number | null;
  quality_timestamp: number | null;
}

interface DuplicateGroupRow {
  id: string;
  selected_photo_id: string;
  reason: string;
  status: string;
}

interface CullingDecisionRow {
  photo_id: string;
  decision: CullingDecision;
  ai_decision: CullingDecision;
  decided_at: number | null;
}

interface SettingRow {
  key: string;
  value: string;
  updated_at: number;
}

// --- Migration ---

export async function runMigrations(db: DbAdapter): Promise<void> {
  for (const migration of ALL_MIGRATIONS) {
    await db.execute(migration);
  }
}

// --- Photo Queries ---

function rowToPhoto(row: PhotoRow): Photo {
  const hasQuality =
    row.quality_sharpness !== null &&
    row.quality_exposure !== null &&
    row.quality_noise !== null;
  const quality = hasQuality
    ? {
        sharpness: row.quality_sharpness!,
        exposure: row.quality_exposure as 'normal' | 'overexposed' | 'underexposed',
        noise: row.quality_noise!,
        hasFace: row.quality_has_face === 1,
        faceScore: row.quality_face_score ?? 0,
        compositionScore: row.quality_composition_score ?? 0,
        timestamp: row.quality_timestamp ?? row.timestamp,
      }
    : undefined;

  return {
    id: row.id,
    uri: row.uri,
    filename: row.filename,
    timestamp: row.timestamp,
    width: row.width,
    height: row.height,
    fileSize: row.file_size,
    isScreenshot: row.is_screenshot === 1,
    tags: JSON.parse(row.tags) as string[],
    albumId: row.album_id,
    ...(quality ? { quality } : {}),
  };
}

export async function insertPhoto(db: DbAdapter, photo: Photo): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO photos (
      id, uri, filename, timestamp, width, height, file_size,
      is_screenshot, tags, album_id,
      quality_sharpness, quality_exposure, quality_noise,
      quality_has_face, quality_face_score, quality_composition_score, quality_timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      photo.id,
      photo.uri,
      photo.filename,
      photo.timestamp,
      photo.width,
      photo.height,
      photo.fileSize,
      photo.isScreenshot ? 1 : 0,
      JSON.stringify(photo.tags),
      photo.albumId,
      photo.quality?.sharpness ?? null,
      photo.quality?.exposure ?? null,
      photo.quality?.noise ?? null,
      photo.quality?.hasFace != null ? (photo.quality.hasFace ? 1 : 0) : null,
      photo.quality?.faceScore ?? null,
      photo.quality?.compositionScore ?? null,
      photo.quality?.timestamp ?? null,
    ],
  );
}

export async function getPhotoById(db: DbAdapter, id: string): Promise<Photo | null> {
  const row = await db.queryOne<PhotoRow>('SELECT * FROM photos WHERE id = ?', [id]);
  return row ? rowToPhoto(row) : null;
}

export async function getPhotosByAlbum(db: DbAdapter, albumId: string): Promise<Photo[]> {
  const rows = await db.query<PhotoRow>(
    'SELECT * FROM photos WHERE album_id = ? ORDER BY timestamp DESC',
    [albumId],
  );
  return rows.map(rowToPhoto);
}

export async function getScreenshots(db: DbAdapter): Promise<Photo[]> {
  const rows = await db.query<PhotoRow>(
    'SELECT * FROM photos WHERE is_screenshot = 1 ORDER BY timestamp DESC',
  );
  return rows.map(rowToPhoto);
}

export async function deletePhotoRecord(db: DbAdapter, photoId: string): Promise<void> {
  await db.execute('DELETE FROM photos WHERE id = ?', [photoId]);
}

export async function markPhotoAsScreenshot(
  db: DbAdapter,
  photoId: string,
  value: boolean,
): Promise<void> {
  await db.execute('UPDATE photos SET is_screenshot = ? WHERE id = ?', [
    value ? 1 : 0,
    photoId,
  ]);
}

// --- Duplicate Group Queries ---

export async function insertDuplicateGroup(
  db: DbAdapter,
  group: DuplicateGroup,
): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO duplicate_groups (id, selected_photo_id, reason, status)
     VALUES (?, ?, ?, 'pending')`,
    [group.id, group.selectedPhotoId, group.reason],
  );

  for (const photo of group.photos) {
    await db.execute(
      `INSERT OR IGNORE INTO duplicate_group_photos (group_id, photo_id) VALUES (?, ?)`,
      [group.id, photo.id],
    );
  }
}

export async function getDuplicateGroups(
  db: DbAdapter,
): Promise<Array<{ groupId: string; selectedPhotoId: string; reason: string; photoIds: string[] }>> {
  const groups = await db.query<DuplicateGroupRow>(
    `SELECT * FROM duplicate_groups WHERE status = 'pending' ORDER BY created_at DESC`,
  );

  const results = [];
  for (const group of groups) {
    const photoIdRows = await db.query<{ photo_id: string }>(
      'SELECT photo_id FROM duplicate_group_photos WHERE group_id = ?',
      [group.id],
    );
    results.push({
      groupId: group.id,
      selectedPhotoId: group.selected_photo_id,
      reason: group.reason,
      photoIds: photoIdRows.map((r) => r.photo_id),
    });
  }
  return results;
}

export async function resolveDuplicateGroup(
  db: DbAdapter,
  groupId: string,
): Promise<void> {
  await db.execute(
    `UPDATE duplicate_groups SET status = 'resolved', resolved_at = ? WHERE id = ?`,
    [Date.now(), groupId],
  );
}

// --- Culling Decision Queries ---

export async function upsertCullingDecision(
  db: DbAdapter,
  photoId: string,
  decision: CullingDecision,
  aiDecision: CullingDecision,
): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO culling_decisions (photo_id, decision, ai_decision, decided_at)
     VALUES (?, ?, ?, ?)`,
    [photoId, decision, aiDecision, decision !== 'pending' ? Date.now() : null],
  );
}

export async function getCullingItems(db: DbAdapter): Promise<CullingItem[]> {
  const rows = await db.query<CullingDecisionRow & PhotoRow>(
    `SELECT cd.*, p.* FROM culling_decisions cd
     JOIN photos p ON cd.photo_id = p.id
     WHERE cd.decision = 'pending'
     ORDER BY p.timestamp ASC`,
  );

  return rows.map((row) => ({
    photo: rowToPhoto(row),
    decision: row.decision,
    aiDecision: row.ai_decision,
  }));
}

// --- Settings Queries ---

export async function getSetting(
  db: DbAdapter,
  key: string,
): Promise<string | null> {
  const row = await db.queryOne<SettingRow>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(
  db: DbAdapter,
  key: string,
  value: string,
): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
    [key, value, Date.now()],
  );
}

export async function getAllSettings(db: DbAdapter): Promise<Record<string, string>> {
  const rows = await db.query<SettingRow>('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// --- Trash Queries ---

export async function moveToTrash(
  db: DbAdapter,
  photoId: string,
  originalUri: string,
  retentionDays: number,
): Promise<void> {
  const expiresAt = Date.now() + retentionDays * 24 * 60 * 60 * 1000;
  await db.execute(
    `INSERT OR REPLACE INTO trash (photo_id, original_uri, expires_at) VALUES (?, ?, ?)`,
    [photoId, originalUri, expiresAt],
  );
}

export async function getExpiredTrashItems(
  db: DbAdapter,
): Promise<Array<{ photoId: string; originalUri: string }>> {
  const rows = await db.query<{ photo_id: string; original_uri: string }>(
    'SELECT photo_id, original_uri FROM trash WHERE expires_at <= ?',
    [Date.now()],
  );
  return rows.map((r) => ({ photoId: r.photo_id, originalUri: r.original_uri }));
}

export async function emptyExpiredTrash(db: DbAdapter): Promise<void> {
  await db.execute('DELETE FROM trash WHERE expires_at <= ?', [Date.now()]);
}
