'use strict';

let dashboardData = null;
let currentImageData = '';
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percentage = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const deliveryDateFormatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

const loginCard = document.querySelector('#loginCard');
const dashboard = document.querySelector('#dashboard');

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && url !== '/api/admin/login') showLogin();
    throw new Error(data.error || 'Não foi possível concluir a operação.');
  }
  return data;
}

function showLogin() {
  loginCard.hidden = false;
  dashboard.hidden = true;
}

function showDashboard() {
  loginCard.hidden = true;
  dashboard.hidden = false;
}

async function loadDashboard() {
  try {
    dashboardData = await api('/api/admin/dashboard');
    showDashboard();
    document.querySelector('#securityWarning').hidden = !dashboardData.defaultPassword;
    renderStats();
    renderOrders();
    renderFinance();
    renderProducts();
    renderDates();
    fillSettings();
    updateProfitPreview();
  } catch (_) {
    showLogin();
  }
}

function renderStats() {
  const stats = dashboardData.stats;
  const cards = [
    ['Aguardando pagamento', stats.pending],
    ['Pedidos pagos', stats.paid],
    ['Brownies entregues', stats.unitsDelivered],
    ['Vendas dos produtos', currency.format(stats.productRevenueDelivered)],
    ['Custo dos vendidos', currency.format(stats.costDelivered)],
    ['Lucro bruto', currency.format(stats.grossProfitDelivered)],
    ['Taxas de entrega', currency.format(stats.deliveryRevenueDelivered)],
    ['Estoque atual a custo', currency.format(stats.stockCostValue)],
    ['Unidades reservadas', stats.reservedUnits],
    ['Pedidos abertos em produtos', currency.format(stats.openOrderProductValue)]
  ];
  document.querySelector('#statsGrid').innerHTML = cards
    .map(([label, value]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join('');
}

function statusLabel(status) {
  return ({
    pending_payment: 'Aguardando pagamento',
    paid: 'Pago',
    out_for_delivery: 'Saiu para entrega',
    delivered: 'Entregue',
    cancelled: 'Cancelado'
  })[status] || status;
}

function itemCostTotal(item) {
  return Number(item.costTotal ?? (Number(item.cost || 0) * Number(item.quantity || 0)));
}

function orderProductCost(order) {
  return Number(order.productCost ?? order.items.reduce((sum, item) => sum + itemCostTotal(item), 0));
}

function orderGrossProfit(order) {
  return Number(order.grossProfit ?? (Number(order.subtotal || 0) - orderProductCost(order)));
}

function renderOrders() {
  const filter = document.querySelector('#orderFilter').value;
  const orders = dashboardData.store.orders.filter(order => filter === 'all' || order.status === filter);
  const container = document.querySelector('#ordersList');
  if (!orders.length) {
    container.innerHTML = '<div class="panel-card"><strong>Nenhum pedido nesta situação.</strong></div>';
    return;
  }
  container.innerHTML = orders.map(order => `
    <article class="order-card">
      <div class="order-card__top">
        <div>
          <h3>${escapeHtml(order.customer.name)} — ${escapeHtml(order.id)}</h3>
          <div class="order-meta">
            <span>${dateTime.format(new Date(order.createdAt))}</span>
            <span>Entrega: ${capitalize(deliveryDateFormatter.format(new Date(`${order.deliveryDate}T12:00:00Z`)))}</span>
            <span>${escapeHtml(order.customer.whatsapp)}</span>
          </div>
        </div>
        <span class="status-badge status-${order.status}">${statusLabel(order.status)}</span>
      </div>
      <div class="order-items">
        ${order.items.map(item => `<div class="order-item-line"><span>${item.quantity}x ${escapeHtml(item.name)} — ${currency.format(item.subtotal)}</span><small>Custo: ${currency.format(itemCostTotal(item))} • Lucro: ${currency.format(Number(item.subtotal || 0) - itemCostTotal(item))}</small></div>`).join('')}
        <div class="order-financial-summary">
          <span>Produtos: <strong>${currency.format(order.subtotal)}</strong></span>
          <span>Entrega: <strong>${currency.format(order.deliveryFee)}</strong></span>
          <span>Custo: <strong>${currency.format(orderProductCost(order))}</strong></span>
          <span>Lucro bruto dos produtos: <strong>${currency.format(orderGrossProfit(order))}</strong></span>
          <span>Total cobrado: <strong>${currency.format(order.total)}</strong></span>
        </div>
      </div>
      <p><strong>Endereço:</strong> ${escapeHtml(order.customer.address)}${order.customer.neighborhood ? ` — ${escapeHtml(order.customer.neighborhood)}` : ''}</p>
      ${order.customer.reference ? `<p><strong>Referência:</strong> ${escapeHtml(order.customer.reference)}</p>` : ''}
      ${order.notes ? `<p><strong>Observações:</strong> ${escapeHtml(order.notes)}</p>` : ''}
      <div class="order-actions">
        ${order.status !== 'paid' ? `<button class="small-button" data-order="${order.id}" data-status="paid">Marcar pago</button>` : ''}
        ${order.status !== 'out_for_delivery' && order.status !== 'cancelled' ? `<button class="small-button" data-order="${order.id}" data-status="out_for_delivery">Saiu para entrega</button>` : ''}
        ${order.status !== 'delivered' && order.status !== 'cancelled' ? `<button class="small-button" data-order="${order.id}" data-status="delivered">Marcar entregue</button>` : ''}
        ${order.status !== 'cancelled' ? `<button class="small-button" data-order="${order.id}" data-status="cancelled">Cancelar e devolver estoque</button>` : `<button class="small-button" data-order="${order.id}" data-status="pending_payment">Reativar pedido</button>`}
      </div>
    </article>`).join('');

  container.querySelectorAll('button[data-order]').forEach(button => button.addEventListener('click', () => updateOrder(button.dataset.order, button.dataset.status)));
}

async function updateOrder(id, status) {
  if (status === 'cancelled' && !confirm('Cancelar este pedido e devolver os itens ao estoque?')) return;
  try {
    await api(`/api/admin/orders/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    await loadDashboard();
  } catch (error) { alert(error.message); }
}

function periodStart(period) {
  const now = new Date();
  if (period === 'all') return null;
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === '7d') return new Date(now.getTime() - 6 * 86400000);
  return new Date(now.getTime() - 29 * 86400000);
}

function deliveredDate(order) {
  const value = order.deliveredAt || order.updatedAt || order.createdAt;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function financialOrdersForPeriod() {
  const start = periodStart(document.querySelector('#financePeriod').value);
  return dashboardData.store.orders.filter(order => order.status === 'delivered' && (!start || deliveredDate(order) >= start));
}

function renderFinance() {
  const allStats = dashboardData.stats;
  document.querySelector('#openOrdersSummary').innerHTML = `<strong>Pedidos ainda abertos:</strong> ${allStats.reservedUnits} unidades reservadas • ${currency.format(allStats.openOrderProductValue)} em produtos • ${currency.format(allStats.openOrderCost)} de custo • ${currency.format(allStats.openOrderPotentialProfit)} de lucro potencial.`;
  const orders = financialOrdersForPeriod();
  const totals = {
    orders: orders.length,
    units: 0,
    productRevenue: 0,
    deliveryRevenue: 0,
    totalReceived: 0,
    cost: 0,
    grossProfit: 0
  };
  const flavors = new Map();

  for (const order of orders) {
    totals.productRevenue += Number(order.subtotal || 0);
    totals.deliveryRevenue += Number(order.deliveryFee || 0);
    totals.totalReceived += Number(order.total || 0);
    totals.cost += orderProductCost(order);
    for (const item of order.items) {
      const quantity = Number(item.quantity || 0);
      const revenue = Number(item.subtotal || 0);
      const cost = itemCostTotal(item);
      totals.units += quantity;
      const current = flavors.get(item.productId) || { name: item.name, quantity: 0, revenue: 0, cost: 0, profit: 0 };
      current.quantity += quantity;
      current.revenue += revenue;
      current.cost += cost;
      current.profit += revenue - cost;
      flavors.set(item.productId, current);
    }
  }
  totals.grossProfit = totals.productRevenue - totals.cost;
  const margin = totals.productRevenue > 0 ? totals.grossProfit / totals.productRevenue * 100 : 0;

  const cards = [
    ['Pedidos entregues', totals.orders],
    ['Unidades vendidas', totals.units],
    ['Faturamento dos produtos', currency.format(totals.productRevenue)],
    ['Taxas de entrega', currency.format(totals.deliveryRevenue)],
    ['Total recebido', currency.format(totals.totalReceived)],
    ['Custo das unidades vendidas', currency.format(totals.cost)],
    ['Lucro bruto dos produtos', currency.format(totals.grossProfit)],
    ['Margem bruta', `${percentage.format(margin)}%`]
  ];
  document.querySelector('#financeStatsGrid').innerHTML = cards.map(([label, value]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong></article>`).join('');

  const flavorRows = [...flavors.values()].sort((a, b) => b.quantity - a.quantity);
  document.querySelector('#flavorReport').innerHTML = flavorRows.length
    ? flavorRows.map(item => `
      <article class="report-row">
        <div><strong>${escapeHtml(item.name)}</strong><span>${item.quantity} unidades vendidas</span></div>
        <div class="report-values"><span>Venda ${currency.format(item.revenue)}</span><span>Custo ${currency.format(item.cost)}</span><strong>Lucro ${currency.format(item.profit)}</strong></div>
      </article>`).join('')
    : '<p class="muted">Ainda não há pedidos entregues neste período.</p>';

  const stockRows = dashboardData.store.products.map(product => {
    const stock = Number(product.stock || 0);
    const costValue = Number(product.cost || 0) * stock;
    const saleValue = Number(product.price || 0) * stock;
    return { ...product, stock, costValue, saleValue, potentialProfit: saleValue - costValue };
  }).sort((a, b) => b.costValue - a.costValue);

  const stockCost = stockRows.reduce((sum, item) => sum + item.costValue, 0);
  const stockSale = stockRows.reduce((sum, item) => sum + item.saleValue, 0);
  document.querySelector('#stockReport').innerHTML = stockRows.map(item => `
    <article class="report-row">
      <div><strong>${escapeHtml(item.name)}</strong><span>${item.stock} unidades em estoque</span></div>
      <div class="report-values"><span>Investido ${currency.format(item.costValue)}</span><span>Venda possível ${currency.format(item.saleValue)}</span><strong>Lucro possível ${currency.format(item.potentialProfit)}</strong></div>
    </article>`).join('') + `
    <article class="report-total"><span>Total atual</span><strong>${currency.format(stockCost)} investidos • ${currency.format(stockSale)} em venda possível</strong></article>`;
}

function renderProducts() {
  const container = document.querySelector('#productsAdminList');
  container.innerHTML = dashboardData.store.products.map(product => {
    const profit = Number(product.price || 0) - Number(product.cost || 0);
    const stockCost = Number(product.cost || 0) * Number(product.stock || 0);
    return `
      <article class="admin-product-card">
        <div class="admin-product-card__content">
          ${product.imageData ? `<img class="admin-product-thumb" src="${product.imageData}" alt="">` : '<div class="admin-product-thumb">🍫</div>'}
          <div>
            <h3>${escapeHtml(product.name)}</h3>
            <div class="order-meta">
              <span>Custo: ${currency.format(product.cost || 0)}</span>
              <span>Venda: ${currency.format(product.price)}</span>
              <span>Lucro/un.: ${currency.format(profit)}</span>
              <span>${product.stock} em estoque</span>
              <span>Investido: ${currency.format(stockCost)}</span>
              <span>${product.active ? 'Visível' : 'Oculto'}</span>
            </div>
          </div>
        </div>
        <button class="small-button" data-edit-product="${product.id}">Editar</button>
      </article>`;
  }).join('');
  container.querySelectorAll('button[data-edit-product]').forEach(button => button.addEventListener('click', () => editProduct(button.dataset.editProduct)));
}

function editProduct(id) {
  const product = dashboardData.store.products.find(item => item.id === id);
  if (!product) return;
  const form = document.querySelector('#productForm');
  form.elements.id.value = product.id;
  form.elements.name.value = product.name;
  form.elements.description.value = product.description || '';
  form.elements.cost.value = Number(product.cost || 0).toFixed(2);
  form.elements.price.value = Number(product.price || 0).toFixed(2);
  form.elements.stock.value = product.stock;
  form.elements.active.checked = Boolean(product.active);
  currentImageData = product.imageData || '';
  const preview = document.querySelector('#imagePreview');
  preview.src = currentImageData;
  preview.hidden = !currentImageData;
  document.querySelector('#productFormTitle').textContent = 'Editar sabor';
  updateProfitPreview();
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetProductForm() {
  const form = document.querySelector('#productForm');
  form.reset();
  form.elements.id.value = '';
  form.elements.active.checked = true;
  currentImageData = '';
  document.querySelector('#imagePreview').hidden = true;
  document.querySelector('#productFormTitle').textContent = 'Novo sabor';
  document.querySelector('#productFeedback').textContent = '';
  updateProfitPreview();
}

function updateProfitPreview() {
  const form = document.querySelector('#productForm');
  const cost = Number(form.elements.cost.value || 0);
  const price = Number(form.elements.price.value || 0);
  const profit = price - cost;
  const margin = price > 0 ? profit / price * 100 : 0;
  document.querySelector('#profitPreview').textContent = `Lucro unitário estimado: ${currency.format(profit)} • Margem: ${percentage.format(margin)}%`;
}

function renderDates() {
  const container = document.querySelector('#datesList');
  container.innerHTML = dashboardData.deliveryDates.map(item => {
    const formatted = capitalize(deliveryDateFormatter.format(new Date(`${item.date}T12:00:00Z`)));
    const manuallyClosed = dashboardData.store.closedDates.includes(item.date);
    return `<article class="date-card ${item.closed ? 'closed' : ''}">
      <strong>${formatted}</strong>
      <span>${item.count} pedidos • ${item.remaining} vagas</span>
      <button class="small-button" data-date="${item.date}">${manuallyClosed ? 'Reabrir data' : 'Fechar data'}</button>
    </article>`;
  }).join('');
  container.querySelectorAll('button[data-date]').forEach(button => button.addEventListener('click', () => toggleDate(button.dataset.date)));
}

async function toggleDate(date) {
  try {
    await api('/api/admin/dates/toggle', { method: 'POST', body: JSON.stringify({ date }) });
    await loadDashboard();
  } catch (error) { alert(error.message); }
}

function fillSettings() {
  const form = document.querySelector('#settingsForm');
  Object.entries(dashboardData.store.settings).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value ?? '';
  });
}

async function readImage(file) {
  if (!file) return currentImageData;
  if (file.size > 2 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 2 MB.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

function setupTabs() {
  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab-button').forEach(item => item.classList.toggle('active', item === button));
      document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${button.dataset.tab}`));
      if (button.dataset.tab === 'finance') renderFinance();
    });
  });
}

document.querySelector('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const feedback = document.querySelector('#loginFeedback');
  feedback.textContent = '';
  try {
    const form = new FormData(event.currentTarget);
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: form.get('password') }) });
    event.currentTarget.reset();
    await loadDashboard();
  } catch (error) { feedback.textContent = error.message; }
});

document.querySelector('#logoutButton').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  showLogin();
});

document.querySelector('#orderFilter').addEventListener('change', renderOrders);
document.querySelector('#financePeriod').addEventListener('change', renderFinance);

document.querySelector('#productForm').addEventListener('submit', async event => {
  event.preventDefault();
  const feedback = document.querySelector('#productFeedback');
  feedback.textContent = '';
  try {
    const form = event.currentTarget;
    const imageFile = form.elements.image.files[0];
    const imageData = await readImage(imageFile);
    const payload = {
      name: form.elements.name.value,
      description: form.elements.description.value,
      cost: Number(form.elements.cost.value),
      price: Number(form.elements.price.value),
      stock: Number(form.elements.stock.value),
      active: form.elements.active.checked,
      imageData
    };
    const id = form.elements.id.value;
    await api(id ? `/api/admin/products/${encodeURIComponent(id)}` : '/api/admin/products', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    resetProductForm();
    await loadDashboard();
    feedback.textContent = 'Sabor salvo com custo, preço e estoque.';
    feedback.classList.add('success');
  } catch (error) {
    feedback.classList.remove('success');
    feedback.textContent = error.message;
  }
});

document.querySelector('#productForm').elements.image.addEventListener('change', async event => {
  const preview = document.querySelector('#imagePreview');
  try {
    currentImageData = await readImage(event.target.files[0]);
    preview.src = currentImageData;
    preview.hidden = !currentImageData;
  } catch (error) { alert(error.message); event.target.value = ''; }
});

document.querySelector('#productForm').elements.cost.addEventListener('input', updateProfitPreview);
document.querySelector('#productForm').elements.price.addEventListener('input', updateProfitPreview);
document.querySelector('#cancelProductEdit').addEventListener('click', resetProductForm);

document.querySelector('#settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  const feedback = document.querySelector('#settingsFeedback');
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.deliveryFee = Number(payload.deliveryFee);
  payload.minOrder = Number(payload.minOrder);
  payload.maxOrdersPerDate = Number(payload.maxOrdersPerDate);
  payload.orderWindowDays = Number(payload.orderWindowDays);
  try {
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) });
    feedback.textContent = 'Configurações salvas.';
    feedback.classList.add('success');
    await loadDashboard();
  } catch (error) {
    feedback.classList.remove('success');
    feedback.textContent = error.message;
  }
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}
function capitalize(value) { return value.charAt(0).toUpperCase() + value.slice(1); }

setupTabs();
loadDashboard();
