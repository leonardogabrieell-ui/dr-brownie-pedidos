'use strict';

const state = { catalog: null, quantities: {} };
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' });

const elements = {
  products: document.querySelector('#products'),
  cartItems: document.querySelector('#cartItems'),
  subtotal: document.querySelector('#subtotal'),
  deliveryFee: document.querySelector('#deliveryFee'),
  total: document.querySelector('#total'),
  itemCount: document.querySelector('#itemCount'),
  orderForm: document.querySelector('#orderForm'),
  deliveryDate: document.querySelector('#deliveryDate'),
  submitButton: document.querySelector('#submitButton'),
  feedback: document.querySelector('#formFeedback'),
  successModal: document.querySelector('#successModal'),
  successText: document.querySelector('#successText'),
  whatsappButton: document.querySelector('#whatsappButton')
};

async function loadCatalog() {
  try {
    const response = await fetch('/api/catalog', { cache: 'no-store' });
    if (!response.ok) throw new Error('Não foi possível carregar o cardápio.');
    state.catalog = await response.json();
    document.querySelector('#businessName').textContent = state.catalog.settings.businessName || 'Dr. Brownie';
    document.querySelector('#announcement').textContent = state.catalog.settings.announcement;
    document.querySelector('#paymentMessage').textContent = state.catalog.settings.paymentMessage;
    document.title = `${state.catalog.settings.businessName || 'Dr. Brownie'} — Pedidos`;
    renderProducts();
    renderDeliveryDates();
    renderCart();
  } catch (error) {
    elements.products.innerHTML = `<div class="panel-card"><strong>Cardápio indisponível</strong><p class="muted">${escapeHtml(error.message)}</p></div>`;
  }
}

function renderProducts() {
  const products = state.catalog.products;
  if (!products.length) {
    elements.products.innerHTML = '<div class="panel-card"><strong>Cardápio em atualização.</strong><p class="muted">Volte em breve para conferir os sabores disponíveis.</p></div>';
    return;
  }
  elements.products.innerHTML = products.map(product => {
    const quantity = state.quantities[product.id] || 0;
    const out = product.stock <= 0;
    const stockClass = out ? 'out' : product.stock <= 3 ? 'low' : '';
    const stockText = out ? 'Esgotado' : product.stock <= 3 ? `Últimas ${product.stock} unidades` : `${product.stock} disponíveis`;
    const image = product.imageData
      ? `<img src="${product.imageData}" alt="${escapeHtml(product.name)}">`
      : '<div class="product-placeholder" aria-hidden="true">🍫</div>';
    return `
      <article class="product-card">
        <div class="product-card__image">${image}</div>
        <div class="product-card__body">
          <div class="product-card__top"><h3>${escapeHtml(product.name)}</h3><span class="price">${currency.format(product.price)}</span></div>
          <p>${escapeHtml(product.description || 'Brownie artesanal preparado com muito chocolate.')}</p>
          <div class="product-card__footer">
            <span class="stock-label ${stockClass}">${stockText}</span>
            <div class="quantity-control" aria-label="Quantidade de ${escapeHtml(product.name)}">
              <button type="button" data-action="minus" data-id="${product.id}" ${quantity <= 0 ? 'disabled' : ''}>−</button>
              <span>${quantity}</span>
              <button type="button" data-action="plus" data-id="${product.id}" ${out || quantity >= product.stock ? 'disabled' : ''}>+</button>
            </div>
          </div>
        </div>
      </article>`;
  }).join('');

  elements.products.querySelectorAll('button[data-action]').forEach(button => {
    button.addEventListener('click', () => changeQuantity(button.dataset.id, button.dataset.action === 'plus' ? 1 : -1));
  });
}

function changeQuantity(id, delta) {
  const product = state.catalog.products.find(item => item.id === id);
  if (!product) return;
  const current = state.quantities[id] || 0;
  state.quantities[id] = Math.max(0, Math.min(product.stock, current + delta));
  renderProducts();
  renderCart();
}

function selectedItems() {
  return state.catalog.products
    .map(product => ({ ...product, quantity: state.quantities[product.id] || 0 }))
    .filter(product => product.quantity > 0);
}

function renderCart() {
  const items = selectedItems();
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const fee = count ? Number(state.catalog.settings.deliveryFee || 0) : 0;
  elements.itemCount.textContent = count;
  elements.cartItems.innerHTML = items.length
    ? items.map(item => `<div class="cart-line"><span>${item.quantity}x ${escapeHtml(item.name)}</span><span>${currency.format(item.price * item.quantity)}</span></div>`).join('')
    : '<p class="muted">Selecione pelo menos um brownie.</p>';
  elements.subtotal.textContent = currency.format(subtotal);
  elements.deliveryFee.textContent = currency.format(fee);
  elements.total.textContent = currency.format(subtotal + fee);
}

function renderDeliveryDates() {
  const available = state.catalog.deliveryDates.filter(item => !item.closed);
  elements.deliveryDate.innerHTML = '<option value="">Escolha uma data</option>' + available.map(item => {
    const date = new Date(`${item.date}T12:00:00Z`);
    const label = capitalize(dateFormatter.format(date));
    const capacity = item.remaining <= 3 ? ` — ${item.remaining} vagas` : '';
    return `<option value="${item.date}">${label}${capacity}</option>`;
  }).join('');
  if (!available.length) {
    elements.deliveryDate.innerHTML = '<option value="">Agenda temporariamente fechada</option>';
    elements.deliveryDate.disabled = true;
  }
}

async function submitOrder(event) {
  event.preventDefault();
  elements.feedback.textContent = '';
  const items = selectedItems();
  if (!items.length) {
    elements.feedback.textContent = 'Escolha pelo menos um brownie antes de enviar.';
    document.querySelector('#products').scrollIntoView({ behavior: 'smooth' });
    return;
  }

  const form = new FormData(elements.orderForm);
  const payload = {
    customer: {
      name: form.get('name'),
      whatsapp: form.get('whatsapp'),
      address: form.get('address'),
      neighborhood: form.get('neighborhood'),
      reference: form.get('reference')
    },
    deliveryDate: form.get('deliveryDate'),
    notes: form.get('notes'),
    items: items.map(item => ({ productId: item.id, quantity: item.quantity }))
  };

  elements.submitButton.disabled = true;
  elements.submitButton.textContent = 'Registrando pedido...';
  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível registrar o pedido.');

    elements.successText.textContent = `Pedido ${result.order.id} no valor de ${currency.format(result.order.total)}. Agora envie a mensagem para confirmar e receber a chave PIX.`;
    if (result.whatsappUrl) {
      elements.whatsappButton.href = result.whatsappUrl;
      elements.whatsappButton.hidden = false;
    } else {
      elements.whatsappButton.hidden = true;
      elements.successText.textContent += ' O WhatsApp da loja ainda precisa ser configurado no painel.';
    }
    elements.successModal.hidden = false;
    state.quantities = {};
    elements.orderForm.reset();
    await loadCatalog();
  } catch (error) {
    elements.feedback.textContent = error.message;
  } finally {
    elements.submitButton.disabled = false;
    elements.submitButton.textContent = 'Enviar pedido pelo WhatsApp';
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}
function capitalize(value) { return value.charAt(0).toUpperCase() + value.slice(1); }

elements.orderForm.addEventListener('submit', submitOrder);
document.querySelector('#closeSuccess').addEventListener('click', () => { elements.successModal.hidden = true; });
elements.successModal.addEventListener('click', event => { if (event.target === elements.successModal) elements.successModal.hidden = true; });
loadCatalog();
