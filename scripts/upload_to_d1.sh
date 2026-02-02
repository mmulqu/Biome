#!/bin/bash
# Quick upload script using wrangler d1 execute directly
# This is an alternative to the Node.js script for smaller datasets

set -e

DB_NAME="${1:-biome-zonal-stats}"
DATA_DIR="$(dirname "$0")/../data/exports"

echo "==================================================="
echo "Biome Zonal Statistics - D1 Upload"
echo "==================================================="
echo "Database: $DB_NAME"
echo "Data directory: $DATA_DIR"
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "Error: wrangler CLI not found"
    echo "Install with: npm install -g wrangler"
    exit 1
fi

# Apply schema first
echo "Applying schema..."
wrangler d1 execute "$DB_NAME" --file="$(dirname "$0")/../schema.sql"

# Upload each resolution
for res_dir in "$DATA_DIR"/res*; do
    if [ -d "$res_dir" ]; then
        res=$(basename "$res_dir" | sed 's/res//')
        csv_file="$res_dir/zonal_stats_res${res}.csv"

        if [ -f "$csv_file" ]; then
            echo ""
            echo "Uploading resolution $res..."
            record_count=$(wc -l < "$csv_file")
            record_count=$((record_count - 1))  # minus header
            echo "  Records: $record_count"

            # Generate SQL from CSV (skip header)
            sql_file="/tmp/upload_res${res}.sql"
            echo "BEGIN TRANSACTION;" > "$sql_file"

            tail -n +2 "$csv_file" | while IFS=',' read -r h3_index zone_code count area majority source_part; do
                # Escape single quotes in strings
                h3_index=$(echo "$h3_index" | sed "s/'/''/g")
                source_part=$(echo "$source_part" | sed "s/'/''/g")

                echo "INSERT INTO zonal_stats_res${res} (h3_index, zone_code, count, area, majority, source_part) VALUES ('$h3_index', $zone_code, $count, $area, $majority, '$source_part');" >> "$sql_file"
            done

            echo "COMMIT;" >> "$sql_file"

            # Execute
            wrangler d1 execute "$DB_NAME" --file="$sql_file"
            rm "$sql_file"

            echo "  Done!"
        fi
    fi
done

echo ""
echo "==================================================="
echo "Upload complete!"
echo "==================================================="
