/**
 * scripts/restore.js — 從 JSON 備份還原商品資料
 *
 * 用法： node scripts/restore.js [檔案路徑]
 *       預設還原最新 backup-*.json
 *
 * 只影響 categories, products, product_images 表，
 * 不影響會員、訂單、積點等資料。
 */

const path = require('path');
const fs = require('fs');
const { getDB } = require('../db');

var DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
var db = getDB();

// 決定要載入的檔案
var filepath = process.argv[2];
if (!filepath) {
  var files = fs.readdirSync(DATA_DIR)
    .filter(function(f) { return f.startsWith('backup-') && f.endsWith('.json'); })
    .sort()
    .reverse();
  if (files.length === 0) {
    console.error('找不到備份檔案！');
    console.error('請指定檔案路徑: node scripts/restore.js data/backup-2026-01-01.json');
    process.exit(1);
  }
  filepath = path.join(DATA_DIR, files[0]);
  console.log('使用最新備份: ' + filepath);
} else {
  filepath = path.resolve(filepath);
}

if (!fs.existsSync(filepath)) {
  console.error('找不到檔案: ' + filepath);
  process.exit(1);
}

var backup = JSON.parse(fs.readFileSync(filepath, 'utf8'));

console.log('備份時間: ' + backup.exported_at);
console.log('分類: ' + backup.categories.length + ' 筆');
console.log('商品: ' + backup.products.length + ' 筆');
console.log('商品圖片: ' + backup.product_images.length + ' 筆');
console.log('');

// 還原分類
db.exec('DELETE FROM product_images');
db.exec('DELETE FROM products');
db.exec('DELETE FROM categories');

var insertCat = db.prepare('INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)');
for (var c of backup.categories) {
  insertCat.run(c.id, c.name, c.created_at);
}

// 還原商品
var insertProd = db.prepare(`
  INSERT INTO products (id, name, description, price, original_price, category_id, quantity, defect_reason, is_active, image_url, created_at, updated_at, sizes, colors, store, allow_points_discount, earn_points)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
for (var p of backup.products) {
  insertProd.run(
    p.id, p.name, p.description || '', p.price, p.original_price,
    p.category_id, p.quantity, p.defect_reason || '', p.is_active,
    p.image_url, p.created_at, p.updated_at,
    p.sizes || '[]', p.colors || '[]', p.store || '',
    p.allow_points_discount != null ? p.allow_points_discount : 1,
    p.earn_points != null ? p.earn_points : 1
  );
}

// 還原商品圖片
var insertImg = db.prepare('INSERT INTO product_images (id, product_id, image_url, sort_order, is_cover) VALUES (?, ?, ?, ?, ?)');
for (var img of backup.product_images) {
  insertImg.run(img.id, img.product_id, img.image_url, img.sort_order, img.is_cover || 0);
}

console.log('===== 還原完成 =====');
console.log('請重新啟動伺服器以套用變更');
