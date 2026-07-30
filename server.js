'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'trocar123';
const USING_DEFAULT_PASSWORD = !process.env.ADMIN_PASSWORD;
const STORE_VERSION = 3;
const DEFAULT_WHATSAPP = '5519999200992';
const sessions = new Map();
let mutationQueue = Promise.resolve();

const defaultStore = {
  version: STORE_VERSION,
  sequence: 0,
  settings: {
    businessName: 'Dr. Brownie',
    whatsappNumber: DEFAULT_WHATSAPP,
    deliveryFee: 5,
    minOrder: 0,
    city: 'Jaguariúna',
    maxOrdersPerDate: 20,
    orderWindowDays: 30,
    announcement: 'Entregas somente às sextas, sábados e domingos. Não trabalhamos com retirada no momento.',
    paymentMessage: 'Pagamento via PIX após a confirmação do pedido pelo WhatsApp.'
  },
  products: [
    { id: 'ninho', name: 'Ninho', description: 'Brownie com recheio cremoso de leite Ninho.', cost: 7.5, price: 12, stock: 0, active: true, archived: false, imageData: '' },
    { id: 'nutella', name: 'Nutella', description: 'Brownie com recheio cremoso de Nutella.', cost: 7.5, price: 12, stock: 0, active: true, archived: false, imageData: '' },
    { id: 'cookies', name: 'Cookies', description: 'Brownie com pedaços crocantes de cookies.', cost: 7.5, price: 12, stock: 0, active: true, archived: false, imageData: '' }
  ],
  orders: [],
  closedDates: []
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function migrateLegacyProducts(products, orders) {
  const existing = Array.isArray(products) ? products : [];
  const targets = clone(defaultStore.products);
  const referencedIds = new Set((Array.isArray(orders) ? orders : [])
    .flatMap(order => Array.isArray(order.items) ? order.items : [])
    .map(item => String(item.productId || ''))
    .filter(Boolean));

  const migrated = targets.map(target => {
    const match = existing.find(product => product.id === target.id || slugify(product.name) === target.id);
    return match
      ? { ...target, ...match, id: target.id, name: target.name, active: true, archived: false }
      : target;
  });

  const targetIds = new Set(targets.map(product => product.id));
  const archived = existing
    .filter(product => !targetIds.has(product.id) && referencedIds.has(String(product.id || '')))
    .map(product => ({ ...product, active: false, archived: true }));

  return [...migrated, ...archived];
}

function upgradeStore(input) {
  const store = input && typeof input === 'object' ? input : clone(defaultStore);
  const originalVersion = Math.max(0, Math.floor(finiteNumber(store.version, 0)));
  store.version = STORE_VERSION;
  store.sequence = Math.max(0, Math.floor(finiteNumber(store.sequence, 0)));
  store.settings = { ...defaultStore.settings, ...(store.settings || {}) };
  if (!normalizePhone(store.settings.whatsappNumber)) store.settings.whatsappNumber = DEFAULT_WHATSAPP;
  if (!String(store.settings.businessName || '').trim()) store.settings.businessName = 'Dr. Brownie';
  store.closedDates = Array.isArray(store.closedDates) ? store.closedDates : [];
  store.orders = Array.isArray(store.orders) ? store.orders : [];
  store.products = Array.isArray(store.products) ? store.products : clone(defaultStore.products);
  if (originalVersion < STORE_VERSION) store.products = migrateLegacyProducts(store.products, store.orders);

  for (const product of store.products) {
    product.cost = Math.max(0, finiteNumber(product.cost, 0));
    product.price = Math.max(0, finiteNumber(product.price, 0));
    product.stock = Math.max(0, Math.floor(finiteNumber(product.stock, 0)));
    product.active = product.active !== false;
    product.archived = product.archived === true;
    product.description = String(product.description || '');
    product.imageData = String(product.imageData || '');
  }

  for (const order of store.orders) {
    order.items = Array.isArray(order.items) ? order.items : [];
    for (const item of order.items) {
      const product = store.products.find(productItem => productItem.id === item.productId);
      item.quantity = Math.max(0, Math.floor(finiteNumber(item.quantity, 0)));
      item.price = Math.max(0, finiteNumber(item.price, product ? product.price : 0));
      item.cost = Math.max(0, finiteNumber(item.cost, product ? product.cost : 0));
      item.subtotal = Math.max(0, finiteNumber(item.subtotal, item.price * item.quantity));
      item.costTotal = Math.max(0, finiteNumber(item.costTotal, item.cost * item.quantity));
      item.grossProfit = finiteNumber(item.grossProfit, item.subtotal - item.costTotal);
    }
    order.subtotal = Math.max(0, finiteNumber(order.subtotal, order.items.reduce((sum, item) => sum + item.subtotal, 0)));
    order.deliveryFee = Math.max(0, finiteNumber(order.deliveryFee, 0));
    order.total = Math.max(0, finiteNumber(order.total, order.subtotal + order.deliveryFee));
    order.productCost = Math.max(0, finiteNumber(order.productCost, order.items.reduce((sum, item) => sum + item.costTotal, 0)));
    order.grossProfit = finiteNumber(order.grossProfit, order.subtotal - order.productCost);
    order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    if (order.status === 'delivered' && !order.deliveredAt) order.deliveredAt = order.updatedAt || order.createdAt;
    if (['paid', 'out_for_delivery', 'delivered'].includes(order.status) && !order.paidAt) order.paidAt = order.updatedAt || order.createdAt;
  }
  return store;
}

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) writeStoreSync(clone(defaultStore));
}

