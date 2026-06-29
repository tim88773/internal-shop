const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { getDB } = require('../db');

// Upload directory: use DATA_DIR volume on Railway, local public/uploads otherwise
var UPLOAD_DIR = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'uploads')
  : path.join(__dirname, '..', 'public', 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    req.flash('error', '\u6b0a\u9650\u4e0d\u8db3');
    return res.redirect('/products');
  }
  next();
}

// Multer configs
var imageStorage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: function(req, file, cb) {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, Date.now() + '-' + require('crypto').randomBytes(6).toString('hex') + ext);
  }
});
var uploadImages = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});
var uploadFields = uploadImages.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'gallery', maxCount: 10 }
]);

var excelStorage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: function(req, file, cb) {
    cb(null, 'import-' + Date.now() + '-' + require('crypto').randomBytes(4).toString('hex') + '.xlsx');
  }
});
var uploadExcel = multer({
  storage: excelStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ext === '.xlsx' || ext === '.xls');
  }
});

// Helpers
function getProductImages(db, productId) {
  return db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order').all(Number(productId));
}

function parseYesNo(val) {
  if (val == null) return 1;
  if (typeof val === 'number') return val ? 1 : 0;
  var s = String(val).trim();
  if (s === '1' || s === '\u662f' || s === 'Y' || s === 'y' || s === 'YES' || s === 'yes') return 1;
  return 0;
}

// ============================================
//  Import routes (must be before /:id)
// ============================================

