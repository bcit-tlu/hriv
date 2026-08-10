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

INSERT INTO categories (id, label, parent_id, status, metadata)
VALUES
  (1, 'Architecture', NULL, 'active', '{}'),
  (2, 'Panoramas',    NULL, 'active', '{}'),
  (3, 'Italian',      1,    'active', '{}'),
  (4, 'American',     1,    'active', '{}'),
  (5, 'Gothic',       3,    'active', '{}')
ON CONFLICT (id) DO NOTHING;

SELECT setval('categories_id_seq', GREATEST((SELECT MAX(id) FROM categories), 1));

-- ── Category–Program associations ───────────────────────
-- Seed data exercises the inheritance hierarchy introduced by the
-- restricted-category-indicators feature (issue #382):
--
--   Architecture  -> Digital Design + Photography  (multi-program parent)
--     Italian     -> (none — inherits DD + Photo from Architecture)
--       Gothic    -> (none — inherits via Italian -> Architecture)
--     American    -> Digital Design               (narrows parent's set)
--   Panoramas    -> Photography                   (independent parent)
--
-- Clear seed-managed rows first so re-runs don't leave stale associations
-- from previous seed versions (e.g. children that no longer have direct
-- restrictions).
DELETE FROM category_programs WHERE category_id IN (1, 2, 3, 4, 5);

INSERT INTO category_programs (category_id, program_id)
VALUES
  (1, 2),  -- Architecture -> Digital Design  (parent restriction)
  (1, 3),  -- Architecture -> Photography     (parent restriction)
  (2, 3),  -- Panoramas    -> Photography     (independent parent)
  (4, 2)   -- American     -> Digital Design  (narrows parent's {DD, Photo})
ON CONFLICT (category_id, program_id) DO NOTHING;

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

-- ── Announcements ───────────────────────────────────────────

INSERT INTO announcements (id, message, enabled)
VALUES (1, '', false)
ON CONFLICT (id) DO NOTHING;

SELECT setval('announcements_id_seq', GREATEST((SELECT MAX(id) FROM announcements), 1));

-- ── Users ─────────────────────────────────────────────────

INSERT INTO users (id, name, email, password_hash, role, last_access, metadata)
VALUES
  (1, 'Haruki Tanaka',      'admin@example.ca',   '$2b$12$bD0vGhiySbmr6aqbp.fjeuF9VTVMaGiKOujX2aOoTIRxyjsNc4b2C', 'admin',      NULL, '{}'),
  (2, 'Carlos Henrique Souza',   'instructor@example.ca',     '$2b$12$bD0vGhiySbmr6aqbp.fjeuF9VTVMaGiKOujX2aOoTIRxyjsNc4b2C', 'instructor', NULL, '{}'),
  (3, 'Mira Patel',  'student@example.ca', '$2b$12$bD0vGhiySbmr6aqbp.fjeuF9VTVMaGiKOujX2aOoTIRxyjsNc4b2C', 'student',    NULL, '{}'),
  (4, 'Synthetic Student',  'synthetic.student@example.ca', '$2b$12$bD0vGhiySbmr6aqbp.fjeuF9VTVMaGiKOujX2aOoTIRxyjsNc4b2C', 'student',    NULL, '{"synthetic": true}')
ON CONFLICT (id) DO NOTHING;

SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1));

-- ── User–Program associations ───────────────────────────

INSERT INTO user_programs (user_id, program_id)
VALUES
  (1, 1),  -- admin -> Administration
  (2, 2),  -- instructor -> Digital Design
  (3, 2),  -- student -> Digital Design
  (4, 2)   -- synthetic student -> Digital Design
ON CONFLICT (user_id, program_id) DO NOTHING;
