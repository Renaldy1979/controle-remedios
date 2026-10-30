// Configuração por variáveis de ambiente. Nunca imprime valores: só os NOMES do que falta.

const need = (env, names) => names.filter((n) => !env[n] || !String(env[n]).trim());

export function loadConfig(env = process.env) {
  const storage = (env.BACKUP_STORAGE || "s3").toLowerCase();
  const missing = need(env, ["DATABASE_URL_BACKUP", "BACKUP_ENCRYPTION_KEY"]);
  if (storage === "s3") missing.push(...need(env, ["BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"]));
  else if (storage === "local") missing.push(...need(env, ["BACKUP_LOCAL_DIR"]));
  else throw new Error("BACKUP_STORAGE deve ser s3 ou local.");
  if (missing.length) throw new Error(`Faltam variáveis de ambiente: ${missing.join(", ")}.`);

  const at = env.BACKUP_AT || "03:00";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) throw new Error("BACKUP_AT deve estar no formato HH:mm (24h), por exemplo 03:00.");
  const days = Number(env.BACKUP_RETENTION_DAYS || 30);
  if (!Number.isInteger(days) || days < 7) throw new Error("BACKUP_RETENTION_DAYS deve ser um número inteiro de pelo menos 7.");

  const appwrite = ["APPWRITE_ENDPOINT", "APPWRITE_PROJECT_ID", "APPWRITE_API_KEY", "APPWRITE_PRESCRIPTIONS_BUCKET_ID"].every((n) => env[n] && env[n].trim())
    ? { endpoint: env.APPWRITE_ENDPOINT, projectId: env.APPWRITE_PROJECT_ID, apiKey: env.APPWRITE_API_KEY, bucketId: env.APPWRITE_PRESCRIPTIONS_BUCKET_ID }
    : null;

  return {
    databaseUrl: env.DATABASE_URL_BACKUP,
    passphrase: env.BACKUP_ENCRYPTION_KEY,
    storage: storage === "s3"
      ? { kind: "s3", endpoint: env.BACKUP_S3_ENDPOINT, bucket: env.BACKUP_S3_BUCKET, accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY }
      : { kind: "local", dir: env.BACKUP_LOCAL_DIR },
    appwrite,
    at,
    tz: env.BACKUP_TZ || "America/Sao_Paulo",
    retentionDays: days,
    pingUrl: env.BACKUP_HEALTHCHECK_URL || null,
    pgDumpBin: env.PG_DUMP_BIN || "pg_dump",
    pgRestoreBin: env.PG_RESTORE_BIN || "pg_restore",
  };
}
