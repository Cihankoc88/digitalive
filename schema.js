// ============================================================
//  Acıbadem DigitAlive — Veri Tabanı Şeması (Aşama 2)
//  9 ana tablo + bağlantı tablosu + tam metin arama indeksi
//  Tasarım: Hibrit (indexlenebilir alanlar + JSON detay)
// ============================================================

/**
 * Hibrit yaklaşım:
 * - Her satır için "id" ve sıkça aranan/sıralanan alanlar ayrı sütun
 * - Tüm detay "json_data" sütununda saklı (esneklik için)
 * - Tam metin arama için ayrı FTS5 indeksi
 * - Bağlantılar (task→mail, vb.) için ayrı "links" tablosu
 *
 * Bu yapı 1 milyon+ kayıt için tasarlanmıştır.
 */

const SCHEMA_VERSION = 2;

const SCHEMA_SQL = `
  -- ===== GÖREVLER =====
  CREATE TABLE IF NOT EXISTS tasks (
    id            TEXT PRIMARY KEY,
    title         TEXT,
    status        TEXT,         -- 'acik', 'tamamlandi', 'iptal', 'devredildi'
    priority      TEXT,
    due           TEXT,          -- ISO tarih
    assignee      TEXT,
    archived      INTEGER DEFAULT 0,
    deleted_at    TEXT,
    created_at    TEXT,
    updated_at    TEXT,
    json_data     TEXT NOT NULL  -- Tüm detay: linkedMails, history, subtasks, stakeholders, ...
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status) WHERE deleted_at IS NULL AND archived = 0;
  CREATE INDEX IF NOT EXISTS idx_tasks_due         ON tasks(due) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_tasks_updated     ON tasks(updated_at);
  CREATE INDEX IF NOT EXISTS idx_tasks_assignee    ON tasks(assignee) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_tasks_deleted     ON tasks(deleted_at) WHERE deleted_at IS NOT NULL;

  -- ===== MAİLLER =====
  CREATE TABLE IF NOT EXISTS mails (
    id            TEXT PRIMARY KEY,
    subject       TEXT,
    from_addr     TEXT,
    from_name     TEXT,
    date          TEXT,          -- Mail tarihi
    folder        TEXT,          -- 'inbox', 'sent', 'archive', ...
    is_read       INTEGER DEFAULT 0,
    deleted_at    TEXT,
    created_at    TEXT,
    updated_at    TEXT,
    json_data     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_mails_date        ON mails(date DESC) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_mails_from        ON mails(from_addr) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_mails_folder      ON mails(folder) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_mails_unread      ON mails(is_read) WHERE is_read = 0 AND deleted_at IS NULL;

  -- ===== TOPLANTILAR =====
  CREATE TABLE IF NOT EXISTS meetings (
    id            TEXT PRIMARY KEY,
    title         TEXT,
    type          TEXT,           -- 'meeting', 'event', 'task_review', ...
    date          TEXT,           -- YYYY-MM-DD
    start_time    TEXT,           -- HH:MM
    end_time      TEXT,
    location      TEXT,
    status        TEXT,           -- 'planned', 'done', 'cancelled'
    deleted_at    TEXT,
    created_at    TEXT,
    updated_at    TEXT,
    json_data     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_meetings_date     ON meetings(date) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_meetings_type     ON meetings(type) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_meetings_upcoming ON meetings(date) WHERE deleted_at IS NULL AND status != 'cancelled';

  -- ===== HEDEFLER / PROJELER =====
  CREATE TABLE IF NOT EXISTS goals (
    id            TEXT PRIMARY KEY,
    title         TEXT,
    status        TEXT,
    progress      REAL DEFAULT 0,  -- 0.0 - 1.0
    due           TEXT,
    deleted_at    TEXT,
    created_at    TEXT,
    updated_at    TEXT,
    json_data     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_goals_status      ON goals(status) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_goals_due         ON goals(due) WHERE deleted_at IS NULL;

  -- ===== KARARLAR =====
  CREATE TABLE IF NOT EXISTS decisions (
    id            TEXT PRIMARY KEY,
    title         TEXT,
    reviewed      INTEGER DEFAULT 0,
    review_at     TEXT,           -- Karar gözden geçirme tarihi
    decided_at    TEXT,           -- Karar verme tarihi
    deleted_at    TEXT,
    created_at    TEXT,
    updated_at    TEXT,
    json_data     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_decisions_review  ON decisions(reviewed, review_at);
  CREATE INDEX IF NOT EXISTS idx_decisions_date    ON decisions(decided_at DESC);

  -- ===== NOTLAR =====
  CREATE TABLE IF NOT EXISTS notes (
    id            TEXT PRIMARY KEY,
    title         TEXT,
    note_type     TEXT,           -- 'fikir', 'hatirlatma', 'karar', ...
    deleted_at    TEXT,
    created_at    TEXT,
    updated_at    TEXT,
    json_data     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_updated     ON notes(updated_at DESC) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_notes_type        ON notes(note_type) WHERE deleted_at IS NULL;

  -- ===== KONULAR / KÜMELER =====
  CREATE TABLE IF NOT EXISTS clusters (
    id            TEXT PRIMARY KEY,
    title         TEXT,
    parent_id     TEXT,           -- Hiyerarşi için
    created_at    TEXT,
    updated_at    TEXT,
    json_data     TEXT NOT NULL,
    FOREIGN KEY (parent_id) REFERENCES clusters(id)
  );
  CREATE INDEX IF NOT EXISTS idx_clusters_parent   ON clusters(parent_id);

  -- ===== PAYDAŞLAR (Kişi/Kurum/Birim) =====
  CREATE TABLE IF NOT EXISTS stakeholders (
    id            TEXT PRIMARY KEY,
    name          TEXT,
    org           TEXT,
    role          TEXT,
    email         TEXT,
    phone         TEXT,
    kind          TEXT,           -- 'person', 'org', 'unit'
    created_at    TEXT,
    updated_at    TEXT,
    json_data     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_stakeholders_email ON stakeholders(email);
  CREATE INDEX IF NOT EXISTS idx_stakeholders_name  ON stakeholders(name);
  CREATE INDEX IF NOT EXISTS idx_stakeholders_org   ON stakeholders(org);

  -- ===== DÜŞÜNCE AĞI BAĞLANTILARI (Edges) =====
  CREATE TABLE IF NOT EXISTS edges (
    id            TEXT PRIMARY KEY,
    source_id     TEXT NOT NULL,
    target_id     TEXT NOT NULL,
    edge_kind     TEXT,
    weight        REAL DEFAULT 1.0,
    created_at    TEXT,
    json_data     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_edges_source      ON edges(source_id);
  CREATE INDEX IF NOT EXISTS idx_edges_target      ON edges(target_id);

  -- ===== GENEL BAĞLANTILAR (task ↔ mail, task ↔ meeting, vb.) =====
  CREATE TABLE IF NOT EXISTS links (
    source_type   TEXT NOT NULL,    -- 'task', 'meeting', 'mail', 'goal', ...
    source_id     TEXT NOT NULL,
    target_type   TEXT NOT NULL,
    target_id     TEXT NOT NULL,
    link_kind     TEXT,              -- 'attached', 'related', 'parent', 'child', ...
    position      INTEGER DEFAULT 0,
    created_at    TEXT,
    PRIMARY KEY (source_type, source_id, target_type, target_id, link_kind)
  );
  CREATE INDEX IF NOT EXISTS idx_links_source      ON links(source_type, source_id);
  CREATE INDEX IF NOT EXISTS idx_links_target      ON links(target_type, target_id);

  -- ===== AYARLAR / YAPILANDIRMA =====
  CREATE TABLE IF NOT EXISTS settings (
    key           TEXT PRIMARY KEY,
    value         TEXT,
    updated_at    TEXT
  );

  -- ===== TAM METİN ARAMA (FTS5) =====
  -- Tüm metin arama burada. 1 milyon kayıtta bile saniye 0.01'de cevap.
  -- "unicode61 remove_diacritics 2" → Türkçe karakter normalize (ş↔s, ğ↔g, ...)
  CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    entity_type   UNINDEXED,    -- 'task', 'mail', 'meeting', ...
    entity_id     UNINDEXED,
    title,
    body,
    tags,
    tokenize='unicode61 remove_diacritics 2'
  );
`;

