const { restoreBackup } = require('./portable-backup');

async function main() {
  const inputFile = process.argv[2] || process.env.ANSWERTRAVEL_BACKUP_FILE;
  if (!inputFile) throw new Error('请提供备份文件路径。');
  if (!process.env.DATABASE_URL) throw new Error('请设置目标 DATABASE_URL。');
  const overwrite = process.env.ANSWERTRAVEL_RESTORE_OVERWRITE === 'true';
  const result = await restoreBackup(process.env.DATABASE_URL, inputFile, { overwrite });
  console.log(`AnswerTravel 备份恢复完成：${result.source}`);
  console.log(`brands=${result.snapshot.brands.length}, prompts=${result.snapshot.prompts.length}, records=${result.snapshot.records.length}, members=${result.snapshot.members.length}`);
}

main().catch((error) => {
  console.error(`[answertravel-restore] ${error.message}`);
  process.exit(1);
});
