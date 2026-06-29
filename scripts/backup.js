/**
 * scripts/backup.js — 匯出所有商品資料為 JSON
 *
 * 用法： node scripts/backup.js
 *
 * 產出： data/backup-YYYY-MM-DD.json
 *        包含 categories, products, product_images
 */

const path = require('path');
const fs = require('fs');
const { getDB } = require('../db');

var DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
var db = getDB();

var backup = {
  exported_at: new Date().toISOString(),
  categories: db.prepare('SELECT * FROM categories').all(),
  products: db.prepare('SELECT * FROM products').all(),
  product_images: db.prepare('SELECT * FROM product_images').all()
};

var filename = 'backup-' + new Date().toISOString().slice(0, 10) + '.json';
var filepath = path.join(DATA_DIR, filename);

fs.writeFileSync(filepath, JSON.stringify(backup, null, 2), 'utf8');
console.log('備份完成: ' + filepath);
console.log('  分類: ' + backup.categories.length + ' 筆');
console.log('  商品: ' + backup.products.length + ' 筆');
console.log('  商品圖片: ' + backup.product_images.length + ' 筆');