/**
 * Şemayı kurar (varsa atlar, yoksa oluşturur).
 * Tüm tablolar tek bir transaction'da kurulur — ya hepsi ya hiçbiri.
 */
function applySchema(db) {
  const tx = db.transaction(() => {
    db.exec(SCHEMA_SQL);

    // Şema sürümünü _meta'ya yaz
    const setMeta = db.prepare(
      'INSERT INTO _meta (key, value, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    );
    setMeta.run('schema_version', String(SCHEMA_VERSION), new Date().toISOString());
  });
  tx();
}

/**
 * Şema durumunu raporlar — hangi tablolar var, kaç kayıt vb.
 */
function getSchemaInfo(db) {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') " +
    "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_data' " +
    "AND name NOT LIKE '%_idx' AND name NOT LIKE '%_config' " +
    "AND name NOT LIKE '%_docsize' AND name NOT LIKE '%_content' " +
    "ORDER BY name"
  ).all();

  const result = { schema_version: SCHEMA_VERSION, tables: [] };

  for (const t of tables) {
    try {
      const count = db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get();
      result.tables.push({ name: t.name, rows: count.n });
    } catch {
      result.tables.push({ name: t.name, rows: -1 });
    }
  }

  return result;
}

module.exports = {
  SCHEMA_VERSION,
  SCHEMA_SQL,
  applySchema,
  getSchemaInfo,
};
