// ============================================================
//  Acıbadem DigitAlive — Masaüstü (Electron) ana süreç
//  Tek dosya HTML uygulamasını bir masaüstü penceresinde açar.
//  v1.1: SQLite veri tabanı entegrasyonu eklendi (Aşama 1).
// ============================================================
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const dbModule = require('./db');

let mainWindow = null;
let dbInitOk = false;
let dbInitError = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0a2a6e',
    title: 'Acıbadem DigitAlive — İş Takip',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // v1.1: Preload script — HTML'den SQLite'a güvenli köprü
      preload: path.join(__dirname, 'preload.js'),
      partition: 'persist:digitalive'
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'Digitalive.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  const template = [
    {
      label: 'Dosya',
      submenu: [
        { label: 'Yeniden Yükle', accelerator: 'CmdOrCtrl+R', click: () => mainWindow && mainWindow.reload() },
        { type: 'separator' },
        {
          label: 'Tam Yedek Al (.db dosyası)...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: async () => {
            if (!dbInitOk) {
              dialog.showErrorBox('Yedek başarısız', 'Veri tabanı henüz hazır değil.');
              return;
            }
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const defaultName = `DigitAlive-Yedek-${ts}.db`;
            const result = await dialog.showSaveDialog(mainWindow, {
              title: 'Tam Yedek Al',
              defaultPath: defaultName,
              filters: [{ name: 'SQLite Yedek', extensions: ['db'] }]
            });
            if (result.canceled || !result.filePath) return;
            try {
              await dbModule.backup(result.filePath);
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Yedek Başarılı',
                message: 'Tüm verileriniz başarıyla yedeklendi.',
                detail: 'Konum: ' + result.filePath
              });
            } catch (err) {
              dialog.showErrorBox('Yedek başarısız', err.message);
            }
          }
        },
        {
          label: 'Tam Yedekten Geri Yükle (.db)...',
          click: async () => {
            const confirm = await dialog.showMessageBox(mainWindow, {
              type: 'warning',
              title: 'Geri Yükleme Onayı',
              message: 'Mevcut tüm verileriniz seçtiğiniz yedek dosyasıyla DEĞİŞTİRİLECEK.',
              detail: 'Mevcut veriniz otomatik olarak ek bir yedek dosyasına alınacak (geri dönülebilir). Devam etmek istiyor musunuz?',
              buttons: ['İptal', 'Evet, Geri Yükle'],
              defaultId: 0,
              cancelId: 0
            });
            if (confirm.response !== 1) return;

            const result = await dialog.showOpenDialog(mainWindow, {
              title: 'Yedek Dosyasını Seç',
              properties: ['openFile'],
              filters: [{ name: 'SQLite Yedek', extensions: ['db', 'bak'] }]
            });
            if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;
            try {
              const importResult = await dbModule.importFullBackup(result.filePaths[0]);
              dbInitOk = true;
              const restart = await dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Geri Yükleme Başarılı',
                message: 'Verileriniz geri yüklendi. Tam yansıması için program yeniden başlatılmalı.',
                detail: 'Eski veri yedeği:\n' + importResult.oldBackup,
                buttons: ['Şimdi Başlat', 'Sonra'],
                defaultId: 0
              });
              if (restart.response === 0) {
                app.relaunch();
                app.exit(0);
              }
            } catch (err) {
              dialog.showErrorBox('Geri yükleme başarısız', err.message);
            }
          }
        },
        { type: 'separator' },
        { label: 'Çıkış', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: 'Görünüm',
      submenu: [
        { label: 'Tam Ekran', accelerator: 'F11', role: 'togglefullscreen' },
        { label: 'Yakınlaştır', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Uzaklaştır', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Normal Boyut', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Geliştirici Araçları', accelerator: 'F12', role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Yardım',
      submenu: [
        {
          label: 'Stres Testi: 100.000 Demo Görev Üret...',
          click: async () => {
            if (!dbInitOk) {
              dialog.showErrorBox('Stres testi başarısız', 'Veri tabanı henüz hazır değil.');
              return;
            }
            const confirm = await dialog.showMessageBox(mainWindow, {
              type: 'warning',
              title: 'Stres Testi',
              message: 'Veri tabanına 100.000 sahte görev eklenecek.',
              detail: 'Bu sadece test amaçlıdır. Sonrasında "Demo Verileri Temizle" ile silebilirsiniz. 1-3 dakika sürebilir.\n\nDevam edilsin mi?',
              buttons: ['İptal', 'Evet, Üret'],
              defaultId: 0,
              cancelId: 0
            });
            if (confirm.response !== 1) return;
            try {
              const t0 = Date.now();
              const N = 100000;
              const BATCH = 1000;
              const statuses = ['acik', 'devam', 'beklemede', 'tamamlandi'];
              const priorities = ['yuksek', 'orta', 'dusuk'];
              const now = new Date().toISOString();
              const today = new Date();
              for (let i = 0; i < N; i += BATCH) {
                const rows = [];
                for (let j = 0; j < BATCH && (i + j) < N; j++) {
                  const idx = i + j;
                  const dueDate = new Date(today);
                  dueDate.setDate(dueDate.getDate() + (idx % 30) - 15);
                  const task = {
                    id: 'demo_stress_' + idx,
                    title: 'Stres Testi Görev #' + idx,
                    status: statuses[idx % 4],
                    priority: priorities[idx % 3],
                    due: dueDate.toISOString().slice(0, 10),
                    assignee: 'demo_user_' + (idx % 10),
                    createdAt: now,
                    updatedAt: now,
                    description: 'Demo görev — stres testi için üretildi. Sıra ' + idx + '/' + N
                  };
                  rows.push([
                    task.id, task.title, task.status, task.priority,
                    task.due, task.assignee, 0, null, task.createdAt, task.updatedAt,
                    JSON.stringify(task)
                  ]);
                }
                dbModule.bulkExec(
                  "INSERT OR REPLACE INTO tasks (id, title, status, priority, due, assignee, archived, deleted_at, created_at, updated_at, json_data) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                  rows
                );
              }
              const t1 = Date.now();
              const totalCount = dbModule.queryOne("SELECT COUNT(*) AS c FROM tasks");
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Stres Testi Tamamlandı',
                message: N + ' demo görev veri tabanına eklendi.',
                detail: 'Süre: ' + ((t1 - t0) / 1000).toFixed(1) + ' saniye\n' +
                        'Toplam görev: ' + totalCount.c + '\n\n' +
                        'Şimdi programı yeniden başlat ve Görevler sayfasını aç. ' +
                        'Sanal liste sayesinde akıcı kaymalı.'
              });
            } catch (err) {
              dialog.showErrorBox('Stres testi başarısız', err.message);
            }
          }
        },
        {
          label: 'Demo Verileri Temizle (Stres Testi)',
          click: async () => {
            if (!dbInitOk) return;
            const confirm = await dialog.showMessageBox(mainWindow, {
              type: 'warning',
              title: 'Demo Verileri Temizle',
              message: 'Stres testinden eklenmiş tüm demo görevler silinecek.',
              detail: 'Sadece "demo_stress_" ile başlayan ID\'li görevler silinir. Gerçek verilerin etkilenmez.\n\nDevam edilsin mi?',
              buttons: ['İptal', 'Evet, Sil'],
              defaultId: 0,
              cancelId: 0
            });
            if (confirm.response !== 1) return;
            try {
              const r = dbModule.query("DELETE FROM tasks WHERE id LIKE 'demo_stress_%'");
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Temizlik Tamamlandı',
                message: (r.changes || 0) + ' demo görev silindi.'
              });
            } catch (err) {
              dialog.showErrorBox('Temizlik başarısız', err.message);
            }
          }
        },
        { type: 'separator' },
        { label: 'Acıbadem DigitAlive', enabled: false },
        { label: 'Sürüm 2.0.0 (FINAL — 300K Destekli)', enabled: false }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ============== IPC Handlers — Renderer ↔ DB köprüsü ==============