router.get('/import/template', requireAdmin, function(req, res) {
  var workbook = new ExcelJS.Workbook();
  var sheet = workbook.addWorksheet('\u5546\u54c1\u5c0e\u5165');

  sheet.columns = [
    { header: '\u5206\u985e', key: 'category', width: 14 },
    { header: '\u5546\u54c1\u540d\u7a31', key: 'name', width: 28 },
    { header: '\u63cf\u8ff0', key: 'description', width: 36 },
    { header: '\u552e\u50f9', key: 'price', width: 12 },
    { header: '\u539f\u50f9', key: 'original_price', width: 12 },
    { header: '\u5eab\u5b58', key: 'quantity', width: 10 },
    { header: '\u7f3a\u9677\u539f\u56e0', key: 'defect_reason', width: 26 },
    { header: '\u5c3a\u5bf8', key: 'sizes', width: 18 },
    { header: '\u984f\u8272', key: 'colors', width: 18 },
    { header: '\u6b3e\u5f0f\u865f\u78bc', key: 'style_code', width: 16 },
    { header: '\u6240\u5c6c\u9580\u5e02', key: 'store', width: 14 },
    { header: '\u958b\u653e\u7a4d\u9ede\u6298\u62b5', key: 'allow_points', width: 16 },
    { header: '\u8cfc\u8cb7\u53ef\u7372\u5f97\u7a4d\u9ede', key: 'earn_points', width: 18 }
  ];

  var headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC98686' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  sheet.addRow({ category: '\u4e0a\u8863', name: '\u7d14\u68c9T\u6064', description: '100% \u7d14\u68c9\uff0c\u900f\u6c23\u8212\u9069', price: 390, original_price: 590, quantity: 30, defect_reason: '\u5305\u88dd\u8f15\u5fae\u58d3\u640f', sizes: 'S, M, L, XL', colors: '\u9ed1\u8272, \u767d\u8272', store: '\u53f0\u5317\u9580\u5e02', allow_points: '\u662f', earn_points: '\u662f' });
  sheet.addRow({ category: '\u8932\u5b50', name: '\u725b\u4ed4\u8932', description: '\u5f48\u6027\u4e39\u5be7\uff0c\u5bec\u9b06\u7248\u578b', price: 990, original_price: 1490, quantity: 12, sizes: 'M, L, XL', colors: '\u4e2d\u85cd, \u6df1\u85cd', allow_points: '\u5426', earn_points: '\u662f' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="product_import_template.xlsx"');

  workbook.xlsx.write(res).then(function() { res.end(); });
});

router.get('/import', requireAdmin, function(req, res) {
  res.render('products/import', { title: 'Excel \u5c0e\u5165\u5546\u54c1' });
});

router.post('/import', requireAdmin, uploadExcel.single('excel_file'), function(req, res) {
  if (!req.file) {
    req.flash('error', '\u8acb\u9078\u64c7\u4e00\u500b Excel \u6a94\u6848');
    return res.redirect('/products/import');
  }

  var db = getDB();
  var filepath = req.file.path;
  var clearFirst = req.body.clear_first === '1';
  var result = { total: 0, success: 0, errors: [], warnings: [] };

  (async function() {
    try {
      var workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filepath);
      processWorkbook(db, workbook, clearFirst, result);
    } catch (err) {
      result.errors.push('\u7121\u6cd5\u8b80\u53d6 Excel \u6a94\uff1a' + err.message);
    }
  })().then(function() {
    try { fs.unlinkSync(filepath); } catch(e) {}

    if (result.errors.length > 0) {
      req.flash('error', '\u5c0e\u5165\u5b8c\u6210\uff0c\u4f46\u6709 ' + result.errors.length + ' \u7b46\u932f\u8aa4\uff1a' + result.errors.slice(0, 5).join('; '));
    }
    req.flash('success', '\u5c0e\u5165\u5b8c\u6210\uff01\u7e3d\u8a08 ' + result.total + ' \u7b46\uff0c\u6210\u529f ' + result.success + ' \u7b46' + (result.warnings.length > 0 ? '\uff0c\u8b66\u544a ' + result.warnings.length + ' \u7b46' : ''));
    res.redirect('/products/manage');
  }).catch(function(err) {
    try { fs.unlinkSync(filepath); } catch(e) {}
    req.flash('error', '\u5c0e\u5165\u5931\u6557\uff1a' + err.message);
    res.redirect('/products/import');
  });
});

function processWorkbook(db, workbook, clearFirst, result) {
  var sheet = workbook.worksheets[0];
  if (!sheet) {
    result.errors.push('Excel \u6a94\u6c92\u6709\u5de5\u4f5c\u7a3f');
    return;
  }

  var headerRow = sheet.getRow(1);
  var headers = [];
  headerRow.eachCell({ includeEmpty: false }, function(cell, colNumber) {
    headers[colNumber] = String(cell.value || '').trim();
  });

  var colMap = {};
  var headerMap = {
    '\u5206\u985e': 'category',
    '\u5546\u54c1\u540d\u7a31': 'name',
    '\u63cf\u8ff0': 'description',
    '\u552e\u50f9': 'price',
    '\u539f\u50f9': 'original_price',
    '\u5eab\u5b58': 'quantity',
    '\u7f3a\u9677\u539f\u56e0': 'defect_reason',
    '\u5c3a\u5bf8': 'sizes',
    '\u984f\u8272': 'colors',
    '\u6b3e\u5f0f\u865f\u78bc': 'style_code',
    '\u6240\u5c6c\u9580\u5e02': 'store',
    '\u958b\u653e\u7a4d\u9ede\u6298\u62b5': 'allow_points',
    '\u8cfc\u8cb7\u53ef\u7372\u5f97\u7a4d\u9ede': 'earn_points'
  };

  for (var col = 1; col < headers.length; col++) {
    var h = headers[col];
    if (h && headerMap[h] !== undefined) {
      colMap[headerMap[h]] = col;
    }
  }

  if (!colMap['name'] || !colMap['price']) {
    result.errors.push('\u6b20\u7f3a\u5fc5\u586b\u6b04\u4f4d: \u5546\u54c1\u540d\u7a31\u548c\u552e\u50f9');
    return;
  }

  // Disable FK to allow clearing
  db.pragma('foreign_keys = OFF');

  if (clearFirst) {
    db.exec('DELETE FROM product_images');
    db.exec('DELETE FROM products');
    db.exec('DELETE FROM categories');
  }

  var insertProd = db.prepare('INSERT INTO products (name, description, price, original_price, category_id, quantity, defect_reason, sizes, colors, store, style_code, allow_points_discount, earn_points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  var findCat = db.prepare('SELECT id FROM categories WHERE name = ?');
  var createCat = db.prepare('INSERT INTO categories (name) VALUES (?)');

  var rowCount = sheet.rowCount;

  for (var r = 2; r <= rowCount; r++) {
    var row = sheet.getRow(r);
    if (!row) continue;

    result.total++;

    try {
      var name = getCellStr(row, colMap['name']);
      if (!name) {
        result.warnings.push('\u884c ' + r + ': \u5546\u54c1\u540d\u7a31\u70ba\u7a7a\uff0c\u8df3\u904e');
        continue;
      }

      var price = parseFloat(getCellStr(row, colMap['price'])) || 0;
      var original_price = parseFloat(getCellStr(row, colMap['original_price'])) || null;
      var quantity = parseInt(getCellStr(row, colMap['quantity'])) || 1;
      var description = getCellStr(row, colMap['description']) || '';
      var defect_reason = getCellStr(row, colMap['defect_reason']) || '';
      var store = getCellStr(row, colMap['store']) || '';
      var style_code = getCellStr(row, colMap['style_code']) || '';
      var sizes = getCellStr(row, colMap['sizes']) || '';
      var colors = getCellStr(row, colMap['colors']) || '';

      var sizesArr = sizes.split(',').map(function(s){return s.trim();}).filter(function(s){return s;});
      var colorsArr = colors.split(',').map(function(s){return s.trim();}).filter(function(s){return s;});

      var allowPts = parseYesNo(getCellRaw(row, colMap['allow_points']));
      var earnPts = parseYesNo(getCellRaw(row, colMap['earn_points']));

      var categoryId = null;
      var categoryName = getCellStr(row, colMap['category']);
      if (categoryName) {
        var catRow = findCat.get(categoryName);
        if (catRow) {
          categoryId = catRow.id;
        } else {
          var catResult = createCat.run(categoryName);
          categoryId = Number(catResult.lastInsertRowid);
        }
      }

      insertProd.run(name, description, price, original_price, categoryId, quantity, defect_reason, JSON.stringify(sizesArr), JSON.stringify(colorsArr), store, style_code || '', allowPts, earnPts);
      result.success++;
    } catch (err) {
      result.errors.push('\u884c ' + r + ': ' + err.message);
    }
  }
}

function getCellStr(row, col) {
  if (!col) return '';
  var cell = row.getCell(col);
  var val = cell.value;
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    if (val.richText) {
      return val.richText.map(function(rt) { return rt.text || ''; }).join('').trim();
    }
    // Handle formula objects: { formula: '...', result: '...' }
    if (val.result !== undefined && val.result !== null) {
      return String(val.result).trim();
    }
    // Date or other object - try toString or fall back to empty
    var str = val.toString();
    if (str && str !== '[object Object]') return str.trim();
    return '';
  }
  return String(val).trim();
}

function getCellRaw(row, col) {
  if (!col) return null;
  var val = row.getCell(col).value;
  if (typeof val === 'object' && val !== null && val.richText) {
    return val.richText.map(function(rt) { return rt.text || ''; }).join('');
  }
  return val;
}


// ============================================
//  Variant helpers
// ============================================

function getVariants(db, productId) {
  return db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY size, color').all(productId);
}

function calcTotalVariantQuantity(db, productId) {
  var row = db.prepare('SELECT COALESCE(SUM(quantity),0) as total FROM product_variants WHERE product_id = ?').get(productId);
  return row ? row.total : 0;
}

function saveVariants(db, productId, variantsText) {
  // Delete existing variants
  db.raw.exec('DELETE FROM product_variants WHERE product_id = ?', [productId]);
  // Parse each line: size, color, qty
  var lines = (variantsText || '').split(String.fromCharCode(10,13).replace(/[^0-9A-Za-z\u4e00-\u9fff,\s]/g,String.fromCharCode(10))).filter(Boolean);
  // Simpler approach: split by newline
  var rows = variantsText.split(/\r?\n/).filter(Boolean);
  var insertV = db.prepare('INSERT INTO product_variants (product_id, size, color, quantity) VALUES (?, ?, ?, ?)');
  for (var i = 0; i < rows.length; i++) {
    var parts = rows[i].split(',').map(function(s){return s.trim();});
    if (parts.length >= 3) {
      var sz = parts[0] || '';
      var cl = parts[1] || '';
      var qty = parseInt(parts[2]) || 0;
      if (qty > 0) {
        insertV.run(productId, sz, cl, qty);
      }
    }
  }
  // Update the product's global quantity to sum of variants
  var total = calcTotalVariantQuantity(db, productId);
  db.raw.exec('UPDATE products SET quantity = ? WHERE id = ?', [total, productId]);
  return total;
}
// ============================================
//  Regular routes
// ============================================

router.get('/', requireAuth, (req, res) => {
  const db = getDB();
  const categoryId = req.query.category || null;
  const search = req.query.search || '';

  let sql = `
    SELECT p.*, c.name as category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.is_active = 1
  `;
  const params = [];

  if (categoryId) {
    sql += ' AND p.category_id = ?';
    params.push(Number(categoryId));
  }
  if (search) {
    sql += ' AND (p.name LIKE ? OR p.description LIKE ?)';
    params.push('%' + search + '%', '%' + search + '%');
  }
  sql += ' ORDER BY p.created_at DESC';

  const products = params.length ? db.prepare(sql).all(...params) : db.prepare(sql).all();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();

  res.render('products/index', { title: '\u5546\u54c1\u700f\u89bd', products, categories, search, categoryId: categoryId || '' });
});

router.get('/manage', requireAdmin, (req, res) => {
  const db = getDB();
  const products = db.prepare(`
    SELECT p.*, c.name as category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.created_at DESC
  `).all();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();

  res.render('products/manage', { title: '\u5546\u54c1\u7ba1\u7406', products, categories });
});

router.get('/new', requireAdmin, (req, res) => {
  const db = getDB();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('products/new', { title: '\u65b0\u589e\u5546\u54c1', categories, product: {} });
});

router.post('/new', requireAdmin, uploadFields, (req, res) => {
  const { name, description, price, original_price, category_id, quantity, defect_reason } = req.body;

  if (!name || price === undefined || price === '') {
    req.flash('error', '\u5546\u54c1\u540d\u7a31\u8207\u50f9\u683c\u70ba\u5fc5\u586b');
    return res.redirect('/products/new');
  }

  const db = getDB();

  var coverUrl = '';
  if (req.files && req.files.cover && req.files.cover.length > 0) {
    coverUrl = '/uploads/' + req.files.cover[0].filename;
  } else if (req.files && req.files.gallery && req.files.gallery.length > 0) {
    coverUrl = '/uploads/' + req.files.gallery[0].filename;
  }

  var storeVal = req.body.store || '';
  var sizesArr = (req.body.sizes || '').split(',').map(function(s){return s.trim();}).filter(function(s){return s;});
  var colorsArr = (req.body.colors || '').split(',').map(function(s){return s.trim();}).filter(function(s){return s;});
  var allowPts = req.body.allow_points_discount ? 1 : 0;
  var earnPts = req.body.earn_points ? 1 : 0;

  var insertResult = db.prepare('INSERT INTO products (name, description, price, original_price, category_id, quantity, defect_reason, store, image_url, sizes, colors, style_code, allow_points_discount, earn_points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    name, description || '', parseFloat(price) || 0,
    original_price ? parseFloat(original_price) : null,
    category_id ? Number(category_id) : null,
    0,
    defect_reason || '',
    storeVal,
    req.body.style_code || '',
    coverUrl || null,
    JSON.stringify(sizesArr),
    JSON.stringify(colorsArr),
    allowPts,
    earnPts
  );

  var pid = Number(insertResult.lastInsertRowid);

  // Handle variants
  saveVariants(db, pid, req.body.variants || '');

  if (req.files && req.files.gallery) {
    var galleryFiles = req.files.gallery;
    var startIdx = (!req.files.cover || req.files.cover.length === 0) && galleryFiles.length > 0 ? 1 : 0;
    for (var i = startIdx; i < galleryFiles.length; i++) {
      var url = '/uploads/' + galleryFiles[i].filename;
      db.raw.exec('INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)', [pid, url, i - startIdx]);
    }
  }

  req.flash('success', '\u5546\u54c1\u300c' + name + '\u300d\u5df2\u4e0a\u67b6');
  res.redirect('/products/manage');
});

router.get('/:id', requireAuth, (req, res) => {
  const db = getDB();
  var pid = Number(req.params.id);
  const product = db.prepare(`
    SELECT p.*, c.name as category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = ?
  `).get(pid);

  if (!product) {
    req.flash('error', '\u627e\u4e0d\u5230\u8a72\u5546\u54c1');
    return res.redirect('/products');
  }

  const images = getProductImages(db, pid);
  const related = db.prepare('SELECT * FROM products WHERE is_active = 1 AND id != ? ORDER BY created_at DESC LIMIT 4').all(pid);

  var inCart = 0;
  var cartItem = db.prepare('SELECT quantity FROM cart_items WHERE employee_id = ? AND product_id = ?').get(req.session.user.id, pid);
  if (cartItem) inCart = cartItem.quantity;

  var productSizes = []; var productColors = [];
  try { productSizes = JSON.parse(product.sizes || '[]'); } catch(e) {}
  try { productColors = JSON.parse(product.colors || '[]'); } catch(e) {}
  res.render('products/detail', { title: product.name, product, images, related, inCart, productSizes: productSizes, productColors: productColors });
});

router.get('/:id/edit', requireAdmin, (req, res) => {
  const db = getDB();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!product) {
    req.flash('error', '\u627e\u4e0d\u5230\u8a72\u5546\u54c1');
    return res.redirect('/products/manage');
  }
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  const images = getProductImages(db, Number(req.params.id));
  var pSizes = []; var pColors = [];
  try { pSizes = JSON.parse(product.sizes || '').join(', '); } catch(e) {}
  try { pColors = JSON.parse(product.colors || '').join(', '); } catch(e) {}
  var variants = getVariants(db, Number(req.params.id));
  var variantsText = variants.map(function(v) { return v.size + ', ' + v.color + ', ' + v.quantity; }).join('\n');
  res.render('products/edit', { title: '\u7de8\u8f2f\u5546\u54c1', product, categories, images, editSizes: pSizes, editColors: pColors, variants, variantsText: variantsText });
});

