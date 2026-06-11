import * as dotenv from 'dotenv';
import { createApp } from './http/app';
import { db } from './db/knex';

dotenv.config();

const port = Number(process.env.PORT || 3000);
const app = createApp();

const server = app.listen(port, () => {
  console.log(`LeozOps CRM API listening on http://localhost:${port}`);
});

// Graceful shutdown so the DB pool closes cleanly.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.destroy().finally(() => process.exit(0));
    });
  });
}
