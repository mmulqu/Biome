#!/usr/bin/env node
/**
 * Resumable biome data uploader for large files (like res7 with 88M records)
 *
 * Features:
 * - Tracks progress in a local file
 * - Can resume from where it left off
 * - Retries failed batches
 * - Shows ETA and progress stats
 *
 * Usage:
 *   node upload_biomes_resumable.js <jsonl_file> <resolution> [api_base_url]
 *
 * Example:
 *   node upload_biomes_resumable.js ./landcover_export/landcover_res7.jsonl 7 https://biome.riverrun.quest/api
 *
 * To reset progress and start over:
 *   rm ./landcover_export/landcover_res7.jsonl.progress
 */

import fs from 'fs';
import readline from 'readline';
import https from 'https';
import http from 'http';
import path from 'path';

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('Usage: node upload_biomes_resumable.js <jsonl_file> <resolution> [api_base_url]');
  console.log('\nExample:');
  console.log('  node upload_biomes_resumable.js ./landcover_export/landcover_res7.jsonl 7 https://biome.riverrun.quest/api');
  console.log('\nTo reset and start over, delete the .progress file');
  process.exit(1);
}

const inputFile = args[0];
const resolution = parseInt(args[1]);
const apiBase = args[2] || 'https://biome.riverrun.quest/api';
const progressFile = `${inputFile}.progress`;

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

if (isNaN(resolution) || resolution < 0 || resolution > 15) {
  console.error('Error: Resolution must be a number between 0 and 15');
  process.exit(1);
}

const BATCH_SIZE = 500;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// Progress tracking
function loadProgress() {
  try {
    if (fs.existsSync(progressFile)) {
      const data = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
      return data;
    }
  } catch (e) {
    console.warn('Could not load progress file, starting fresh');
  }
  return {
    completedBatches: 0,
    totalImported: 0,
    totalErrors: 0,
    startTime: Date.now(),
    lastUpdateTime: Date.now()
  };
}

function saveProgress(progress) {
  progress.lastUpdateTime = Date.now();
  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
}

// Format time duration
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

// Make HTTP request with retries
async function apiRequest(url, data, retries = MAX_RETRIES) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? https : http;

    const postData = JSON.stringify(data);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 30000
    };

    const req = lib.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', async (err) => {
      if (retries > 0) {
        console.log(`  Retry in ${RETRY_DELAY_MS/1000}s... (${retries} left)`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        resolve(apiRequest(url, data, retries - 1));
      } else {
        reject(err);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      if (retries > 0) {
        console.log(`  Timeout, retry in ${RETRY_DELAY_MS/1000}s... (${retries} left)`);
        setTimeout(() => {
          resolve(apiRequest(url, data, retries - 1));
        }, RETRY_DELAY_MS);
      } else {
        reject(new Error('Request timeout'));
      }
    });

    req.write(postData);
    req.end();
  });
}

// Count lines in file (for progress estimation)
async function countLines(filePath) {
  return new Promise((resolve) => {
    let count = 0;
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity
    });
    rl.on('line', () => count++);
    rl.on('close', () => resolve(count));
  });
}

