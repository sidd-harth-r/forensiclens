-- ForensicLens Migration 002: raw_records_fts
-- Migration: 002_raw_records_fts.sql
-- Database target: SQLite + FTS5
-- Specification: docs/DATABASE.md, docs/RETRIEVAL.md
--
-- Creates an FTS5 virtual table for raw evidence lines (raw_records),
-- enabling lexical search over complete source records (including unparsed lines)
-- with automatic synchronization triggers.

----------------------------------------------------------------------
-- 1. raw_records_fts (FTS5 virtual table)
----------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS raw_records_fts USING fts5 (
    raw_text,
    content = 'raw_records',
    content_rowid = 'rowid'
);

----------------------------------------------------------------------
-- 2. Synchronization Triggers
----------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS raw_records_ai AFTER INSERT ON raw_records BEGIN
    INSERT INTO raw_records_fts (rowid, raw_text) VALUES (new.rowid, new.raw_text);
END;

CREATE TRIGGER IF NOT EXISTS raw_records_ad AFTER DELETE ON raw_records BEGIN
    INSERT INTO raw_records_fts (raw_records_fts, rowid, raw_text) VALUES ('delete', old.rowid, old.raw_text);
END;

CREATE TRIGGER IF NOT EXISTS raw_records_au AFTER UPDATE ON raw_records BEGIN
    INSERT INTO raw_records_fts (raw_records_fts, rowid, raw_text) VALUES ('delete', old.rowid, old.raw_text);
    INSERT INTO raw_records_fts (rowid, raw_text) VALUES (new.rowid, new.raw_text);
END;

----------------------------------------------------------------------
-- 3. Initial Population for existing records
----------------------------------------------------------------------
INSERT INTO raw_records_fts (rowid, raw_text)
SELECT rowid, raw_text FROM raw_records
WHERE rowid NOT IN (SELECT rowid FROM raw_records_fts);
