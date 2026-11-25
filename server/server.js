import { config } from './config/config.js';
import { openDatabase } from './database/database.js';
import { createApp } from './app.js';

let db;
try {
  db = openDatabase(config.databasePath);
} catch (e) {
  console.error(`ARCHON: cannot open database at ${config.databasePath}: ${e.message}`);
  process.exit(1);
}

const { app } = createApp(db, config);
const server = app.listen(config.port, () => {
  console.log(`ARCHON listening on http://localhost:${config.port} (db: ${config.databasePath})`);
});

const shutdown = (signal) => {
  console.log(`${signal} received, shutting down.`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
