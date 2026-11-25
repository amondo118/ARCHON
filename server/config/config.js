import path from 'node:path';

const env = process.env;

export const config = Object.freeze({
  env: env.NODE_ENV || 'development',
  port: Number(env.PORT) || 3000,
  databasePath: path.resolve(env.DATABASE_PATH || './data/archon.db'),
  backupDir: path.resolve(env.BACKUP_DIR || path.join(path.dirname(env.DATABASE_PATH || './data/archon.db'), 'backups')),
  importLimit: env.IMPORT_LIMIT || '10mb',
});
