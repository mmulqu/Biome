#!/usr/bin/env node
/**
 * Chunks res7 biome JSONL into prefix-grouped files for R2 upload.
 *
 * Usage: node scripts/chunk_biomes_for_r2.js <input.jsonl> <output_dir> [prefix_length]
 *
 * Example: node scripts/chunk_biomes_for_r2.js ./landcover_export/landcover_res7.jsonl ./r2_chunks 4
 *
 * This creates files like:
 *   ./r2_chunks/8a2a.json
 *   ./r2_chunks/8a2b.json
 *   etc.
 *
 * Each file contains a map of h3_index -> { code, biome }
 */

import { createReadStream, mkdirSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { gzipSync } from 'zlib';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node chunk_biomes_for_r2.js <input.jsonl> <output_dir> [prefix_length]');
  console.error('Example: node chunk_biomes_for_r2.js ./landcover_export/landcover_res7.jsonl ./r2_chunks 4');
  process.exit(1);
}

const inputFile = args[0];
const outputDir = args[1];
const prefixLength = parseInt(args[2] || '4', 10);

// Ensure output directory exists
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

// Map to collect tiles by prefix
const chunks = new Map();

let totalRecords = 0;
let errorCount = 0;

console.log(`Chunking ${inputFile} into ${outputDir} with prefix length ${prefixLength}...`);
console.log('');

const startTime = Date.now();

const rl = createInterface({
  input: createReadStream(inputFile),
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  if (!line.trim()) return;

  try {
    const record = JSON.parse(line);
    const h3Index = record.h3_index;
    const prefix = h3Index.substring(0, prefixLength);

    if (!chunks.has(prefix)) {
      chunks.set(prefix, {});
    }

    // Store compact format: { code, biome }
    chunks.get(prefix)[h3Index] = {
      code: record.landcover_code,
      biome: record.biome_type
    };

    totalRecords++;

    if (totalRecords % 1000000 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = Math.round(totalRecords / elapsed);
      console.log(`Processed ${(totalRecords / 1000000).toFixed(1)}M records (${rate}/sec), ${chunks.size} chunks`);
    }
  } catch (e) {
    errorCount++;
    if (errorCount <= 5) {
      console.error(`Error parsing line: ${e.message}`);
    }
  }
});

rl.on('close', () => {
  const elapsed = (Date.now() - startTime) / 1000;
  console.log('');
  console.log(`Finished reading: ${totalRecords.toLocaleString()} records in ${elapsed.toFixed(1)}s`);
  console.log(`Created ${chunks.size} chunks`);
  console.log('');
  console.log('Writing chunk files...');

  let written = 0;
  let totalSize = 0;
  let totalCompressedSize = 0;

  for (const [prefix, data] of chunks) {
    const filename = `${prefix}.json`;
    const filepath = join(outputDir, filename);
    const gzFilepath = join(outputDir, `${prefix}.json.gz`);

    const json = JSON.stringify(data);
    const compressed = gzipSync(json);

    // Write both for flexibility (gzipped is what we'll upload)
    writeFileSync(gzFilepath, compressed);

    totalSize += json.length;
    totalCompressedSize += compressed.length;
    written++;

    if (written % 100 === 0) {
      console.log(`Written ${written}/${chunks.size} chunks...`);
    }
  }

  console.log('');
  console.log('=== Summary ===');
  console.log(`Total records: ${totalRecords.toLocaleString()}`);
  console.log(`Total chunks: ${chunks.size}`);
  console.log(`Uncompressed size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Compressed size: ${(totalCompressedSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Compression ratio: ${(totalSize / totalCompressedSize).toFixed(1)}x`);
  console.log('');
  console.log(`Chunk files written to: ${outputDir}/`);
  console.log('');
  console.log('Next step: Upload to R2 with:');
  console.log(`  node scripts/upload_to_r2.js ${outputDir}`);

  if (errorCount > 0) {
    console.log('');
    console.warn(`Warning: ${errorCount} records had errors and were skipped`);
  }
});
