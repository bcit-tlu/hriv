-- Corgi Image Library – schema initialization
-- Executed before seed.sql by PostgreSQL on first startup.

CREATE TABLE IF NOT EXISTS categories (
    id            SERIAL PRIMARY KEY,
    label         VARCHAR(255) NOT NULL,
    parent_id     INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    program       VARCHAR(255),
    status        VARCHAR(50) DEFAULT 'active',
    metadata      JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

CREATE TABLE IF NOT EXISTS images (
    id            SERIAL PRIMARY KEY,
    label         VARCHAR(255) NOT NULL,
    thumb         TEXT NOT NULL,
    tile_sources  TEXT NOT NULL,
    category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    copyright     VARCHAR(500),
    origin        VARCHAR(500),
    program       VARCHAR(255),
    status        VARCHAR(50) DEFAULT 'active',
    metadata      JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_images_category ON images(category_id);

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255),
    role          VARCHAR(50) NOT NULL DEFAULT 'student',
    program       VARCHAR(255),
    last_access   TIMESTAMPTZ,
    metadata      JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);
