const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// Allow DATA_DIR override via env var (for Railway Volumes or similar)
var DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
var DB_PATH = path.join(DATA_DIR, 'shop.db');

let db = null;

function getDB() {
  if (db) return db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Compatibility layer for existing route code using db.raw.exec()
  db.raw = {
    exec: function(sql) {
      var params = Array.prototype.slice.call(arguments, 1);
      var isSelect = sql.trim().toUpperCase().startsWith('SELECT');
      var stmt = db.prepare(sql);
      if (params.length > 0) {
        var p = Array.isArray(params[0]) ? params[0] : params;
        if (isSelect) {
          return stmt.all.apply(stmt, p);
        }
        return stmt.run.apply(stmt, p);
      }
      if (isSelect) {
        return stmt.all();
      }
      return db.exec(sql);
    }
  };

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


  // Add sizes and colors columns if not present (migration)
  var productCols = db.prepare("PRAGMA table_info(products)").all().map(function(c) { return c.name; });
  if (productCols.indexOf('sizes') === -1) db.exec("ALTER TABLE products ADD COLUMN sizes TEXT DEFAULT ''");
  if (productCols.indexOf('colors') === -1) db.exec("ALTER TABLE products ADD COLUMN colors TEXT DEFAULT ''");
  var oiCols = db.prepare("PRAGMA table_info(order_items)").all().map(function(c) { return c.name; });
  if (oiCols.indexOf('product_size') === -1) db.exec("ALTER TABLE order_items ADD COLUMN product_size TEXT DEFAULT ''");
  if (oiCols.indexOf('product_color') === -1) db.exec("ALTER TABLE order_items ADD COLUMN product_color TEXT DEFAULT ''");
  // Add payment columns to orders
  var ordCols = db.prepare("PRAGMA table_info(orders)").all().map(function(c) { return c.name; });
  if (ordCols.indexOf('payment_method') === -1) db.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT DEFAULT ''");
  if (ordCols.indexOf('payment_status') === -1) db.exec("ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'pending'");
  if (ordCols.indexOf('payment_last5') === -1) db.exec("ALTER TABLE orders ADD COLUMN payment_last5 TEXT DEFAULT ''");

  if (ordCols.indexOf('updated_at') === -1) db.exec("ALTER TABLE orders ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP");

  // Points columns on orders
  if (ordCols.indexOf('points_used') === -1) db.exec("ALTER TABLE orders ADD COLUMN points_used INTEGER NOT NULL DEFAULT 0");
  if (ordCols.indexOf('points_earned') === -1) db.exec("ALTER TABLE orders ADD COLUMN points_earned INTEGER NOT NULL DEFAULT 0");

  // Points columns on employees
  var empCols = db.prepare("PRAGMA table_info(employees)").all().map(function(c) { return c.name; });
  if (empCols.indexOf('store') === -1) db.exec("ALTER TABLE employees ADD COLUMN store TEXT DEFAULT ''");
  if (empCols.indexOf('points') === -1) db.exec("ALTER TABLE employees ADD COLUMN points INTEGER NOT NULL DEFAULT 0");
  if (empCols.indexOf('points_total_earned') === -1) db.exec("ALTER TABLE employees ADD COLUMN points_total_earned INTEGER NOT NULL DEFAULT 0");
  if (empCols.indexOf('points_total_spent') === -1) db.exec("ALTER TABLE employees ADD COLUMN points_total_spent INTEGER NOT NULL DEFAULT 0");

  // Point transactions table
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

  // Cart items table (per-user cart, stored in DB)
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


  // Product variants table (per size/color inventory)
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      size TEXT DEFAULT '',
      color TEXT DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (product_id) REFERENCES products(id),
      UNIQUE(product_id, size, color)
    )
  `);

  // User permissions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      module TEXT NOT NULL,
      action TEXT NOT NULL,
      granted INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      UNIQUE(employee_id, module, action)
    )
  `);  // Products points columns
  if (productCols.indexOf('allow_points_discount') === -1) db.exec("ALTER TABLE products ADD COLUMN allow_points_discount INTEGER NOT NULL DEFAULT 1");
  if (productCols.indexOf('earn_points') === -1) db.exec("ALTER TABLE products ADD COLUMN earn_points INTEGER NOT NULL DEFAULT 1");

  var prodCols2 = db.prepare("PRAGMA table_info(products)").all().map(function(c) { return c.name; });
  if (prodCols2.indexOf('store') === -1) db.exec("ALTER TABLE products ADD COLUMN store TEXT DEFAULT ''");
  if (prodCols2.indexOf('style_code') === -1) db.exec("ALTER TABLE products ADD COLUMN style_code TEXT DEFAULT ''");
  if (prodCols2.indexOf('allow_points_discount') === -1) db.exec("ALTER TABLE products ADD COLUMN allow_points_discount INTEGER NOT NULL DEFAULT 1");
  if (prodCols2.indexOf('earn_points') === -1) db.exec("ALTER TABLE products ADD COLUMN earn_points INTEGER NOT NULL DEFAULT 1");

  // Default admin account
  var row = db.prepare("SELECT id FROM employees WHERE username = ?").get('admin');
  if (!row) {
    var hashed = bcrypt.hashSync('admin123', 10);
    db.prepare("INSERT INTO employees (username, password, display_name, role) VALUES (?, ?, ?, ?)").run('admin', hashed, '\u7ba1\u7406\u54e1', 'admin');
  }

  // Test consumer account
  var test = db.prepare("SELECT id FROM employees WHERE username = ?").get('test');
  if (!test) {
    var hashed = bcrypt.hashSync('test123', 10);
    db.prepare("INSERT INTO employees (username, password, display_name, email, role) VALUES (?, ?, ?, ?, ?)").run('test', hashed, '\u6e2c\u8a66\u6d88\u8cbb\u8005', 'test@shop.local', 'user');
  }


  // Seed default permissions for all non-admin employees
  var allEmployees = db.prepare("SELECT id, role FROM employees WHERE role != 'admin'").all();
  if (allEmployees.length > 0) {
    var defaultModules = ['products', 'orders', 'categories', 'members', 'permissions'];
    var defaultActions = ['create', 'read', 'update', 'delete'];
    var insertPerm = db.prepare('INSERT OR IGNORE INTO user_permissions (employee_id, module, action, granted) VALUES (?, ?, ?, ?)');
    for (var ei = 0; ei < allEmployees.length; ei++) {
      var emp = allEmployees[ei];
      var existingCount = db.prepare('SELECT COUNT(1) as cnt FROM user_permissions WHERE employee_id = ?').get(emp.id);
      if (existingCount.cnt === 0) {
        for (var mi = 0; mi < defaultModules.length; mi++) {
          for (var ai = 0; ai < defaultActions.length; ai++) {
            var action = defaultActions[ai];
            var granted = 1;
            // Default: no delete permission for non-admin
            if (action === 'delete') granted = 0;
            // Default: no permissions management for non-admin
            if (defaultModules[mi] === 'permissions') granted = 0;
            insertPerm.run(emp.id, defaultModules[mi], action, granted);
          }
        }
      }
    }
  }
  return db;
}

module.exports = { getDB };


