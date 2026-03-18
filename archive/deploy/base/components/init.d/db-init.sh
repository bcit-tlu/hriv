#!/bin/bash
set -e


# Confirm env vars
#
echo "AWS_BUCKET: $AWS_BUCKET"
echo "AWS_DB_BACKUP: $AWS_DB_BACKUP"
echo "AWS_ACCESS_KEY_ID: $AWS_ACCESS_KEY_ID"
echo "AWS_SECRET_ACCESS_KEY: $AWS_SECRET_ACCESS_KEY"


# Determine latest backup
#
PREFIX="$AWS_DB_BACKUP/dump_$(date +%m)"
LATEST_BACKUP=$(aws s3api list-objects-v2 \
--bucket $AWS_BUCKET \
--prefix $PREFIX \
--start-after $PREFIX \
| jq -r --arg trim "$AWS_DB_BACKUP" '.[] | max_by(.LastModified)?|.Key|ltrimstr($trim+"/")')



# Retrieve from S3
#
BACKUP=$AWS_BUCKET/$AWS_DB_BACKUP/$LATEST_BACKUP
aws s3 cp s3://$BACKUP ./update.sql

if [ -d "docker-entrypoint-initdb.d" ]; then
  echo "docker-entrypoint-initdb.d directory found. Copying backup there."
  mv update.sql /docker-entrypoint-initdb.d/update.sql
else
  echo "docker-entrypoint-initdb.d directory not found. Backup file location unchanged."
fi

exec "$@"
