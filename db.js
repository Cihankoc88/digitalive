// ============================================================
//  Acıbadem DigitAlive — SQLite Veri Katmanı (Aşama 2)
//  v1.2: Veri tabloları şeması eklendi
// ============================================================
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { applySchema, getSchemaInfo, SCHEMA_VERSION } = require('./schema');

let db = null;
let dbPath = null;

/**
 * Veri tabanını başlatır ve şemayı uygular.
 * Veri "userData" klasöründe saklanır:
 *   - Windows: %APPDATA%/Acibadem DigitAlive/digitalive.db
 *   - macOS:   ~/Library/Application Support/Acibadem DigitAlive/digitalive.db
 *   - Linux:   ~/.config/Acibadem DigitAlive/digitalive.db
 */
function initDatabase() {
  const userDataPath = app.getPath('userData');
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }

  dbPath = path.join(userDataPath, 'digitalive.db');
  console.log('[DB] Veri tabanı yolu:', dbPath);

  db = new Database(dbPath);

  // Performans pragmaları
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -64000');     // 64MB önbellek
  db.pragma('temp_store = MEMORY');     // Geçici tablolar bellekte

  // Meta tablosu
  db.exec(`
    CREATE TABLE IF NOT EXISTS _meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    );
  `);

  const setMeta = db.prepare(
    'INSERT INTO _meta (key, value, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  );
  const now = new Date().toISOString();
  setMeta.run('last_started_at', now, now);

  const firstStart = db.prepare('SELECT value FROM _meta WHERE key = ?').get('first_started_at');
  if (!firstStart) {
    setMeta.run('first_started_at', now, now);
  }

  // ===== ŞEMA UYGULAMA =====
  const currentVersion = db.prepare('SELECT value FROM _meta WHERE key = ?').get('schema_version');
  const cv = currentVersion ? parseInt(currentVersion.value, 10) : 0;

  if (cv < SCHEMA_VERSION) {
    console.log(`[DB] Şema sürümü ${cv} → ${SCHEMA_VERSION}. Tablolar kuruluyor...`);
    applySchema(db);
    console.log('[DB] Şema başarıyla uygulandı.');
  } else {
    console.log(`[DB] Şema güncel (sürüm ${cv}).`);
  }

  console.log('[DB] Veri tabanı başarıyla başlatıldı.');
  return db;
}

function getDb() {
  if (!db) throw new Error('Veri tabanı henüz başlatılmadı.');
  return db;
}

function closeDatabase() {
  if (db) {
    try {
      db.close();
      console.log('[DB] Veri tabanı kapatıldı.');
    } catch (err) {
      console.error('[DB] Kapatma hatası:', err);
    }
    db = null;
  }
}

function query(sql, params = []) {
  const stmt = getDb().prepare(sql);
  const sqlUpper = sql.trim().toUpperCase();
  if (sqlUpper.startsWith('SELECT') || sqlUpper.startsWith('PRAGMA') || sqlUpper.startsWith('WITH')) {
    return stmt.all(...params);
  } else {
    const info = stmt.run(...params);
    return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
  }
}

function queryOne(sql, params = []) {
  return getDb().prepare(sql).get(...params);
}

/**
 * Toplu yazma — bir transaction içinde birden fazla satır yazar.
 * Aşama 3'te 300.000 kayıt taşınırken kullanılacak.
 */
function bulkExec(sql, paramsArray) {
  const d = getDb();
  const stmt = d.prepare(sql);
  const tx = d.transaction((items) => {
    let changes = 0;
    for (const p of items) {
      const info = stmt.run(...p);
      changes += info.changes;
    }
    return changes;
  });
  return { changes: tx(paramsArray) };
}

function getDbInfo() {
  const d = getDb();
  return {
    path: dbPath,
    open: d.open,
    inTransaction: d.inTransaction,
    readonly: d.readonly,
    sizeOnDisk: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
    meta: query('SELECT key, value, updated_at FROM _meta ORDER BY key'),
    schema: getSchemaInfo(d),
  };
}

function backup(targetPath) {
  return getDb().backup(targetPath);
}

/**
 * Tam yedekten geri yükleme — bir .db dosyasını içe alır.
 * Önce mevcut veritabanını yedekler, sonra yenisini yerine koyar.
 * Programın yeniden başlatılması önerilir.
 */
async function importFullBackup(sourcePath) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error('Kaynak dosya bulunamadı: ' + sourcePath);
  }

  // Mevcut DB'yi kapat
  if (db) {
    try { db.close(); } catch (e) { console.warn('[DB] Kapatma uyarısı:', e); }
    db = null;
  }

  // Eski dosyayı tarihli yedek olarak sakla (geri dönüş için)
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const oldBackupPath = path.join(path.dirname(dbPath), `digitalive.before-import-${ts}.db.bak`);
  if (fs.existsSync(dbPath)) {
    fs.copyFileSync(dbPath, oldBackupPath);
  }

  // Yeni dosyayı kopyala (üzerine yaz)
  fs.copyFileSync(sourcePath, dbPath);

  // Veritabanını yeniden aç
  initDatabase();

  return {
    ok: true,
    importedFrom: sourcePath,
    oldBackup: oldBackupPath,
    message: 'İçe aktarma tamamlandı. Program yeniden başlatılırsa veriler tam yansır.'
  };
}

module.exports = {
  initDatabase,
  getDb,
  closeDatabase,
  query,
  queryOne,
  bulkExec,
  getDbInfo,
  backup,
  importFullBackup,
};
