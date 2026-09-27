-- Lexical retrieval index over chunks (FTS5, external content, kept in sync by triggers).
CREATE VIRTUAL TABLE IF NOT EXISTS `chunks_fts` USING fts5(title, text, content='chunks', content_rowid='rowid', tokenize='porter unicode61');
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `chunks_ai` AFTER INSERT ON `chunks` BEGIN
  INSERT INTO chunks_fts(rowid, title, text) VALUES (new.rowid, new.title, new.text);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `chunks_ad` AFTER DELETE ON `chunks` BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, title, text) VALUES ('delete', old.rowid, old.title, old.text);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `chunks_au` AFTER UPDATE ON `chunks` BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, title, text) VALUES ('delete', old.rowid, old.title, old.text);
  INSERT INTO chunks_fts(rowid, title, text) VALUES (new.rowid, new.title, new.text);
END;
