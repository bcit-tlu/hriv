-- HRIV Image Library – seed data (dev/demo only)
--
-- Schema is managed by Alembic (see ``backend/app/migrations/``); this
-- file seeds demo data on top of the Alembic schema for local docker-compose
-- development.  It is executed by the ``seed`` compose service after the
-- ``migrate`` service (``alembic upgrade head``) completes.
--
-- All INSERTs use ``ON CONFLICT ... DO NOTHING`` so the script is
-- idempotent — re-running it against a DB that already has seed data is
-- a no-op rather than a PK-conflict failure.

-- ── Programs ──────────────────────────────────────────────

INSERT INTO programs (id, name)
VALUES
  (1, 'Administration'),
  (2, 'Digital Design'),
  (3, 'Photography')
ON CONFLICT (id) DO NOTHING;

SELECT setval('programs_id_seq', GREATEST((SELECT MAX(id) FROM programs), 1));

-- ── Categories ────────────────────────────────────────────

INSERT INTO categories (id, label, parent_id, program, status, metadata)
VALUES
  (1, 'Architecture', NULL, 'Digital Design', 'active', '{}'),
  (2, 'Panoramas',    NULL, 'Photography',    'active', '{}'),
  (3, 'Italian',      1,    'Digital Design', 'active', '{}'),
  (4, 'American',     1,    'Digital Design', 'active', '{}'),
  (5, 'Gothic',       3,    'Digital Design', 'active', '{}')
ON CONFLICT (id) DO NOTHING;

SELECT setval('categories_id_seq', GREATEST((SELECT MAX(id) FROM categories), 1));

-- ── Images ────────────────────────────────────────────────

INSERT INTO images (id, name, thumb, tile_sources, category_id, copyright, note, active, metadata)
VALUES
  (1,
   'Duomo di Milano',
   'https://openseadragon.github.io/example-images/duomo/duomo_files/11/0_0.jpg',
   'https://openseadragon.github.io/example-images/duomo/duomo.dzi',
   3, 'Public Domain', 'OpenSeaDragon Examples', true, '{}'),
  (2,
   'Duomo di Milano (Gothic Detail)',
   'https://openseadragon.github.io/example-images/duomo/duomo_files/11/0_0.jpg',
   'https://openseadragon.github.io/example-images/duomo/duomo.dzi',
   5, 'Public Domain', 'OpenSeaDragon Examples', true, '{}'),
  (3,
   'Highsmith Panorama',
   'https://openseadragon.github.io/example-images/highsmith/highsmith_files/11/0_0.jpg',
   'https://openseadragon.github.io/example-images/highsmith/highsmith.dzi',
   4, 'Public Domain', 'Library of Congress', true, '{}'),
  (4,
   'Library of Congress',
   'https://openseadragon.github.io/example-images/highsmith/highsmith_files/11/0_0.jpg',
   'https://openseadragon.github.io/example-images/highsmith/highsmith.dzi',
   2, 'Public Domain', 'Library of Congress', true, '{}')
ON CONFLICT (id) DO NOTHING;

SELECT setval('images_id_seq', GREATEST((SELECT MAX(id) FROM images), 1));

-- ── Image–Program associations ──────────────────────────

INSERT INTO image_programs (image_id, program_id)
VALUES
  (1, 2),  -- Duomo di Milano -> Digital Design
  (2, 2),  -- Duomo di Milano (Gothic Detail) -> Digital Design
  (3, 3),  -- Highsmith Panorama -> Photography
  (4, 3)   -- Library of Congress -> Photography
ON CONFLICT (image_id, program_id) DO NOTHING;

-- ── Announcements ───────────────────────────────────────────

INSERT INTO announcements (id, message, enabled)
VALUES (1, '', false)
ON CONFLICT (id) DO NOTHING;

SELECT setval('announcements_id_seq', GREATEST((SELECT MAX(id) FROM announcements), 1));

-- ── Users ─────────────────────────────────────────────────

INSERT INTO users (id, name, email, password_hash, role, program_id, last_access, metadata)
VALUES
  (1, 'Haruki Tanaka',      'admin@bcit.ca',   '$2b$12$bD0vGhiySbmr6aqbp.fjeuF9VTVMaGiKOujX2aOoTIRxyjsNc4b2C', 'admin',      1, NULL, '{}'),
  (2, 'Carlos Henrique Souza',   'instructor@bcit.ca',     '$2b$12$bD0vGhiySbmr6aqbp.fjeuF9VTVMaGiKOujX2aOoTIRxyjsNc4b2C', 'instructor', 2, NULL, '{}'),
  (3, 'Mira Patel',  'student@bcit.ca', '$2b$12$bD0vGhiySbmr6aqbp.fjeuF9VTVMaGiKOujX2aOoTIRxyjsNc4b2C', 'student',    2, NULL, '{}')
ON CONFLICT (id) DO NOTHING;

SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1));
