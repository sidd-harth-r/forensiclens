-- ForensicLens Migration 004: claim_confidence
-- Migration: 004_claim_confidence.sql
-- Database target: SQLite 3.35+
-- Specification: Step 9 Phase E — Confidence Persistence
--
-- Adds nullable REAL confidence column to claims table with range constraint [0.0, 1.0].

ALTER TABLE claims ADD COLUMN confidence REAL CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0));
