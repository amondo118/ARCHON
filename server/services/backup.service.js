import fs from 'node:fs';
import path from 'node:path';

/** Consistent SQLite snapshots (safe with WAL) using the online backup API. */
export function backupService(db, config) {
  return {
    async create() {
      fs.mkdirSync(config.backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = path.join(config.backupDir, `archon-${stamp}.db`);
      await db.backup(file);
      return file;
    },
  };
}
