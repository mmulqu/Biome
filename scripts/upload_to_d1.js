#!/usr/bin/env node
/**
 * Upload zonal statistics data to Cloudflare D1
 *
 * This script reads exported CSV/JSON files and uploads them to D1
 * in batches using the wrangler CLI.
 *
 * Usage:
 *   node upload_to_d1.js [--resolution <5|6|7|8|9>] [--env dev]
 *
 * Prerequisites:
 *   1. Run export_geodatabase.py first to generate data files
 *   2. Create D1 database: wrangler d1 create biome-zonal-stats
 *   3. Update wrangler.toml with database_id
 *   4. Apply schema: wrangler d1 execute biome-zonal-stats --file=./schema.sql
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");

// Configuration
const DATA_DIR = path.join(__dirname, "..", "data", "exports");
const BATCH_SIZE = 500; // D1 has limits on batch insert size
const DATABASE_NAME = "biome-zonal-stats";

// Parse command line arguments
const args = process.argv.slice(2);
let targetResolution = null;
let environment = "";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--resolution" && args[i + 1]) {
    targetResolution = parseInt(args[i + 1]);
    i++;
  } else if (args[i] === "--env" && args[i + 1]) {
    environment = args[i + 1];
    i++;
  }
}

const envFlag = environment ? `--env ${environment}` : "";
const dbName = environment ? `${DATABASE_NAME}-${environment}` : DATABASE_NAME;

/**
 * Read manifest to find available data files
 */
function readManifest() {
  const manifestPath = path.join(DATA_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error("Manifest not found. Run export_geodatabase.py first.");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
}

/**
 * Read JSON data file
 */
function readDataFile(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    console.error(`Data file not found: ${jsonPath}`);
    return [];
  }
  return JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
}

/**
 * Generate SQL INSERT statement for a batch of records
 */
function generateInsertSQL(tableName, records) {
  if (records.length === 0) return "";

  const columns = ["h3_index", "zone_code", "count", "area", "majority", "source_part"];
  const values = records
    .map((r) => {
      const vals = columns.map((col) => {
        const val = r[col];
        if (val === null || val === undefined) return "NULL";
        if (typeof val === "string") return `'${val.replace(/'/g, "''")}'`;
        return val;
      });
      return `(${vals.join(", ")})`;
    })
    .join(",\n  ");

  return `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES\n  ${values};`;
}

/**
 * Execute SQL against D1 using wrangler
 */
function executeSQL(sql, description) {
  const tempFile = path.join(__dirname, ".temp_sql.sql");
  fs.writeFileSync(tempFile, sql);

  try {
    const cmd = `wrangler d1 execute ${dbName} --file="${tempFile}" ${envFlag}`.trim();
    console.log(`  Executing: ${description}`);
    execSync(cmd, { stdio: "pipe" });
    return true;
  } catch (error) {
    console.error(`  Error: ${error.message}`);
    return false;
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

/**
 * Upload data for a specific resolution
 */
async function uploadResolution(resolution, dataInfo) {
  const tableName = `zonal_stats_res${resolution}`;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Uploading resolution ${resolution}`);
  console.log(`Table: ${tableName}`);
  console.log(`Records: ${dataInfo.record_count.toLocaleString()}`);
  console.log("=".repeat(60));

  // Read data
  const records = readDataFile(dataInfo.json_file);
  if (records.length === 0) {
    console.log("No records to upload");
    return;
  }

  // Upload in batches
  const totalBatches = Math.ceil(records.length / BATCH_SIZE);
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = records.slice(i, i + BATCH_SIZE);
    const sql = generateInsertSQL(tableName, batch);

    const success = executeSQL(sql, `Batch ${batchNum}/${totalBatches} (${batch.length} records)`);
    if (success) {
      successCount += batch.length;
    } else {
      errorCount += batch.length;
    }

    // Progress indicator
    const progress = ((i + batch.length) / records.length) * 100;
    process.stdout.write(`  Progress: ${progress.toFixed(1)}%\r`);
  }

  console.log(`\nCompleted: ${successCount.toLocaleString()} inserted, ${errorCount.toLocaleString()} errors`);

  // Record in metadata table
  const metaSQL = `
    INSERT OR REPLACE INTO upload_metadata (resolution, source_table, record_count)
    VALUES (${resolution}, 'zonal_stats_res${resolution}', ${successCount});
  `;
  executeSQL(metaSQL, "Recording metadata");
}

/**
 * Main execution
 */
async function main() {
  console.log("Biome Zonal Statistics - D1 Upload");
  console.log("=".repeat(60));
  console.log(`Database: ${dbName}`);
  console.log(`Environment: ${environment || "production"}`);
  console.log(`Data directory: ${DATA_DIR}`);

  // Check wrangler is available
  try {
    execSync("wrangler --version", { stdio: "pipe" });
  } catch {
    console.error("\nError: wrangler CLI not found. Install with: npm install -g wrangler");
    process.exit(1);
  }

  // Read manifest
  const manifest = readManifest();
  console.log(`\nExported at: ${manifest.exported_at}`);
  console.log(`Source: ${manifest.source}`);

  // Determine which resolutions to upload
  const resolutions = targetResolution
    ? [targetResolution]
    : Object.keys(manifest.resolutions).map(Number).sort();

  console.log(`\nResolutions to upload: ${resolutions.join(", ")}`);

  // Confirm before proceeding
  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const totalRecords = resolutions.reduce((sum, res) => {
    return sum + (manifest.resolutions[res]?.record_count || 0);
  }, 0);

  await new Promise((resolve) => {
    rl.question(`\nUpload ${totalRecords.toLocaleString()} records? (y/N) `, (answer) => {
      rl.close();
      if (answer.toLowerCase() !== "y") {
        console.log("Aborted.");
        process.exit(0);
      }
      resolve();
    });
  });

  // Upload each resolution
  for (const res of resolutions) {
    const dataInfo = manifest.resolutions[res];
    if (!dataInfo) {
      console.log(`\nNo data for resolution ${res}, skipping`);
      continue;
    }
    await uploadResolution(res, dataInfo);
  }

  console.log("\n" + "=".repeat(60));
  console.log("Upload complete!");
  console.log("=".repeat(60));
}

main().catch(console.error);