function readStore() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    const originalVersion = parsed.version;
    const store = upgradeStore(parsed);
    if (originalVersion !== STORE_VERSION) writeStoreSync(store);
    return store;
  } catch (error) {
    console.error('Falha ao ler store.json:', error);
    const backup = `${STORE_FILE}.corrompido-${Date.now()}`;
    try { fs.copyFileSync(STORE_FILE, backup); } catch (_) {}
    const fresh = clone(defaultStore);
    writeStoreSync(fresh);
    return fresh;
  }
}

function writeStoreSync(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(upgradeStore(store), null, 2), 'utf8');
  fs.renameSync(temp, STORE_FILE);
}

function mutateStore(mutator) {
  const operation = mutationQueue.then(async () => {
    const store = readStore();
    const result = await mutator(store);
    writeStoreSync(store);
    return result;
  });
  mutationQueue = operation.catch(() => undefined);
  return operation;
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index > -1) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  });
  return cookies;
}

function getAdminSession(req) {
  const token = parseCookies(req).drb_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function requireAdmin(req, res) {
  const session = getAdminSession(req);
  if (!session) {
    sendJson(res, 401, { error: 'Sessão administrativa inválida ou expirada.' });
    return false;
  }
  return true;
}

function readJsonBody(req, maxBytes = 3 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('Payload muito grande.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_) {
        reject(Object.assign(new Error('JSON inválido.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits;
}

function formatPhone(value) {
  const digits = normalizePhone(value).replace(/^55/, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return String(value || '');
}

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID();
}

function parseIsoDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isDeliveryDay(date) {
  const parsed = parseIsoDate(date);
  if (!parsed) return false;
  const day = parsed.getUTCDay();
  return day === 5 || day === 6 || day === 0;
}

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function availableDeliveryDates(store) {
  const start = parseIsoDate(todayInSaoPaulo());
  const dates = [];
  const days = Math.max(7, Math.min(90, Number(store.settings.orderWindowDays || 30)));
  for (let offset = 0; offset <= days; offset += 1) {
    const current = new Date(start.getTime() + offset * 86400000);
    const date = current.toISOString().slice(0, 10);
    if (!isDeliveryDay(date)) continue;
    const count = store.orders.filter(order => order.deliveryDate === date && order.status !== 'cancelled').length;
    const closed = store.closedDates.includes(date);
    const max = Math.max(1, Number(store.settings.maxOrdersPerDate || 20));
    dates.push({ date, closed: closed || count >= max, count, remaining: Math.max(0, max - count) });
  }
  return dates;
}

function orderMessage(order, settings) {
  const lines = [
    `*Novo pedido ${settings.businessName || 'Dr. Brownie'} — ${order.id}*`,
    '',
    `*Cliente:* ${order.customer.name}`,
    `*WhatsApp:* ${order.customer.whatsapp}`,
    `*Entrega:* ${formatDate(order.deliveryDate)}`,
    `*Endereço:* ${order.customer.address}`
  ];
  if (order.customer.neighborhood) lines.push(`*Bairro:* ${order.customer.neighborhood}`);
  if (order.customer.reference) lines.push(`*Referência:* ${order.customer.reference}`);
  lines.push('', '*Itens:*');
  lines.push(...order.items.map(item => `• ${item.quantity}x ${item.name} — ${money(item.subtotal)}`));
  lines.push('', `*Subtotal:* ${money(order.subtotal)}`, `*Taxa de entrega:* ${money(order.deliveryFee)}`, `*Total:* ${money(order.total)}`);
  if (order.notes) lines.push('', `*Observações:* ${order.notes}`);
  lines.push('', settings.paymentMessage || 'Pagamento via PIX após a confirmação.');
  return lines.join('\n');
}

function formatDate(date) {
  const parsed = parseIsoDate(date);
  return parsed ? new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(parsed) : date;
}

function publicCatalog(store) {
  return {
    settings: {
      businessName: store.settings.businessName,
      deliveryFee: Number(store.settings.deliveryFee || 0),
      minOrder: Number(store.settings.minOrder || 0),
      city: store.settings.city,
      announcement: store.settings.announcement,
      paymentMessage: store.settings.paymentMessage,
      whatsappConfigured: Boolean(normalizePhone(store.settings.whatsappNumber)),
      whatsappNumber: normalizePhone(store.settings.whatsappNumber),
      whatsappDisplay: formatPhone(store.settings.whatsappNumber)
    },
    products: store.products.filter(product => product.active && !product.archived).map(product => ({
      id: product.id,
      name: product.name,
      description: product.description,
      price: Number(product.price),
      stock: Math.max(0, Number(product.stock)),
      active: Boolean(product.active),
      imageData: product.imageData || ''
    })),
    deliveryDates: availableDeliveryDates(store)
  };
}

function financialStats(store) {
  const delivered = store.orders.filter(order => order.status === 'delivered');
  const totals = delivered.reduce((summary, order) => {
    summary.unitsDelivered += order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    summary.productRevenueDelivered += Number(order.subtotal || 0);
    summary.deliveryRevenueDelivered += Number(order.deliveryFee || 0);
    summary.totalReceivedDelivered += Number(order.total || 0);
    summary.costDelivered += Number(order.productCost || order.items.reduce((sum, item) => sum + Number(item.costTotal || 0), 0));
    return summary;
  }, {
    unitsDelivered: 0,
    productRevenueDelivered: 0,
    deliveryRevenueDelivered: 0,
    totalReceivedDelivered: 0,
    costDelivered: 0
  });
  totals.grossProfitDelivered = totals.productRevenueDelivered - totals.costDelivered;
  totals.marginDelivered = totals.productRevenueDelivered > 0 ? (totals.grossProfitDelivered / totals.productRevenueDelivered) * 100 : 0;
  const currentProducts = store.products.filter(product => !product.archived);
  totals.stockCostValue = currentProducts.reduce((sum, product) => sum + Number(product.cost || 0) * Number(product.stock || 0), 0);
  totals.stockSaleValue = currentProducts.reduce((sum, product) => sum + Number(product.price || 0) * Number(product.stock || 0), 0);
  totals.potentialStockProfit = totals.stockSaleValue - totals.stockCostValue;
  const openOrders = store.orders.filter(order => order.status !== 'cancelled' && order.status !== 'delivered' && order.stockReserved);
  totals.reservedUnits = openOrders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0), 0);
  totals.openOrderProductValue = openOrders.reduce((sum, order) => sum + Number(order.subtotal || 0), 0);
  totals.openOrderCost = openOrders.reduce((sum, order) => sum + Number(order.productCost || 0), 0);
  totals.openOrderPotentialProfit = totals.openOrderProductValue - totals.openOrderCost;
  return totals;
}

function serveStatic(req, res, pathname) {
  let relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  relative = decodeURIComponent(relative);
  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, 'Acesso negado.');
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) return sendText(res, 404, 'Página não encontrada.');
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
    };
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': ['.html', '.css', '.js'].includes(ext) ? 'no-cache' : 'public, max-age=300'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, version: '4.0.0' });
  }

  if (req.method === 'GET' && pathname === '/api/catalog') {
    return sendJson(res, 200, publicCatalog(readStore()));
  }

  if (req.method === 'POST' && pathname === '/api/orders') {
    const body = await readJsonBody(req);
    try {
      const result = await mutateStore(store => {
        const customer = body.customer || {};
        const name = String(customer.name || '').trim();
        const whatsapp = String(customer.whatsapp || '').trim();
        const address = String(customer.address || '').trim();
        const neighborhood = String(customer.neighborhood || '').trim();
        const reference = String(customer.reference || '').trim();
        const deliveryDate = String(body.deliveryDate || '');
        const notes = String(body.notes || '').trim().slice(0, 500);

        if (name.length < 2) throw Object.assign(new Error('Informe seu nome.'), { status: 400 });
        if (normalizePhone(whatsapp).length < 12) throw Object.assign(new Error('Informe um WhatsApp válido com DDD.'), { status: 400 });
        if (address.length < 5) throw Object.assign(new Error('Informe o endereço completo da entrega.'), { status: 400 });
        if (!isDeliveryDay(deliveryDate)) throw Object.assign(new Error('Escolha uma sexta, sábado ou domingo disponível.'), { status: 400 });

        const dateInfo = availableDeliveryDates(store).find(item => item.date === deliveryDate);
        if (!dateInfo || dateInfo.closed) throw Object.assign(new Error('Essa data não está mais disponível para entrega.'), { status: 409 });

        const requested = Array.isArray(body.items) ? body.items : [];
        const itemMap = new Map();
        for (const item of requested) {
          const quantity = Math.floor(Number(item.quantity || 0));
          if (quantity > 0) itemMap.set(String(item.productId), Math.min(99, quantity));
        }
        if (!itemMap.size) throw Object.assign(new Error('Escolha pelo menos um brownie.'), { status: 400 });

        const orderItems = [];
        let subtotal = 0;
        let productCost = 0;
        for (const [productId, quantity] of itemMap.entries()) {
          const product = store.products.find(item => item.id === productId && item.active);
          if (!product) throw Object.assign(new Error('Um dos sabores não está mais disponível.'), { status: 409 });
          if (Number(product.stock) < quantity) throw Object.assign(new Error(`Estoque insuficiente de ${product.name}. Restam ${product.stock}.`), { status: 409 });
          const price = Number(product.price || 0);
          const cost = Number(product.cost || 0);
          const itemSubtotal = price * quantity;
          const itemCost = cost * quantity;
          orderItems.push({
            productId: product.id,
            name: product.name,
            price,
            cost,
            quantity,
            subtotal: itemSubtotal,
            costTotal: itemCost,
            grossProfit: itemSubtotal - itemCost
          });
          subtotal += itemSubtotal;
          productCost += itemCost;
        }

        const minOrder = Number(store.settings.minOrder || 0);
        if (subtotal < minOrder) throw Object.assign(new Error(`O pedido mínimo é ${money(minOrder)}.`), { status: 400 });

        for (const item of orderItems) {
          const product = store.products.find(product => product.id === item.productId);
          product.stock = Math.max(0, Number(product.stock) - item.quantity);
        }

        store.sequence = Number(store.sequence || 0) + 1;
        const id = `DB-${deliveryDate.replace(/-/g, '')}-${String(store.sequence).padStart(4, '0')}`;
        const deliveryFee = Number(store.settings.deliveryFee || 0);
        const now = new Date().toISOString();
        const order = {
          id,
          createdAt: now,
          status: 'pending_payment',
          statusHistory: [{ status: 'pending_payment', at: now }],
          customer: { name, whatsapp, address, neighborhood, reference },
          deliveryDate,
          items: orderItems,
          subtotal,
          productCost,
          grossProfit: subtotal - productCost,
          deliveryFee,
          total: subtotal + deliveryFee,
          notes,
          stockReserved: true
        };
        store.orders.unshift(order);
        const message = orderMessage(order, store.settings);
        const businessPhone = normalizePhone(store.settings.whatsappNumber);
        return {
          order,
          whatsappMessage: message,
          whatsappUrl: businessPhone ? `https://wa.me/${businessPhone}?text=${encodeURIComponent(message)}` : null
        };
      });
      return sendJson(res, 201, result);
    } catch (error) {
      return sendJson(res, error.status || 500, { error: error.message || 'Não foi possível registrar o pedido.' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/admin/login') {
    const body = await readJsonBody(req, 1024 * 20);
    const supplied = String(body.password || '');
    const expectedBuffer = Buffer.from(ADMIN_PASSWORD);
    const suppliedBuffer = Buffer.from(supplied);
    const valid = expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
    if (!valid) return sendJson(res, 401, { error: 'Senha inválida.' });
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
    const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
    return sendJson(res, 200, { ok: true, defaultPassword: USING_DEFAULT_PASSWORD }, {
      'Set-Cookie': `drb_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800${secure}`
    });
  }

  if (req.method === 'POST' && pathname === '/api/admin/logout') {
    const token = parseCookies(req).drb_session;
    if (token) sessions.delete(token);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'drb_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' });
  }

  if (pathname.startsWith('/api/admin/')) {
    if (!requireAdmin(req, res)) return;

    if (req.method === 'GET' && pathname === '/api/admin/dashboard') {
      const store = readStore();
      const stats = {
        pending: store.orders.filter(order => order.status === 'pending_payment').length,
        paid: store.orders.filter(order => order.status === 'paid').length,
        delivered: store.orders.filter(order => order.status === 'delivered').length,
        ...financialStats(store)
      };
      return sendJson(res, 200, { store, deliveryDates: availableDeliveryDates(store), stats, defaultPassword: USING_DEFAULT_PASSWORD });
    }

    if (req.method === 'PUT' && pathname === '/api/admin/settings') {
      const body = await readJsonBody(req);
      const allowed = ['businessName', 'whatsappNumber', 'deliveryFee', 'minOrder', 'city', 'maxOrdersPerDate', 'orderWindowDays', 'announcement', 'paymentMessage'];
      await mutateStore(store => {
        for (const key of allowed) {
          if (Object.prototype.hasOwnProperty.call(body, key)) store.settings[key] = body[key];
        }
        store.settings.deliveryFee = Math.max(0, Number(store.settings.deliveryFee || 0));
        store.settings.minOrder = Math.max(0, Number(store.settings.minOrder || 0));
        store.settings.maxOrdersPerDate = Math.max(1, Math.floor(Number(store.settings.maxOrdersPerDate || 20)));
        store.settings.orderWindowDays = Math.max(7, Math.min(90, Math.floor(Number(store.settings.orderWindowDays || 30))));
      });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/admin/products') {
      const body = await readJsonBody(req);
      const product = await mutateStore(store => {
        const name = String(body.name || '').trim();
        if (!name) throw Object.assign(new Error('Informe o nome do sabor.'), { status: 400 });
        let id = slugify(name);
        while (store.products.some(item => item.id === id)) id = `${id}-${Math.floor(Math.random() * 9999)}`;
        const created = {
          id,
          name,
          description: String(body.description || '').trim(),
          cost: Math.max(0, Number(body.cost || 0)),
          price: Math.max(0, Number(body.price || 0)),
          stock: Math.max(0, Math.floor(Number(body.stock || 0))),
          active: body.active !== false,
          archived: false,
          imageData: String(body.imageData || '').slice(0, 2800000)
        };
        store.products.push(created);
        return created;
      });
      return sendJson(res, 201, { product });
    }

    const productMatch = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
    if (productMatch && req.method === 'PUT') {
      const id = decodeURIComponent(productMatch[1]);
      const body = await readJsonBody(req);
      await mutateStore(store => {
        const product = store.products.find(item => item.id === id);
        if (!product) throw Object.assign(new Error('Sabor não encontrado.'), { status: 404 });
        if (body.name !== undefined) product.name = String(body.name).trim() || product.name;
        if (body.description !== undefined) product.description = String(body.description).trim();
        if (body.cost !== undefined) product.cost = Math.max(0, Number(body.cost || 0));
        if (body.price !== undefined) product.price = Math.max(0, Number(body.price || 0));
        if (body.stock !== undefined) product.stock = Math.max(0, Math.floor(Number(body.stock || 0)));
        if (body.active !== undefined) product.active = Boolean(body.active);
        if (body.imageData !== undefined) product.imageData = String(body.imageData || '').slice(0, 2800000);
      });
      return sendJson(res, 200, { ok: true });
    }

    const orderMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/status$/);
    if (orderMatch && req.method === 'POST') {
      const id = decodeURIComponent(orderMatch[1]);
      const body = await readJsonBody(req, 1024 * 20);
      const allowed = ['pending_payment', 'paid', 'out_for_delivery', 'delivered', 'cancelled'];
      const status = String(body.status || '');
      if (!allowed.includes(status)) return sendJson(res, 400, { error: 'Status inválido.' });
      await mutateStore(store => {
        const order = store.orders.find(item => item.id === id);
        if (!order) throw Object.assign(new Error('Pedido não encontrado.'), { status: 404 });
        if (status === 'cancelled' && order.status !== 'cancelled' && order.stockReserved) {
          for (const item of order.items) {
            const product = store.products.find(product => product.id === item.productId);
            if (product) product.stock = Number(product.stock || 0) + Number(item.quantity || 0);
          }
          order.stockReserved = false;
        }
        if (status !== 'cancelled' && order.status === 'cancelled' && !order.stockReserved) {
          for (const item of order.items) {
            const product = store.products.find(product => product.id === item.productId);
            if (!product || Number(product.stock) < Number(item.quantity)) {
              throw Object.assign(new Error(`Não há estoque suficiente para reativar o pedido ${id}.`), { status: 409 });
            }
          }
          for (const item of order.items) {
            const product = store.products.find(product => product.id === item.productId);
            product.stock -= Number(item.quantity);
          }
          order.stockReserved = true;
        }
        const now = new Date().toISOString();
        order.status = status;
        order.updatedAt = now;
        order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
        order.statusHistory.push({ status, at: now });
        if (status === 'paid' && !order.paidAt) order.paidAt = now;
        if (status === 'out_for_delivery' && !order.paidAt) order.paidAt = now;
        if (status === 'delivered') {
          if (!order.paidAt) order.paidAt = now;
          order.deliveredAt = now;
        }
      });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/admin/dates/toggle') {
      const body = await readJsonBody(req, 1024 * 20);
      const date = String(body.date || '');
      if (!isDeliveryDay(date)) return sendJson(res, 400, { error: 'A data precisa ser sexta, sábado ou domingo.' });
      const closed = await mutateStore(store => {
        const index = store.closedDates.indexOf(date);
        if (index >= 0) {
          store.closedDates.splice(index, 1);
          return false;
        }
        store.closedDates.push(date);
        return true;
      });
      return sendJson(res, 200, { ok: true, closed });
    }
  }

  return sendJson(res, 404, { error: 'Rota não encontrada.' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, error.status || 500, { error: error.message || 'Erro interno.' });
    else res.end();
  }
});

ensureStore();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dr. Brownie Pedidos V4 ativo na porta ${PORT}`);
  if (USING_DEFAULT_PASSWORD) console.warn('ATENÇÃO: defina ADMIN_PASSWORD antes de publicar.');
});
