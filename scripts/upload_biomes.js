#!/usr/bin/env node
/**
 * Upload biome data to Cloudflare D1 via the API
 *
 * Usage:
 *   node upload_biomes.js <jsonl_file> <resolution> [api_base_url]
 *
 * Example:
 *   node upload_biomes.js ./landcover_export/landcover_res3.jsonl 3
 *   node upload_biomes.js ./landcover_export/landcover_res5.jsonl 5 https://biome.riverrun.quest/api
 */

import fs from 'fs';
import readline from 'readline';
import https from 'https';
import http from 'http';

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('Usage: node upload_biomes.js <jsonl_file> <resolution> [api_base_url]');
  console.log('\nExample:');
  console.log('  node upload_biomes.js ./landcover_export/landcover_res3.jsonl 3');
  console.log('  node upload_biomes.js ./landcover_export/landcover_res5.jsonl 5 https://biome.riverrun.quest/api');
  process.exit(1);
}

const inputFile = args[0];
const resolution = parseInt(args[1]);
const apiBase = args[2] || 'https://biome.riverrun.quest/api';

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

if (isNaN(resolution) || resolution < 0 || resolution > 15) {
  console.error('Error: Resolution must be a number between 0 and 15');
  process.exit(1);
}

console.log(`Input file: ${inputFile}`);
console.log(`Resolution: ${resolution}`);
console.log(`API base: ${apiBase}`);
console.log('');

// Read all records from JSONL file
async function readRecords(filePath) {
  const records = [];
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (line.trim()) {
      try {
        records.push(JSON.parse(line));
      } catch (e) {
        console.warn(`Skipping invalid JSON line: ${line.substring(0, 50)}...`);
      }
    }
  }

  return records;
}

// Make HTTP request
function apiRequest(url, data) {
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
      }
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

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Upload in batches
async function uploadBatches(records, resolution) {
  const BATCH_SIZE = 500; // Records per API call
  let totalImported = 0;
  let totalErrors = 0;

  console.log(`Total records: ${records.length}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Total batches: ${Math.ceil(records.length / BATCH_SIZE)}`);
  console.log('');

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(records.length / BATCH_SIZE);

    process.stdout.write(`Uploading batch ${batchNum}/${totalBatches}... `);

    try {
      const result = await apiRequest(`${apiBase}/biomes/import`, {
        biomes: batch,
        resolution: resolution
      });

      if (result.status === 200 && result.data) {
        totalImported += result.data.imported || 0;
        totalErrors += result.data.errors || 0;
        console.log(`OK (${result.data.imported} imported, ${result.data.errors} errors)`);
      } else {
        console.log(`ERROR: ${JSON.stringify(result.data)}`);
        totalErrors += batch.length;
      }
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      totalErrors += batch.length;
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }

  return { totalImported, totalErrors };
}

// Main
async function main() {
  console.log('Reading records...');
  const records = await readRecords(inputFile);

  if (records.length === 0) {
    console.log('No records found in file');
    process.exit(1);
  }

  console.log(`Read ${records.length} records\n`);

  const { totalImported, totalErrors } = await uploadBatches(records, resolution);

  console.log('\n========================================');
  console.log(`Upload complete!`);
  console.log(`  Total imported: ${totalImported}`);
  console.log(`  Total errors: ${totalErrors}`);
  console.log(`  Success rate: ${((totalImported / records.length) * 100).toFixed(1)}%`);
}

main().catch(console.error);