// Process file in batches
async function processFile(progress) {
  const fileStream = fs.createReadStream(inputFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let batch = [];
  let batchNum = 0;
  let lineNum = 0;
  const skipBatches = progress.completedBatches;

  console.log(`\nProcessing ${inputFile}...`);
  if (skipBatches > 0) {
    console.log(`Resuming from batch ${skipBatches + 1} (skipping ${skipBatches * BATCH_SIZE} records)`);
  }

  for await (const line of rl) {
    if (!line.trim()) continue;

    lineNum++;

    try {
      batch.push(JSON.parse(line));
    } catch (e) {
      continue;
    }

    if (batch.length >= BATCH_SIZE) {
      batchNum++;

      // Skip already completed batches
      if (batchNum <= skipBatches) {
        batch = [];
        continue;
      }

      await uploadBatch(batch, batchNum, progress);
      batch = [];

      // Save progress every 10 batches
      if (batchNum % 10 === 0) {
        saveProgress(progress);
      }
    }
  }

  // Upload remaining records
  if (batch.length > 0) {
    batchNum++;
    if (batchNum > skipBatches) {
      await uploadBatch(batch, batchNum, progress);
    }
  }

  saveProgress(progress);
  return progress;
}

async function uploadBatch(batch, batchNum, progress) {
  const startTime = Date.now();

  process.stdout.write(`Batch ${batchNum}: uploading ${batch.length} records... `);

  try {
    const result = await apiRequest(`${apiBase}/biomes/import`, {
      biomes: batch,
      resolution: resolution
    });

    if (result.status === 200 && result.data) {
      const imported = result.data.imported || 0;
      const errors = result.data.errors || 0;
      progress.totalImported += imported;
      progress.totalErrors += errors;
      progress.completedBatches = batchNum;

      const elapsed = Date.now() - progress.startTime;
      const rate = progress.totalImported / (elapsed / 1000);

      console.log(`OK (${imported} imported, ${errors} errors) [${rate.toFixed(0)}/sec]`);
    } else {
      console.log(`ERROR: ${JSON.stringify(result.data)}`);
      progress.totalErrors += batch.length;
      progress.completedBatches = batchNum;
    }
  } catch (e) {
    console.log(`FAILED: ${e.message}`);
    progress.totalErrors += batch.length;
    progress.completedBatches = batchNum;
  }

  // Small delay between batches
  await new Promise(r => setTimeout(r, 50));
}

// Main
async function main() {
  console.log('='.repeat(60));
  console.log('Resumable Biome Data Uploader');
  console.log('='.repeat(60));
  console.log(`Input file: ${inputFile}`);
  console.log(`Resolution: ${resolution}`);
  console.log(`API base: ${apiBase}`);
  console.log(`Progress file: ${progressFile}`);

  // Load existing progress
  const progress = loadProgress();

  if (progress.completedBatches > 0) {
    console.log(`\nResuming from previous run:`);
    console.log(`  Completed batches: ${progress.completedBatches}`);
    console.log(`  Total imported: ${progress.totalImported}`);
    console.log(`  Total errors: ${progress.totalErrors}`);
  }

  // Count total lines for estimation
  console.log('\nCounting records...');
  const totalLines = await countLines(inputFile);
  const totalBatches = Math.ceil(totalLines / BATCH_SIZE);
  const remainingBatches = totalBatches - progress.completedBatches;

  console.log(`Total records: ${totalLines.toLocaleString()}`);
  console.log(`Total batches: ${totalBatches}`);
  console.log(`Remaining batches: ${remainingBatches}`);

  if (remainingBatches <= 0) {
    console.log('\nAll batches already completed! Delete progress file to re-upload.');
    return;
  }

  // Estimate time
  const estimatedSeconds = remainingBatches * 0.3; // ~0.3s per batch
  console.log(`Estimated time: ${formatDuration(estimatedSeconds * 1000)}`);

  // Reset start time if resuming
  if (progress.completedBatches === 0) {
    progress.startTime = Date.now();
  }

  console.log('\nStarting upload...\n');

  // Process the file
  const finalProgress = await processFile(progress);

  // Final summary
  const totalTime = Date.now() - finalProgress.startTime;

  console.log('\n' + '='.repeat(60));
  console.log('Upload Complete!');
  console.log('='.repeat(60));
  console.log(`  Total imported: ${finalProgress.totalImported.toLocaleString()}`);
  console.log(`  Total errors: ${finalProgress.totalErrors.toLocaleString()}`);
  console.log(`  Success rate: ${((finalProgress.totalImported / (finalProgress.totalImported + finalProgress.totalErrors)) * 100).toFixed(1)}%`);
  console.log(`  Total time: ${formatDuration(totalTime)}`);
  console.log(`  Average rate: ${(finalProgress.totalImported / (totalTime / 1000)).toFixed(0)} records/sec`);

  // Clean up progress file on successful completion
  if (finalProgress.totalErrors === 0) {
    console.log('\nCleaning up progress file...');
    fs.unlinkSync(progressFile);
  } else {
    console.log(`\nProgress saved to ${progressFile}`);
    console.log('Run again to retry failed batches.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
