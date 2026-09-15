const major = Number.parseInt(process.versions.node.split('.')[0], 10);

if (major !== 24) {
  const message = `AnswerTravel V2 targets Node.js 24.x LTS; current runtime is ${process.version}.`;
  if (process.env.CI === 'true' || process.argv.includes('--strict')) {
    console.error(message);
    process.exit(1);
  }
  console.warn(`${message} Local checks are provisional until Node.js 24 CI passes.`);
}
