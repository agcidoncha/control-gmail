import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { closeMysqlPool, getMysqlPool, isMysqlEnabled } from './mysql.js';

if (!isMysqlEnabled()) {
  throw new Error('Define DATA_STORE=mysql antes de ejecutar la migración.');
}

const migrationFile = resolve('db/migrations/001_initial_mysql_schema.sql');
const sql = await readFile(migrationFile, 'utf8');
await getMysqlPool().query(sql);
await closeMysqlPool();
console.log('Migración MySQL aplicada:', migrationFile);
