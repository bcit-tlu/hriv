-- Corgi Image Library – schema initialization
-- Executed before seed.sql by PostgreSQL on first startup.

CREATE TABLE IF NOT EXISTS programs (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(255) NOT NULL UNIQUE,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
    id            SERIAL PRIMARY KEY,
    label         VARCHAR(255) NOT NULL,
    parent_id     INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    program       VARCHAR(255),
    status        VARCHAR(50) DEFAULT 'active',
    sort_order    INTEGER NOT NULL DEFAULT 0,
    metadata      JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

CREATE TABLE IF NOT EXISTS images (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    thumb         TEXT NOT NULL,
    tile_sources  TEXT NOT NULL,
    category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    copyright     VARCHAR(500),
    note          VARCHAR(500),
    active        BOOLEAN DEFAULT true,
    metadata      JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_images_category ON images(category_id);

CREATE TABLE IF NOT EXISTS image_programs (
    image_id      INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    program_id    INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    PRIMARY KEY (image_id, program_id)
);

CREATE TABLE IF NOT EXISTS source_images (
    id            SERIAL PRIMARY KEY,
    original_filename VARCHAR(500) NOT NULL,
    stored_path   TEXT NOT NULL,
    status        VARCHAR(50) NOT NULL DEFAULT 'pending',
    error_message TEXT,
    name          VARCHAR(255),
    category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    copyright     VARCHAR(500),
    note          VARCHAR(500),
    active        BOOLEAN NOT NULL DEFAULT true,
    program       VARCHAR(255),
    image_id      INTEGER REFERENCES images(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_images_status ON source_images(status);

CREATE TABLE IF NOT EXISTS bulk_import_jobs (
    id            SERIAL PRIMARY KEY,
    status        VARCHAR(50) NOT NULL DEFAULT 'pending',
    category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    total_count   INTEGER NOT NULL DEFAULT 0,
    completed_count INTEGER NOT NULL DEFAULT 0,
    failed_count  INTEGER NOT NULL DEFAULT 0,
    errors        JSONB DEFAULT '[]',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bulk_import_jobs_status ON bulk_import_jobs(status);

CREATE TABLE IF NOT EXISTS announcements (
    id            SERIAL PRIMARY KEY,
    message       TEXT NOT NULL DEFAULT '',
    enabled       BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255),
    oidc_subject  VARCHAR(255) UNIQUE,
    role          VARCHAR(50) NOT NULL DEFAULT 'student',
    program_id    INTEGER REFERENCES programs(id) ON DELETE SET NULL,
    last_access   TIMESTAMPTZ,
    metadata      JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);
