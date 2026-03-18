#!/bin/bash
set -e


# Verify that the minimally required environment variables are set.
#
if [ -z "$MARIADB_ROOT_HOST" ] \
    || [ -z "$MARIADB_DATABASE" ] \
    || [ -z "$MARIADB_USER" ] \
    || [ -z "$MARIADB_PASSWORD" ]; then
    printf "---------- Corgi environment variables are not set. ---------- \n \
        You need to specify MARIADB_ROOT_HOST, MARIADB_DATABASE, MARIADB_USER and MARIADB_PASSWORD"
    exit 1
fi


# Confirm env vars
#
echo "AWS_BUCKET: $AWS_BUCKET"
echo "AWS_DB_BACKUP: $AWS_DB_BACKUP"
echo "AWS_ACCESS_KEY_ID: $AWS_ACCESS_KEY_ID"
echo "AWS_SECRET_ACCESS_KEY: $AWS_SECRET_ACCESS_KEY"
echo "MARIADB_ROOT_HOST: $MARIADB_ROOT_HOST"
echo "MARIADB_USER: $MARIADB_USER"
echo "MARIADB_PASSWORD: $MARIADB_PASSWORD"
echo "MARIADB_DATABASE: $MARIADB_DATABASE"


# Update env var keys to match Laravel requirements
#
echo "Adding Laravel DB env vars..."
export DB_HOST=${MARIADB_ROOT_HOST} \
    DB_DATABASE=${MARIADB_DATABASE} \
    DB_USERNAME=${MARIADB_USER} \
    DB_PASSWORD=${MARIADB_PASSWORD} \
    && echo -e "...done.\n"


echo -e "-------------------------------------------------------------------------------------------\n"


# Initialize if the database doesn't exist
#
if ! mysql -h$MARIADB_ROOT_HOST -u$MARIADB_USER -p$MARIADB_PASSWORD -P3306 -e"USE $MARIADB_DATABASE; SELECT * FROM migrations;" >/dev/null 2>&1; then
    printf >&2 "First deployment detected.\nCreating database and tables...\n"

    # Fix database charset and collection
    mysql -h$MARIADB_ROOT_HOST -u$MARIADB_USER -p$MARIADB_PASSWORD -P3306 -e"ALTER DATABASE $MARIADB_DATABASE CHARACTER SET utf8 COLLATE utf8_general_ci;"

    # Run db migrations for corgi database
    php artisan migrate:install --no-interaction --quiet
    php artisan migrate --force --no-interaction --quiet
    php artisan db:seed --no-interaction --quiet

    echo -e >&2 "Database and tables created.\n"
    echo -e "-------------------------------------------------------------------------------------------\n"
fi


# Reset caches
#
echo -e >&2 "Resetting caches...\n"
php artisan cache:clear
php artisan view:clear
php artisan config:cache
php artisan route:cache
php artisan queue:restart
echo -e >&2 "Cache resets done.\n"
echo -e "-------------------------------------------------------------------------------------------\n"


exec "$@"
