export const CREATE_PHOTOS_TABLE = `
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY NOT NULL,
  uri TEXT NOT NULL,
  filename TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  file_size INTEGER NOT NULL,
  is_screenshot INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  album_id TEXT NOT NULL DEFAULT '',
  quality_sharpness REAL,
  quality_exposure TEXT,
  quality_noise REAL,
  quality_has_face INTEGER,
  quality_face_score REAL,
  quality_composition_score REAL,
  quality_timestamp INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
`;

export const CREATE_DUPLICATE_GROUPS_TABLE = `
CREATE TABLE IF NOT EXISTS duplicate_groups (
  id TEXT PRIMARY KEY NOT NULL,
  selected_photo_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  resolved_at INTEGER
);
`;

export const CREATE_DUPLICATE_GROUP_PHOTOS_TABLE = `
CREATE TABLE IF NOT EXISTS duplicate_group_photos (
  group_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  PRIMARY KEY (group_id, photo_id),
  FOREIGN KEY (group_id) REFERENCES duplicate_groups(id),
  FOREIGN KEY (photo_id) REFERENCES photos(id)
);
`;

export const CREATE_CULLING_DECISIONS_TABLE = `
CREATE TABLE IF NOT EXISTS culling_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id TEXT NOT NULL UNIQUE,
  decision TEXT NOT NULL CHECK (decision IN ('keep', 'delete', 'pending')),
  ai_decision TEXT NOT NULL CHECK (ai_decision IN ('keep', 'delete', 'pending')),
  decided_at INTEGER,
  FOREIGN KEY (photo_id) REFERENCES photos(id)
);
`;

export const CREATE_SCREENSHOT_RESULTS_TABLE = `
CREATE TABLE IF NOT EXISTS screenshot_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id TEXT NOT NULL,
  screenshot_type TEXT NOT NULL,
  suggested_action TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  instruction TEXT,
  result_text TEXT,
  output_destination TEXT,
  processed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (photo_id) REFERENCES photos(id)
);
`;

export const CREATE_SETTINGS_TABLE = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
`;

export const CREATE_TRASH_TABLE = `
CREATE TABLE IF NOT EXISTS trash (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id TEXT NOT NULL,
  original_uri TEXT NOT NULL,
  deleted_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (photo_id) REFERENCES photos(id)
);
`;

export const CREATE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_photos_album_id ON photos(album_id);`,
  `CREATE INDEX IF NOT EXISTS idx_photos_timestamp ON photos(timestamp);`,
  `CREATE INDEX IF NOT EXISTS idx_photos_is_screenshot ON photos(is_screenshot);`,
  `CREATE INDEX IF NOT EXISTS idx_culling_decisions_photo_id ON culling_decisions(photo_id);`,
  `CREATE INDEX IF NOT EXISTS idx_screenshot_results_photo_id ON screenshot_results(photo_id);`,
  `CREATE INDEX IF NOT EXISTS idx_trash_expires_at ON trash(expires_at);`,
];

export const ALL_MIGRATIONS = [
  CREATE_PHOTOS_TABLE,
  CREATE_DUPLICATE_GROUPS_TABLE,
  CREATE_DUPLICATE_GROUP_PHOTOS_TABLE,
  CREATE_CULLING_DECISIONS_TABLE,
  CREATE_SCREENSHOT_RESULTS_TABLE,
  CREATE_SETTINGS_TABLE,
  CREATE_TRASH_TABLE,
  ...CREATE_INDEXES,
];
