const path = require('path');
const { DEFAULT_LOCAL_POSTGRES, databaseUrl } = require('./local-postgres');
const { exportBackup } = require('./portable-backup');

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = process.env.ANSWERTRAVEL_BACKUP_FILE || path.join(__dirname, '.local', 'backups', `answertravel-${timestamp}.json`);
  const connectionString = process.env.DATABASE_URL || databaseUrl(DEFAULT_LOCAL_POSTGRES);
  const result = await exportBackup(connectionString, output);
  const snapshot = result.backup.snapshot;
  console.log(`AnswerTravel 备份已创建：${result.target}`);
  console.log(`brands=${snapshot.brands.length}, prompts=${snapshot.prompts.length}, records=${snapshot.records.length}, members=${snapshot.members.length}`);
}

main().catch((error) => {
  console.error(`[answertravel-backup] ${error.message}`);
  process.exit(1);
});
