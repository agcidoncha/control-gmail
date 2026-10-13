import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { closeMysqlPool, getMysqlPool, isMysqlEnabled } from './mysql.js';

if (!isMysqlEnabled()) {
  throw new Error('Define DATA_STORE=mysql antes de ejecutar la migración.');
}

const migrationDirectory = resolve('db/migrations');
const migrationFiles = (await readdir(migrationDirectory))
  .filter((file) => /^\d+_.+\.sql$/.test(file))
  .sort();
for (const file of migrationFiles) {
  const migrationFile = resolve(migrationDirectory, file);
  const sql = await readFile(migrationFile, 'utf8');
  await getMysqlPool().query(sql);
  console.log('Migración MySQL aplicada:', migrationFile);
}
await closeMysqlPool();
