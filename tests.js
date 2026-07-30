'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-brownie-v2-'));
const port = 32000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(port), DATA_DIR: tempDir, ADMIN_PASSWORD: 'teste-seguro' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let logs = '';
child.stdout.on('data', chunk => { logs += chunk; });
child.stderr.on('data', chunk => { logs += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return response.json();
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Servidor não iniciou. Logs: ${logs}`);
}

async function json(url, options = {}) {
  const response = await fetch(`${base}${url}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${data.error || 'Erro'}`);
  return { response, data };
}

(async () => {
  try {
    const health = await waitForServer();
    assert.strictEqual(health.version, '4.0.0');

    const login = await json('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'teste-seguro' })
    });
    const cookie = login.response.headers.get('set-cookie').split(';')[0];
    assert(cookie.startsWith('drb_session='));

    await json('/api/admin/products/ninho', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ cost: 7.5, price: 12, stock: 10, active: true })
    });

    const catalog = (await json('/api/catalog')).data;
    assert.deepStrictEqual(catalog.products.map(product => product.id), ['ninho', 'nutella', 'cookies']);
    assert.strictEqual(catalog.settings.whatsappNumber, '5519999200992');
    assert.strictEqual(catalog.settings.whatsappDisplay, '(19) 99920-0992');
    const deliveryDate = catalog.deliveryDates.find(item => !item.closed)?.date;
    assert(deliveryDate, 'Deve haver uma data de entrega disponível.');

    const created = (await json('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: {
          name: 'Cliente Teste',
          whatsapp: '19999999999',
          address: 'Rua de Teste, 100',
          neighborhood: 'Centro',
          reference: ''
        },
        deliveryDate,
        notes: '',
        items: [{ productId: 'ninho', quantity: 2 }]
      })
    })).data;

    assert.strictEqual(created.order.subtotal, 24);
    assert.strictEqual(created.order.productCost, 15);
    assert.strictEqual(created.order.grossProfit, 9);
    assert.strictEqual(created.order.items[0].cost, 7.5);
    assert.strictEqual(created.order.items[0].costTotal, 15);
    assert(created.whatsappUrl.startsWith('https://wa.me/5519999200992'));
    assert.strictEqual((await json('/api/catalog')).data.products.find(product => product.id === 'ninho').stock, 8);

    await json(`/api/admin/orders/${encodeURIComponent(created.order.id)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'cancelled' })
    });
    assert.strictEqual((await json('/api/catalog')).data.products.find(product => product.id === 'ninho').stock, 10);

    await json(`/api/admin/orders/${encodeURIComponent(created.order.id)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'pending_payment' })
    });
    assert.strictEqual((await json('/api/catalog')).data.products.find(product => product.id === 'ninho').stock, 8);

    await json(`/api/admin/orders/${encodeURIComponent(created.order.id)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'delivered' })
    });

    const dashboard = (await json('/api/admin/dashboard', { headers: { Cookie: cookie } })).data;
    assert.strictEqual(dashboard.stats.unitsDelivered, 2);
    assert.strictEqual(dashboard.stats.productRevenueDelivered, 24);
    assert.strictEqual(dashboard.stats.deliveryRevenueDelivered, 5);
    assert.strictEqual(dashboard.stats.totalReceivedDelivered, 29);
    assert.strictEqual(dashboard.stats.costDelivered, 15);
    assert.strictEqual(dashboard.stats.grossProfitDelivered, 9);
    assert.strictEqual(dashboard.store.products.find(product => product.id === 'ninho').stock, 8);

    const adminJs = fs.readFileSync(path.join(__dirname, 'public', 'admin.js'), 'utf8');
    const adminHtml = fs.readFileSync(path.join(__dirname, 'public', 'admin.html'), 'utf8');
    assert(adminHtml.includes('Preço de custo'));
    assert(adminHtml.includes('Financeiro'));
    assert(adminJs.includes('Lucro bruto dos produtos'));
    assert(adminJs.includes('const formElement = event.currentTarget'));
    assert(!adminJs.includes('event.currentTarget.reset()'));
    assert(adminHtml.includes('/admin.js?v=4'));
    assert(fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').includes('Finalizar pedido'));
    assert(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8').includes('day === 5 || day === 6 || day === 0'));

    console.log('Testes completos da V4 aprovados: login, sabores, WhatsApp, estoque, cancelamento, venda e lucro.');
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
