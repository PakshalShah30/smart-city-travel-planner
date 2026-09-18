-- Run this before the first generated migration.
-- PostGIS must exist before any geography(Point,4326) column can be created.
CREATE EXTENSION IF NOT EXISTS postgis;