router.post('/:id/edit', requireAdmin, uploadFields, (req, res) => {
  const { name, description, price, original_price, category_id, quantity, defect_reason, is_active } = req.body;

  if (!name || price === undefined || price === '') {
    req.flash('error', '\u5546\u54c1\u540d\u7a31\u8207\u50f9\u683c\u70ba\u5fc5\u586b');
    return res.redirect('/products/' + req.params.id + '/edit');
  }

  const db = getDB();
  var pid = Number(req.params.id);

  var updates = [];
  var params = [];

  updates.push('name = ?'); params.push(name);
  updates.push('description = ?'); params.push(description || '');
  updates.push('price = ?'); params.push(parseFloat(price) || 0);
  updates.push('original_price = ?'); params.push(original_price ? parseFloat(original_price) : null);
  updates.push('category_id = ?'); params.push(category_id ? Number(category_id) : null);
  updates.push('quantity = ?'); params.push(parseInt(quantity) || 0);
  updates.push('defect_reason = ?'); params.push(defect_reason || '');
  updates.push('store = ?'); params.push(req.body.store || '');
  updates.push('is_active = ?'); params.push(is_active ? 1 : 0);
  var sizesArr2 = (req.body.sizes || '').split(',').map(function(s){return s.trim();}).filter(function(s){return s;});
  var colorsArr2 = (req.body.colors || '').split(',').map(function(s){return s.trim();}).filter(function(s){return s;});
  updates.push('sizes = ?'); params.push(JSON.stringify(sizesArr2));
  updates.push('colors = ?'); params.push(JSON.stringify(colorsArr2));
  updates.push('allow_points_discount = ?'); params.push(req.body.allow_points_discount ? 1 : 0);
  updates.push('earn_points = ?'); params.push(req.body.earn_points ? 1 : 0);
  updates.push('style_code = ?'); params.push(req.body.style_code || '');

  if (req.files && req.files.cover && req.files.cover.length > 0) {
    updates.push('image_url = ?');
    params.push('/uploads/' + req.files.cover[0].filename);
  }
  if (req.files && req.files.gallery && req.files.gallery.length > 0) {
    db.raw.exec('DELETE FROM product_images WHERE product_id = ?', [pid]);
    for (var i = 0; i < req.files.gallery.length; i++) {
      var url = '/uploads/' + req.files.gallery[i].filename;
      db.raw.exec('INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)', [pid, url, i]);
    }
  }

  params.push(pid);
  db.raw.exec('UPDATE products SET ' + updates.join(', ') + ', updated_at = CURRENT_TIMESTAMP WHERE id = ?', params);

  // Save variants
  saveVariants(db, pid, req.body.variants || '');

  req.flash('success', '\u5546\u54c1\u300c' + name + '\u300d\u5df2\u66f4\u65b0');
  res.redirect('/products/manage');
});