function registerIpcHandlers() {
  // SELECT sorgusu
  ipcMain.handle('db:query', async (event, sql, params) => {
    if (!dbInitOk) return { ok: false, error: 'Veri tabanı henüz hazır değil.' };
    try {
      return { ok: true, data: dbModule.query(sql, params || []) };
    } catch (err) {
      console.error('[IPC db:query] Hata:', err.message, '\nSQL:', sql);
      return { ok: false, error: err.message };
    }
  });

  // Tek satır SELECT
  ipcMain.handle('db:queryOne', async (event, sql, params) => {
    if (!dbInitOk) return { ok: false, error: 'Veri tabanı henüz hazır değil.' };
    try {
      return { ok: true, data: dbModule.queryOne(sql, params || []) };
    } catch (err) {
      console.error('[IPC db:queryOne] Hata:', err.message);
      return { ok: false, error: err.message };
    }
  });

  // INSERT/UPDATE/DELETE
  ipcMain.handle('db:exec', async (event, sql, params) => {
    if (!dbInitOk) return { ok: false, error: 'Veri tabanı henüz hazır değil.' };
    try {
      return { ok: true, data: dbModule.query(sql, params || []) };
    } catch (err) {
      console.error('[IPC db:exec] Hata:', err.message);
      return { ok: false, error: err.message };
    }
  });

  // Toplu yazma — birden fazla satırı tek transaction'da yazar
  ipcMain.handle('db:bulkExec', async (event, sql, paramsArray) => {
    if (!dbInitOk) return { ok: false, error: 'Veri tabanı henüz hazır değil.' };
    try {
      return { ok: true, data: dbModule.bulkExec(sql, paramsArray || []) };
    } catch (err) {
      console.error('[IPC db:bulkExec] Hata:', err.message);
      return { ok: false, error: err.message };
    }
  });

  // Veri tabanı bilgisi
  ipcMain.handle('db:info', async () => {
    if (!dbInitOk) {
      return { ok: false, error: dbInitError || 'Veri tabanı başlatılamadı.', ready: false };
    }
    try {
      return { ok: true, data: dbModule.getDbInfo() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Hazır mı kontrolü
  ipcMain.handle('db:ready', async () => {
    return { ok: dbInitOk, error: dbInitError, ready: dbInitOk };
  });

  // Yedek alma
  ipcMain.handle('db:backup', async (event, targetPath) => {
    if (!dbInitOk) return { ok: false, error: 'Veri tabanı henüz hazır değil.' };
    try {
      await dbModule.backup(targetPath);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Uygulama veri klasörü
  ipcMain.handle('app:userData', async () => {
    return app.getPath('userData');
  });
}

app.whenReady().then(() => {
  // Önce veri tabanını başlat
  try {
    dbModule.initDatabase();
    dbInitOk = true;
    console.log('[Main] Veri tabanı altyapısı hazır.');
  } catch (err) {
    dbInitError = err.message;
    console.error('[Main] Veri tabanı başlatılamadı:', err);
    // Devam et — eski localStorage hala çalışır, kullanıcı veri kaybetmez
  }

  registerIpcHandlers();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  dbModule.closeDatabase();
  if (process.platform !== 'darwin') app.quit();
});

// Beklenmeyen hatada da DB'yi kapat
app.on('before-quit', () => {
  dbModule.closeDatabase();
});
