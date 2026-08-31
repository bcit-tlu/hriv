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
-- Insert by ID first (preserves seed IDs on fresh databases), then
-- insert by name as a fallback so that on an existing database where
-- IDs 1–3 belong to other programs, the seed programs are still
-- created with auto-assigned IDs and the name-based JOINs below
-- can resolve them.
--
-- The first INSERT uses ON CONFLICT DO NOTHING without a conflict
-- target so that BOTH id and name unique-constraint violations are
-- tolerated (e.g. when 'Digital Design' already exists under a
-- different ID).  The second INSERT catches the remaining case where
-- the seed ID was occupied by another program and the seed name did
-- not yet exist.

INSERT INTO programs (id, name)
VALUES
  (1, 'Administration'),
  (2, 'Digital Design'),
  (3, 'Photography')
ON CONFLICT DO NOTHING;

INSERT INTO programs (name)
VALUES
  ('Administration'),
  ('Digital Design'),
  ('Photography')
ON CONFLICT (name) DO NOTHING;

SELECT setval('programs_id_seq', GREATEST((SELECT MAX(id) FROM programs), 1));

-- ── Categories ────────────────────────────────────────────

INSERT INTO categories (id, label, parent_id, status, metadata)
VALUES
  (1, 'Architecture',           NULL, 'active', '{}'),
  (2, 'Panoramas',              NULL, 'active', '{}'),
  (3, 'Italian',                1,    'active', '{}'),
  (4, 'American',               1,    'active', '{}'),
  (5, 'Gothic',                 3,    'active', '{}'),
  (6, 'Synthetic Monitoring',   NULL, 'active', '{}')
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
--   Synthetic Monitoring -> Administration        (monitor account access)
--
-- Clear seed-managed rows first so re-runs don't leave stale associations
-- from previous seed versions (e.g. children that no longer have direct
-- restrictions).  Categories 1–5 always use their seed IDs; the Synthetic
-- Monitoring category is resolved by label so that a user-created category
-- occupying ID 6 is never accidentally rewritten.
DELETE FROM category_programs WHERE category_id IN (1, 2, 3, 4, 5);
DELETE FROM category_programs
WHERE category_id = (
  SELECT id FROM categories
  WHERE label = 'Synthetic Monitoring' AND parent_id IS NULL
);

INSERT INTO category_programs (category_id, program_id)
SELECT c.category_id, p.id
FROM (VALUES
  (1, 'Digital Design'),   -- Architecture -> Digital Design  (parent restriction)
  (1, 'Photography'),      -- Architecture -> Photography     (parent restriction)
  (2, 'Photography'),      -- Panoramas    -> Photography     (independent parent)
  (4, 'Digital Design')    -- American     -> Digital Design  (narrows parent's {DD, Photo})
) AS c(category_id, program_name)
JOIN programs p ON p.name = c.program_name
ON CONFLICT (category_id, program_id) DO NOTHING;

-- Synthetic Monitoring -> Administration (monitor account access).
-- Resolved by label so the association targets the correct category and
-- program even when seed_media.py created the category under a different
-- ID (e.g. ID 6 was taken) or Administration has a different program ID.
INSERT INTO category_programs (category_id, program_id)
SELECT c.id, p.id
FROM categories c
CROSS JOIN programs p
WHERE c.label = 'Synthetic Monitoring' AND c.parent_id IS NULL
  AND p.name = 'Administration'
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
-- All program assignments are resolved by name so that an existing
-- database where seed program IDs (1–3) belong to other programs does
-- not cause users to be assigned to the wrong program.

INSERT INTO user_programs (user_id, program_id)
SELECT 1, p.id FROM programs p WHERE p.name = 'Administration'
ON CONFLICT (user_id, program_id) DO NOTHING;

INSERT INTO user_programs (user_id, program_id)
SELECT u.user_id, p.id
FROM (VALUES
  (2),  -- instructor
  (3),  -- student
  (4)   -- synthetic student
) AS u(user_id)
CROSS JOIN programs p
WHERE p.name = 'Digital Design'
ON CONFLICT (user_id, program_id) DO NOTHING;

-- The synthetic student must share the monitor category's program.
INSERT INTO user_programs (user_id, program_id)
SELECT 4, p.id FROM programs p WHERE p.name = 'Administration'
ON CONFLICT (user_id, program_id) DO NOTHING;
