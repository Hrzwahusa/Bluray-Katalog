-- ============================================================
-- BluRay-Katalog Datenbank-Schema für Supabase (PostgreSQL)
-- ============================================================
-- Ausführen in: Supabase Dashboard → SQL Editor

-- Erweiterungen aktivieren
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- Für Volltextsuche

-- Haupt-Tabelle für Filme
CREATE TABLE IF NOT EXISTS movies (
  id            UUID          DEFAULT uuid_generate_v4() PRIMARY KEY,
  title         TEXT          NOT NULL,
  original_title TEXT,
  year          INTEGER,
  genres        TEXT[]        DEFAULT '{}',
  cast_members  TEXT[]        DEFAULT '{}',  -- Hauptdarsteller
  director      TEXT,
  description   TEXT,
  cover_url     TEXT,         -- Bild-URL aus Internet (Wikipedia/Wikimedia)
  bluray_photo_url TEXT,      -- URL des aufgenommenen Cover-Fotos (Supabase Storage)
  wikidata_id   TEXT          UNIQUE,
  imdb_id       TEXT,
  runtime       INTEGER,      -- Laufzeit in Minuten
  rating        DECIMAL(3,1),
  language      TEXT,
  created_at    TIMESTAMPTZ   DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   DEFAULT NOW()
);

-- Indizes für schnelle Suche
CREATE INDEX IF NOT EXISTS idx_movies_title      ON movies USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_movies_orig_title ON movies USING GIN (original_title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_movies_year       ON movies (year);
CREATE INDEX IF NOT EXISTS idx_movies_genres     ON movies USING GIN (genres);
CREATE INDEX IF NOT EXISTS idx_movies_cast       ON movies USING GIN (cast_members);
CREATE INDEX IF NOT EXISTS idx_movies_created    ON movies (created_at DESC);

-- Automatische updated_at Aktualisierung
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_movies_updated_at ON movies;
CREATE TRIGGER update_movies_updated_at
  BEFORE UPDATE ON movies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Supabase Storage Bucket für Cover-Fotos
-- (Im Supabase Dashboard unter Storage erstellen oder hier per SQL)
INSERT INTO storage.buckets (id, name, public)
VALUES ('bluray-covers', 'bluray-covers', true)
ON CONFLICT (id) DO NOTHING;

-- Row Level Security (RLS) aktivieren
ALTER TABLE movies ENABLE ROW LEVEL SECURITY;

-- Policy: Alle dürfen lesen (da kein Login erforderlich für Katalog)
CREATE POLICY "Öffentliches Lesen" ON movies
  FOR SELECT USING (true);

-- Policy: Alle dürfen einfügen (Single-User-App)
CREATE POLICY "Öffentliches Einfügen" ON movies
  FOR INSERT WITH CHECK (true);

-- Policy: Alle dürfen aktualisieren
CREATE POLICY "Öffentliches Aktualisieren" ON movies
  FOR UPDATE USING (true);

-- Policy: Alle dürfen löschen
CREATE POLICY "Öffentliches Löschen" ON movies
  FOR DELETE USING (true);

-- Storage Policy: Öffentlicher Zugriff auf Cover-Fotos
CREATE POLICY "Öffentliches Lesen Storage"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'bluray-covers');

CREATE POLICY "Öffentliches Hochladen Storage"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'bluray-covers');

CREATE POLICY "Öffentliches Löschen Storage"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'bluray-covers');

-- Beispieldaten (optional, zum Testen)
-- INSERT INTO movies (title, year, genres, cast, director, description, cover_url)
-- VALUES (
--   'The Matrix',
--   1999,
--   ARRAY['Science Fiction', 'Action'],
--   ARRAY['Keanu Reeves', 'Laurence Fishburne', 'Carrie-Anne Moss'], -- cast_members
--   'Lana Wachowski',
--   'A computer hacker learns from mysterious rebels about the true nature of his reality.',
--   'https://upload.wikimedia.org/wikipedia/en/c/c1/The_Matrix_Poster.jpg'
-- );

COMMENT ON TABLE movies IS 'BluRay-Filmkatalog – enthält alle eingelesenen Filme mit Metadaten';
