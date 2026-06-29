/**
 * railway-start.js — Railway 啟動引導腳本
 *
 * 功能：
 *   1. 自動偵測 Railway Volume (/data) 是否已掛載
 *   2. 若未設定 DATA_DIR 但 Volume 已掛載，自動使用 /data
 *   3. 若資料庫不存在但存在備份檔，自動從最新備份還原
 *   4. 啟動 Express 伺服器
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

console.log('=== Railway 啟動引導 ===');

// ── Step 1: 偵測 Volume ──
var volumePath = '/data';
var hasVolume = false;

try {
  if (fs.existsSync(volumePath)) {
    var testFile = path.join(volumePath, '.railway-volume-check');
    fs.writeFileSync(testFile, 'ok', 'utf8');
    fs.unlinkSync(testFile);
    hasVolume = true;
    console.log('[Volume] 已偵測到 Railway Volume: ' + volumePath);
  }
} catch (e) {
  // Volume 存在但不可寫（不應發生）
  console.log('[Volume] 偵測到 ' + volumePath + ' 但無法寫入，將使用預設路徑');
}

if (hasVolume && !process.env.DATA_DIR) {
  process.env.DATA_DIR = volumePath;
  console.log('[Volume] DATA_DIR 未設定，自動設為: ' + volumePath);
}

var DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
console.log('[DB] 資料庫目錄: ' + DATA_DIR);

// 確保目錄存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('[DB] 已建立資料庫目錄');
}

// ── Step 2: 檢查資料庫是否存在，若無則從備份還原 ──
var dbPath = path.join(DATA_DIR, 'shop.db');

if (!fs.existsSync(dbPath)) {
  console.log('[DB] 找不到 shop.db，嘗試從備份還原…');

  var backupDir = DATA_DIR;
  var backupFiles = [];

  try {
    backupFiles = fs.readdirSync(backupDir)
      .filter(function(f) { return f.startsWith('backup-') && f.endsWith('.json'); })
      .sort()
      .reverse();
  } catch (e) {}

  if (backupFiles.length > 0) {
    var latestBackup = path.join(backupDir, backupFiles[0]);
    console.log('[DB] 找到備份: ' + latestBackup);

    // 先讓 db.js 建立資料庫結構
    var { getDB } = require('./db');
    getDB();

    // 執行還原
    var restoreScript = path.join(__dirname, 'scripts', 'restore.js');
    if (fs.existsSync(restoreScript)) {
      console.log('[DB] 正在執行自動還原…');
      try {
        var cp = require('child_process');
        var result = cp.spawnSync('node', [restoreScript], { cwd: __dirname, stdio: 'inherit' });
        if (result.status === 0) {
          console.log('[DB] 備份還原完成');
        } else {
          console.error('[DB] 自動還原程序返回非零狀態碼: ' + result.status);
        }
      } catch (e) {
        console.error('[DB] 自動還原失敗: ' + e.message);
      }
    }
  } else {
    console.log('[DB] 無可用備份，將建立新資料庫');
  }
} else {
  console.log('[DB] 資料庫已存在: ' + dbPath);
}

// ── Step 3: 啟動主程式 ──
console.log('[App] 啟動 Express 伺服器…');
console.log('========================================\n');

// 載入 app.js 啟動伺服器
require('./app');
