process.chdir('C:\\Users\\Lidai\\Documents\\Codex\\2026-06-05\\ai\\internal-shop');
require('./app');
var http = require('http');
var qs = require('querystring');

var cj = {};

function login() {
  return new Promise(function(r) {
    var b = qs.stringify({username:'admin',password:'admin123'});
    var req = http.request({hostname:'localhost',port:3000,path:'/login',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(b)}},function(res) {
      var sc = res.headers['set-cookie'];
      if (sc) { (Array.isArray(sc)?sc:[sc]).forEach(function(c){var m=c.split(';')[0].split('=');cj[m[0]]=m[1];}); }
      r(res.statusCode);
    });
    req.write(b);req.end();
  });
}

function ag(path) {
  return new Promise(function(r) {
    http.get({hostname:'localhost',port:3000,path:path,headers:{Cookie:Object.entries(cj).map(function(e){return e[0]+'='+e[1]}).join('; ')}},function(res) {
      var d='';res.on('data',function(c){d+=c});res.on('end',function(){r({s:res.statusCode,b:d})});
    });
  });
}

function ap(path,body) {
  return new Promise(function(r) {
    var b = qs.stringify(body);
    var req = http.request({hostname:'localhost',port:3000,path:path,method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(b),Cookie:Object.entries(cj).map(function(e){return e[0]+'='+e[1]}).join('; ')}},function(res) {
      var d='';res.on('data',function(c){d+=c});res.on('end',function(){r({s:res.statusCode,b:d,loc:res.headers.location})});
    });
    req.write(b);req.end();
  });
}

setTimeout(async function() {
  await login();
  await ap('/products/new', {name:'Test KB',description:'KB',price:'299',original_price:'999',quantity:'10',defect_reason:'LED'});
  await ap('/products/new', {name:'Test Mouse',description:'Mouse',price:'149',original_price:'599',quantity:'5',defect_reason:'Scroll'});

  // Check initial stock
  var r = await ag('/products');
  console.log('Initial products page snippet:');
  var idx = r.b.indexOf('Test KB');
  if (idx >= 0) console.log(r.b.substring(idx, idx + 100));
  idx = r.b.indexOf('Test Mouse');
  if (idx >= 0) console.log(r.b.substring(idx, idx + 100));

  // Add to cart
  await ap('/orders/cart/add', {product_id:'1',quantity:'2'});
  await ap('/orders/cart/add', {product_id:'2',quantity:'1'});

  // Checkout
  r = await ap('/orders/checkout', {notes:'Test'});
  console.log('Checkout:', r.s, r.loc);

  // Check stock after order
  r = await ag('/products');
  console.log('After order:');
  var idx = r.b.indexOf('Test KB');
  if (idx >= 0) console.log(r.b.substring(idx, idx + 100));
  idx = r.b.indexOf('Test Mouse');
  if (idx >= 0) console.log(r.b.substring(idx, idx + 100));

  process.exit(0);
}, 1500);
