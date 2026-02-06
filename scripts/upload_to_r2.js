#!/usr/bin/env node
/**
 * Upload chunked biome files to Cloudflare R2.
 *
 * Usage: node scripts/upload_to_r2.js <chunks_dir> [--dry-run]
 *
 * Example: node scripts/upload_to_r2.js ./r2_chunks
 *
 * Prerequisites:
 *   1. Create the R2 bucket first:
 *      npx wrangler r2 bucket create biome-tiles
 *
 *   2. Run the chunking script first:
 *      node scripts/chunk_biomes_for_r2.js ./landcover_export/landcover_res7.jsonl ./r2_chunks
 *
 * This script uploads all .json.gz files to R2 under the res7/ prefix.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const chunksDir = args.find(a => !a.startsWith('--'));

if (!chunksDir) {
  console.error('Usage: node upload_to_r2.js <chunks_dir> [--dry-run]');
  console.error('Example: node upload_to_r2.js ./r2_chunks');
  process.exit(1);
}

const BUCKET_NAME = 'biome-tiles';
const R2_PREFIX = 'res7';

// Get all .json.gz files
const files = readdirSync(chunksDir).filter(f => f.endsWith('.json.gz'));

if (files.length === 0) {
  console.error(`No .json.gz files found in ${chunksDir}`);
  console.error('Run the chunking script first:');
  console.error('  node scripts/chunk_biomes_for_r2.js ./landcover_export/landcover_res7.jsonl ./r2_chunks');
  process.exit(1);
}

console.log(`Found ${files.length} chunk files to upload`);
console.log(`Bucket: ${BUCKET_NAME}`);
console.log(`Prefix: ${R2_PREFIX}/`);
console.log('');

if (dryRun) {
  console.log('=== DRY RUN MODE ===');
  console.log('');
}

// Calculate total size
let totalSize = 0;
for (const file of files) {
  const stat = statSync(join(chunksDir, file));
  totalSize += stat.size;
}
console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
console.log('');

// Track progress
let uploaded = 0;
let failed = 0;
let skipped = 0;
const startTime = Date.now();

// Progress file for resumability
const progressFile = join(chunksDir, '.upload_progress');
let completedFiles = new Set();

try {
  const progressData = readFileSync(progressFile, 'utf8');
  completedFiles = new Set(progressData.trim().split('\n').filter(Boolean));
  console.log(`Resuming: ${completedFiles.size} files already uploaded`);
} catch {
  // No progress file, start fresh
}

const { appendFileSync } = await import('fs');

for (const file of files) {
  if (completedFiles.has(file)) {
    skipped++;
    continue;
  }

  const localPath = join(chunksDir, file);
  const r2Key = `${R2_PREFIX}/${file}`;

  if (dryRun) {
    console.log(`Would upload: ${file} -> ${r2Key}`);
    uploaded++;
    continue;
  }

  try {
    // Use wrangler to upload
    const cmd = `npx wrangler r2 object put "${BUCKET_NAME}/${r2Key}" --file="${localPath}" --content-type="application/gzip"`;
    execSync(cmd, { stdio: 'pipe' });

    // Mark as complete
    appendFileSync(progressFile, file + '\n');
    uploaded++;

    if (uploaded % 50 === 0 || uploaded === files.length - skipped) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = uploaded / elapsed;
      const remaining = (files.length - skipped - uploaded) / rate;
      console.log(`Uploaded ${uploaded}/${files.length - skipped} (${rate.toFixed(1)}/s, ~${Math.ceil(remaining / 60)}min remaining)`);
    }
  } catch (e) {
    console.error(`Failed to upload ${file}: ${e.message}`);
    failed++;

    // Continue with other files
    if (failed > 10) {
      console.error('Too many failures, stopping');
      break;
    }
  }
}

const elapsed = (Date.now() - startTime) / 1000;
console.log('');
console.log('=== Upload Complete ===');
console.log(`Uploaded: ${uploaded}`);
console.log(`Skipped (already uploaded): ${skipped}`);
console.log(`Failed: ${failed}`);
console.log(`Time: ${elapsed.toFixed(1)}s`);

if (failed === 0 && !dryRun) {
  console.log('');
  console.log('All files uploaded successfully!');
  console.log('');
  console.log('Next steps:');
  console.log('1. Deploy the worker: npx wrangler deploy');
  console.log('2. Test the biome lookup endpoint');
}
