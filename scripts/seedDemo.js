'use strict';

require('dotenv').config();
const { connectDB, closeDB } = require('../config/database');
const { seedDemoIfEmpty, waitForProcessing } = require('../services/demoSeedService');

async function main() {
  connectDB();
  const ids = await seedDemoIfEmpty();
  if (!ids.length) {
    console.log('Demo library already exists; no videos were added.');
    return;
  }
  const states = await waitForProcessing(ids);
  console.log(`Demo processing finished: ${states.filter((state) => state === 'ready').length} ready, ${states.filter((state) => state === 'failed').length} failed.`);
  if (states.some((state) => state !== 'ready')) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[seed] ${error.message}`);
  process.exitCode = 1;
}).finally(closeDB);
