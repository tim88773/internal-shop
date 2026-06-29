/**
 * seed.js — 初始化商品資料庫
 *
 * 用法： node seed.js
 *
 * 清除現有商品/分類資料，重新建立完整的商品分類與商品資料。
 * 會員資料、訂單、積點等不受影響。
 */

const path = require('path');
const fs = require('fs');

var DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
var DB_PATH = path.join(DATA_DIR, 'shop.db');

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
// 關閉外鍵約束以允許清空商品/分類
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF');

// 建立/確保所有表存在
// ... (all the CREATE TABLE IF NOT EXISTS from db.js)
db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    display_name TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    original_price REAL,
    category_id INTEGER,
    quantity INTEGER NOT NULL DEFAULT 0,
    defect_reason TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_cover INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS point_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    points INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'earn',
    reference_type TEXT DEFAULT '',
    reference_id INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    selected_size TEXT DEFAULT '',
    selected_color TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id),
    FOREIGN KEY (product_id) REFERENCES products(id),
    UNIQUE(employee_id, product_id, selected_size, selected_color)
  )
`);

// Migration: 補上缺少的欄位
var prodCols = db.prepare("PRAGMA table_info(products)").all().map(function(c) { return c.name; });
if (prodCols.indexOf('sizes') === -1) db.exec("ALTER TABLE products ADD COLUMN sizes TEXT DEFAULT ''");
if (prodCols.indexOf('colors') === -1) db.exec("ALTER TABLE products ADD COLUMN colors TEXT DEFAULT ''");
if (prodCols.indexOf('store') === -1) db.exec("ALTER TABLE products ADD COLUMN store TEXT DEFAULT ''");
if (prodCols.indexOf('allow_points_discount') === -1) db.exec("ALTER TABLE products ADD COLUMN allow_points_discount INTEGER NOT NULL DEFAULT 1");
if (prodCols.indexOf('earn_points') === -1) db.exec("ALTER TABLE products ADD COLUMN earn_points INTEGER NOT NULL DEFAULT 1");

var ordCols = db.prepare("PRAGMA table_info(orders)").all().map(function(c) { return c.name; });
if (ordCols.indexOf('payment_method') === -1) db.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT DEFAULT ''");
if (ordCols.indexOf('payment_status') === -1) db.exec("ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'pending'");
if (ordCols.indexOf('payment_last5') === -1) db.exec("ALTER TABLE orders ADD COLUMN payment_last5 TEXT DEFAULT ''");
if (ordCols.indexOf('updated_at') === -1) db.exec("ALTER TABLE orders ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP");
if (ordCols.indexOf('points_used') === -1) db.exec("ALTER TABLE orders ADD COLUMN points_used INTEGER NOT NULL DEFAULT 0");
if (ordCols.indexOf('points_earned') === -1) db.exec("ALTER TABLE orders ADD COLUMN points_earned INTEGER NOT NULL DEFAULT 0");

var empCols = db.prepare("PRAGMA table_info(employees)").all().map(function(c) { return c.name; });
if (empCols.indexOf('store') === -1) db.exec("ALTER TABLE employees ADD COLUMN store TEXT DEFAULT ''");
if (empCols.indexOf('points') === -1) db.exec("ALTER TABLE employees ADD COLUMN points INTEGER NOT NULL DEFAULT 0");
if (empCols.indexOf('points_total_earned') === -1) db.exec("ALTER TABLE employees ADD COLUMN points_total_earned INTEGER NOT NULL DEFAULT 0");
if (empCols.indexOf('points_total_spent') === -1) db.exec("ALTER TABLE employees ADD COLUMN points_total_spent INTEGER NOT NULL DEFAULT 0");

var oiCols = db.prepare("PRAGMA table_info(order_items)").all().map(function(c) { return c.name; });
if (oiCols.indexOf('product_size') === -1) db.exec("ALTER TABLE order_items ADD COLUMN product_size TEXT DEFAULT ''");
if (oiCols.indexOf('product_color') === -1) db.exec("ALTER TABLE order_items ADD COLUMN product_color TEXT DEFAULT ''");

// ==========================================
//  分類資料
// ==========================================
var categories = [
  { name: '上衣' },
  { name: '褲子' },
  { name: '裙子' },
  { name: '外套' },
  { name: '洋裝' },
  { name: '配件' },
  { name: '特價出清' }
];

// ==========================================
//  商品資料
// ==========================================
var products = [
  { name: '基本款純棉T恤', description: '100% 純棉，透氣舒適，百搭基本款', price: 390, original_price: 590, category: '上衣', quantity: 30, defect_reason: '包裝輕微擠壓', sizes: ['S', 'M', 'L', 'XL'], colors: ['黑色', '白色', '灰色', '藏青'] },
  { name: '條紋休閒襯衫', description: '棉麻混紡，簡約條紋設計，適合日常穿搭', price: 690, original_price: 990, category: '上衣', quantity: 20, defect_reason: '釦子有一顆色差', sizes: ['M', 'L', 'XL'], colors: ['藍白條紋', '灰白條紋'] },
  { name: '素面針織衫', description: '柔軟針織面料，彈性佳，秋冬必備', price: 590, original_price: 890, category: '上衣', quantity: 25, defect_reason: '袖口線頭微鬆', sizes: ['S', 'M', 'L'], colors: ['米白', '駝色', '黑色', '酒紅'] },
  { name: 'V領雪紡上衣', description: '輕盈雪紡材質，V領修飾臉型，適合上班穿搭', price: 490, original_price: 790, category: '上衣', quantity: 15, defect_reason: '內裡標籤稍有脫線', sizes: ['S', 'M', 'L'], colors: ['粉膚', '淺藍', '白色'] },
  { name: '高腰直筒西裝褲', description: '挺版西裝面料，高腰設計修飾腿部線條', price: 890, original_price: 1290, category: '褲子', quantity: 18, defect_reason: '腰間內裡車縫小瑕疵', sizes: ['S', 'M', 'L', 'XL'], colors: ['黑色', '深灰', '卡其'] },
  { name: '寬鬆牛仔褲', description: '彈性丹寧布料，寬鬆版型舒適好穿', price: 990, original_price: 1490, category: '褲子', quantity: 12, defect_reason: '後口袋車線偏移約0.5cm', sizes: ['M', 'L', 'XL'], colors: ['中藍', '深藍', '黑'] },
  { name: '棉麻休閒短褲', description: '透氣棉麻材質，鬆緊帶腰頭，夏日必備', price: 390, original_price: 590, category: '褲子', quantity: 35, defect_reason: '抽繩尾端輕微磨損', sizes: ['S', 'M', 'L', 'XL'], colors: ['卡其', '軍綠', '黑色'] },
  { name: 'A字牛仔裙', description: '經典A字版型，彈性丹寧，修飾臀型', price: 690, original_price: 990, category: '裙子', quantity: 14, defect_reason: '拉鍊頭稍有刮痕', sizes: ['S', 'M', 'L'], colors: ['深藍', '淺藍'] },
  { name: '百褶雪紡裙', description: '細緻百褶設計，飄逸雪紡材質，浪漫優雅', price: 790, original_price: 1190, category: '裙子', quantity: 10, defect_reason: '其中一褶車線稍有歪斜', sizes: ['S', 'M', 'L'], colors: ['黑色', '深藍', '墨綠'] },
  { name: '輕薄防風夾克', description: '輕量化防風材質，可收納至隨行袋中', price: 1290, original_price: 1990, category: '外套', quantity: 8, defect_reason: '拉鍊頭塑膠部分微裂', sizes: ['M', 'L', 'XL'], colors: ['黑色', '軍綠', '藏青'] },
  { name: '羊毛混紡大衣', description: '60% 羊毛混紡，經典雙排釦設計，高質感保暖', price: 2990, original_price: 4500, category: '外套', quantity: 5, defect_reason: '內裡襯布有一處約2cm未縫合', sizes: ['M', 'L'], colors: ['駝色', '黑色', '深灰'] },
  { name: '碎花雪紡洋裝', description: '清新碎花印花，輕柔雪紡材質，附腰帶', price: 890, original_price: 1390, category: '洋裝', quantity: 12, defect_reason: '印花局部顏色稍淡', sizes: ['S', 'M', 'L'], colors: ['藍底白花', '粉底白花'] },
  { name: '修身針織連身裙', description: '彈性針織面料，貼身剪裁展現曲線美', price: 790, original_price: 1190, category: '洋裝', quantity: 10, defect_reason: '下擺車線稍有鬆脫', sizes: ['S', 'M', 'L'], colors: ['黑色', '酒紅', '深藍'] },
  { name: '真皮皮帶', description: '頭層牛皮，簡約金屬釦頭，百搭實用', price: 390, original_price: 690, category: '配件', quantity: 40, defect_reason: '皮帶尾端有輕微刮痕', sizes: [], colors: ['黑色', '棕色'] },
  { name: '絲質圍巾', description: '100% 蠶絲，柔軟光滑，優雅質感', price: 490, original_price: 890, category: '配件', quantity: 22, defect_reason: '邊角有微小勾紗', sizes: [], colors: ['淺灰', '米白', '粉膚', '霧藍'] },
  { name: '展示品—經典風衣（輕微髒污）', description: '門市展示品，機能性防風面料，僅此一件', price: 990, original_price: 3500, category: '特價出清', quantity: 1, defect_reason: '領口有輕微試穿髒污，袖口輕微磨損', sizes: ['M'], colors: ['卡其'] },
  { name: '零碼出清—牛仔襯衫', description: '經典牛仔襯衫，僅剩零碼尺寸，售完不補', price: 290, original_price: 890, category: '特價出清', quantity: 3, defect_reason: '鈕扣孔車線稍有鬆脫', sizes: ['XL'], colors: ['淺藍'] }
];

// ==========================================
//  執行匯入
// ==========================================

// 清空商品與分類 (但保留訂單/會員等)
db.exec('DELETE FROM product_images');
db.exec('DELETE FROM products');
db.exec('DELETE FROM categories');

var catMap = {};

// 插入分類
var insertCat = db.prepare('INSERT INTO categories (name) VALUES (?)');
console.log('===== 匯入分類 =====');
for (var c of categories) {
  var result = insertCat.run(c.name);
  catMap[c.name] = Number(result.lastInsertRowid);
  console.log('  ' + c.name);
}

// 插入商品
var insertProd = db.prepare(`
  INSERT INTO products (name, description, price, original_price, category_id, quantity, defect_reason, sizes, colors, store, allow_points_discount, earn_points, is_active)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

console.log('');
console.log('===== 匯入商品 =====');
for (var p of products) {
  var catId = catMap[p.category] || null;
  insertProd.run(p.name, p.description, p.price, p.original_price || null, catId, p.quantity, p.defect_reason || '', JSON.stringify(p.sizes || []), JSON.stringify(p.colors || []), '', 1, 1, 1);
  console.log('  ' + p.name + ' ($' + p.price + ')');
}

console.log('');
console.log('===== 種子資料匯入完成 =====');
console.log('  分類: ' + categories.length + ' 筆');
console.log('  商品: ' + products.length + ' 筆');
console.log('');
console.log('請重新啟動伺服器: npm start');

db.close();
