#!/usr/bin/env node
/**
 * Chunks ALL biome data (res3, res5, res7) into geographic prefix-grouped files for R2.
 *
 * Usage: node scripts/chunk_all_biomes.js <output_dir>
 *
 * Expects these files in ./landcover_export/:
 *   - landcover_res3.jsonl
 *   - landcover_res5.jsonl
 *   - landcover_res7.jsonl
 *
 * Output structure:
 *   <output_dir>/
 *     ├── 872a.json.gz  (all res3/5/7 tiles starting with 872a)
 *     ├── 872b.json.gz
 *     └── ...
 *
 * Each chunk file contains: { "h3_index": { "code": 123, "biome": "forest" }, ... }
 */

import { createReadStream, mkdirSync, writeFileSync, existsSync, statSync } from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';
import { gzipSync } from 'zlib';

const args = process.argv.slice(2);
const outputDir = args[0] || './r2_chunks';

// Configuration
const INPUT_DIR = './landcover_export';
const PREFIX_LENGTH = 4; // First 4 chars of H3 index = geographic grouping

const INPUT_FILES = [
  { file: 'landcover_res3.jsonl', resolution: 3 },
  { file: 'landcover_res5.jsonl', resolution: 5 },
  { file: 'landcover_res7.jsonl', resolution: 7 },
];

// Ensure output directory exists
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

// Map to collect all tiles by prefix
const chunks = new Map();

let totalRecords = 0;
let errorCount = 0;
const startTime = Date.now();

console.log('=== Biome Data Chunker for R2 ===');
console.log(`Output directory: ${outputDir}`);
console.log(`Prefix length: ${PREFIX_LENGTH} characters`);
console.log('');

// Process each input file
async function processFile(filename, resolution) {
  const filepath = join(INPUT_DIR, filename);

  if (!existsSync(filepath)) {
    console.log(`⚠ Skipping ${filename} (file not found)`);
    return 0;
  }

  const stat = statSync(filepath);
  console.log(`Processing ${filename} (${(stat.size / 1024 / 1024).toFixed(1)} MB)...`);

  let fileRecords = 0;

  return new Promise((resolve) => {
    const rl = createInterface({
      input: createReadStream(filepath),
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      if (!line.trim()) return;

      try {
        const record = JSON.parse(line);
        const h3Index = record.h3_index;
        const prefix = h3Index.substring(0, PREFIX_LENGTH);

        if (!chunks.has(prefix)) {
          chunks.set(prefix, {});
        }

        // Store compact format
        chunks.get(prefix)[h3Index] = {
          code: record.landcover_code,
          biome: record.biome_type
        };

        totalRecords++;
        fileRecords++;

        if (totalRecords % 5000000 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = Math.round(totalRecords / elapsed);
          console.log(`  ${(totalRecords / 1000000).toFixed(1)}M records (${rate}/sec), ${chunks.size} chunks`);
        }
      } catch (e) {
        errorCount++;
        if (errorCount <= 5) {
          console.error(`  Error parsing line: ${e.message}`);
        }
      }
    });

    rl.on('close', () => {
      console.log(`  ✓ ${fileRecords.toLocaleString()} records from res${resolution}`);
      resolve(fileRecords);
    });
  });
}

// Main execution
async function main() {
  // Process all input files
  for (const { file, resolution } of INPUT_FILES) {
    await processFile(file, resolution);
  }

  const readTime = (Date.now() - startTime) / 1000;
  console.log('');
  console.log(`Read complete: ${totalRecords.toLocaleString()} total records in ${readTime.toFixed(1)}s`);
  console.log(`Total chunks: ${chunks.size}`);
  console.log('');
  console.log('Writing chunk files...');

  const writeStart = Date.now();
  let written = 0;
  let totalSize = 0;
  let totalCompressedSize = 0;

  for (const [prefix, data] of chunks) {
    const gzFilepath = join(outputDir, `${prefix}.json.gz`);

    const json = JSON.stringify(data);
    const compressed = gzipSync(json, { level: 9 }); // Max compression

    writeFileSync(gzFilepath, compressed);

    totalSize += json.length;
    totalCompressedSize += compressed.length;
    written++;

    if (written % 500 === 0) {
      console.log(`  Written ${written}/${chunks.size} chunks...`);
    }
  }

  const writeTime = (Date.now() - writeStart) / 1000;
  const totalTime = (Date.now() - startTime) / 1000;

  console.log('');
  console.log('=== Summary ===');
  console.log(`Total records: ${totalRecords.toLocaleString()}`);
  console.log(`Total chunks: ${chunks.size}`);
  console.log(`Uncompressed size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Compressed size: ${(totalCompressedSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Compression ratio: ${(totalSize / totalCompressedSize).toFixed(1)}x`);
  console.log(`Read time: ${readTime.toFixed(1)}s`);
  console.log(`Write time: ${writeTime.toFixed(1)}s`);
  console.log(`Total time: ${totalTime.toFixed(1)}s`);
  console.log('');
  console.log(`Chunk files written to: ${outputDir}/`);

  if (errorCount > 0) {
    console.log('');
    console.warn(`Warning: ${errorCount} records had errors and were skipped`);
  }

  console.log('');
  console.log('Next steps:');
  console.log('  1. Create R2 bucket: npx wrangler r2 bucket create biome-tiles');
  console.log(`  2. Upload to R2: node scripts/upload_to_r2.js ${outputDir}`);
  console.log('  3. Deploy worker: npx wrangler deploy');
}

main().catch(console.error);