router.post('/:id/toggle', requireAdmin, (req, res) => {
  const db = getDB();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!product) {
    req.flash('error', '\u627e\u4e0d\u5230\u8a72\u5546\u54c1');
    return res.redirect('/products/manage');
  }
  db.raw.exec('UPDATE products SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [product.is_active ? 0 : 1, Number(req.params.id)]);
  var action = product.is_active ? '\u4e0b\u67b6' : '\u4e0a\u67b6';
  req.flash('success', '\u5546\u54c1\u300c' + product.name + '\u300d\u5df2' + action);
  res.redirect('/products/manage');
});


// ---- Batch delete ----
router.post('/batch-delete', requireAdmin, (req, res) => {
  const db = getDB();
  var idsRaw = req.body.ids;
  if (!idsRaw) {
    req.flash('error', '\u8acb\u9078\u64c7\u81f3\u5c11\u4e00\u500b\u5546\u54c1');
    return res.redirect('/products/manage');
  }
  var ids;
  try { ids = JSON.parse(idsRaw); } catch(e) { ids = [idsRaw]; }
  if (!Array.isArray(ids)) ids = [ids];
  ids = ids.map(Number).filter(function(id) { return id > 0; });

  if (ids.length === 0) {
    req.flash('error', '\u7121\u6548\u7684\u5546\u54c1\u7de8\u865f');
    return res.redirect('/products/manage');
  }

  var deleted = 0;
  for (var i = 0; i < ids.length; i++) {
    var pid = ids[i];
    db.raw.exec('DELETE FROM product_images WHERE product_id = ?', [pid]);
    db.raw.exec('DELETE FROM product_variants WHERE product_id = ?', [pid]);
    db.raw.exec('DELETE FROM cart_items WHERE product_id = ?', [pid]);
    db.raw.exec('DELETE FROM order_items WHERE product_id = ?', [pid]);
    db.raw.exec('DELETE FROM products WHERE id = ?', [pid]);
    deleted++;
  }
  req.flash('success', '\u5df2\u522a\u9664 ' + deleted + ' \u500b\u5546\u54c1');
  res.redirect('/products/manage');
});


// ---- Individual delete ----
router.post('/:id/delete', requireAdmin, (req, res) => {
  const db = getDB();
  var pid = Number(req.params.id);
  var product = db.prepare('SELECT name FROM products WHERE id = ?').get(pid);
  if (!product) {
    req.flash('error', '找不到該商品');
    return res.redirect('/products/manage');
  }
  db.raw.exec('DELETE FROM product_images WHERE product_id = ?', [pid]);
  db.raw.exec('DELETE FROM product_variants WHERE product_id = ?', [pid]);
  db.raw.exec('DELETE FROM cart_items WHERE product_id = ?', [pid]);
  db.raw.exec('DELETE FROM order_items WHERE product_id = ?', [pid]);
  db.raw.exec('DELETE FROM products WHERE id = ?', [pid]);
  req.flash('success', '商品「' + product.name + '」已刪除');
  res.redirect('/products/manage');
});

module.exports = router;


