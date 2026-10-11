import mysql, { type Pool } from 'mysql2/promise';

let pool: Pool | undefined;

export function isMysqlEnabled() {
  return (process.env.DATA_STORE ?? 'local').toLowerCase() === 'mysql';
}

export function getMysqlPool() {
  if (!isMysqlEnabled()) throw new Error('MySQL no está habilitado. Usa DATA_STORE=mysql.');
  if (!pool) {
    const host = process.env.MYSQL_HOST;
    const database = process.env.MYSQL_DATABASE;
    const user = process.env.MYSQL_USER;
    const password = process.env.MYSQL_PASSWORD;
    if (!host || !database || !user) {
      throw new Error('Faltan MYSQL_HOST, MYSQL_DATABASE o MYSQL_USER.');
    }
    pool = mysql.createPool({
      host,
      port: Number.parseInt(process.env.MYSQL_PORT ?? '3306', 10),
      database,
      user,
      password,
      waitForConnections: true,
      connectionLimit: Number.parseInt(process.env.MYSQL_CONNECTION_LIMIT ?? '10', 10),
      multipleStatements: true,
      ssl: parseMysqlSsl(),
      timezone: 'Z',
      dateStrings: true,
    });
  }
  return pool;
}

export async function closeMysqlPool() {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}

function parseMysqlSsl() {
  return /^(1|true|yes)$/i.test(process.env.MYSQL_SSL ?? '')
    ? { rejectUnauthorized: false }
    : undefined;
}
