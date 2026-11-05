// services.js - Модуль управления услугами

// Используем escapeHtml из main.js, если он уже определен
if (typeof escapeHtml === 'undefined') {
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }
}

let groupedServices = {};
let hiddenProducts = new Set();

async function loadSiteFlags() {
    try {
        const resp = await apiFetch('/zamoika/api/settings/products/site-flags');
        const data = await resp.json();
        hiddenProducts = new Set(data.hidden_products || []);
        window.hiddenProducts = hiddenProducts;
        console.log('🔒 Загружены скрытые товары:', hiddenProducts.size);
    } catch(e) {
        console.error('Error loading site flags:', e);
    }
}


// ==========================================
// ЗАГРУЗКА УСЛУГ
// ==========================================
async function loadServices() {
    await loadSiteFlags();
    try {
        let resp = await fetch('/zamoika/api/services/grouped', { credentials: 'same-origin' });
        if (resp.ok) {
            const json = await resp.json();
            groupedServices = (json.success && json.groups) ? json.groups : json;
            
            // 🔥 СОРТИРУЕМ УСЛУГИ ПО АЛФАВИТУ ВНУТРИ КАЖДОЙ ГРУППЫ
            if (groupedServices) {
                for (const groupName in groupedServices) {
                    if (Array.isArray(groupedServices[groupName])) {
                        groupedServices[groupName].sort((a, b) => {
                            const nameA = (a.name || '').toLowerCase();
                            const nameB = (b.name || '').toLowerCase();
                            return nameA.localeCompare(nameB, 'ru');
                        });
                    }
                }
            }

            // 🔥 Экспортируем в window, чтобы schedule.js мог прочитать
            window.groupedServices = groupedServices;
            
            populateServiceSelectGrouped();
            
            // 🔥 Уведомляем все модули, что услуги загружены
            window.dispatchEvent(new Event('servicesLoaded'));
            console.log('✅ Услуги загружены и экспортированы в window.groupedServices');
        } else {
            let resp2 = await apiFetch('/zamoika/api/services');
            let data = await resp2.json();
            if (data.success) {
                // Преобразуем плоский список в формат groupedServices для единообразия
                groupedServices = { 'Все услуги': data.services };
                window.groupedServices = groupedServices;
                populateServiceSelectPlain(data.services);
                window.dispatchEvent(new Event('servicesLoaded'));
            }
        }
    } catch(e) {
        console.error("Error loading services:", e);
    }
}
// ==========================================
// ЗАПОЛНЕНИЕ SELECT (ГРУППИРОВАННЫЙ)
// ==========================================
function populateServiceSelectGrouped() {
    let select = document.getElementById('service-type');
    if (!select) return;

    select.innerHTML = '<option value="">Выберите услугу</option>';

    for (let [groupName, services] of Object.entries(groupedServices)) {
        let optgroup = document.createElement('optgroup');
        optgroup.label = groupName;

        // 🔥 Сортируем копию массива перед рендерингом
        const sortedServices = [...services].sort((a, b) => {
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            return nameA.localeCompare(nameB, 'ru');
        });

        for (let service of sortedServices) {
            // 🔥 ЖЕСТКАЯ ПРОВЕРКА: скрываем услугу, если она в hiddenProducts
            if (window.hiddenProducts && window.hiddenProducts.has(parseInt(service.id))) {
                continue;
            }
            let option = document.createElement('option');
            option.value = service.id;
            option.textContent = `${service.name} ${service.price} руб`;
            option.dataset.duration = service.duration;
            option.dataset.price = service.price;
            option.dataset.name = service.name;
            optgroup.appendChild(option);
        }
        select.appendChild(optgroup);
    }
}

// ==========================================
// ЗАПОЛНЕНИЕ SELECT (ПРОСТОЙ)
// ==========================================
function populateServiceSelectPlain(services) {
    let select = document.getElementById('service-type');
    if (!select) return;

    select.innerHTML = '<option value="">Выберите услугу</option>';

    for (let s of services) {
        let opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.name} - ${s.price} руб`;
        opt.dataset.duration = s.duration;
        opt.dataset.price = s.price;
        opt.dataset.name = s.name;
        select.appendChild(opt);
    }
}

// ==========================================
// РАСЧЕТ ЦЕНЫ СО СКИДКОЙ
// ==========================================
function calcPriceWithDiscount(totalPrice) {
    let discountPercent = parseInt(document.getElementById("discount")?.value) || 0;
    if (discountPercent > 100) discountPercent = 100;
    if (discountPercent < 0) discountPercent = 0;
    let discountedPrice = totalPrice * (1 - discountPercent / 100);

    // ✅ БЕЗОПАСНОЕ обновление поля booking-price
    const priceInput = document.getElementById("booking-price");
    if (priceInput) {
        priceInput.value = discountedPrice.toFixed(2) + ' руб';
    } else {
        console.warn('⚠️ Элемент #booking-price не найден');
    }

    // ✅ БЕЗОПАСНОЕ обновление скрытого поля total-cost
    const totalCostInput = document.getElementById("total-cost");
    if (totalCostInput) {
        totalCostInput.value = Math.round(discountedPrice);
    }

    return Math.round(discountedPrice);
}

// ==========================================
// ОБНОВЛЕНИЕ СПИСКА УСЛУГ
// ==========================================
function updateSelectedServicesList() {
    let wrapper = document.getElementById('selected-services-wrapper');
    let container = document.getElementById('selected-services-list');

    // ✅ Проверка наличия контейнера
    if (!container) {
        console.warn('⚠️ Контейнер #selected-services-list не найден');
        return;
    }

    if (!window.selectedServices || window.selectedServices.length === 0) {
        container.innerHTML = '<span style="color: #94a3b8;">— нет выбранных услуг —</span>';
        if (wrapper) wrapper.style.display = 'none';

        // ✅ БЕЗОПАСНОЕ обновление полей
        const durationInput = document.getElementById('booking-duration');
        if (durationInput) durationInput.value = 0;

        const priceInput = document.getElementById('booking-price');
        if (priceInput) priceInput.value = '0 руб';

        const totalCostInput = document.getElementById('total-cost');
        if (totalCostInput) totalCostInput.value = 0;

        return;
    }

    if (wrapper) wrapper.style.display = 'block';
    let html = '';
    let totalDuration = 0;
    let totalPrice = 0;

    for (let i = 0; i < window.selectedServices.length; i++) {
        let s = window.selectedServices[i];
        html += `<span class="service-tag">${escapeHtml(s.name)} (${s.duration} мин) - ${s.price} руб <button type="button" class="remove-service" data-index="${i}">✖</button></span>`;
        // 🔥 Прибавляем время только если оно > 0
        if (s.duration > 0) {
            totalDuration += s.duration;
        }
        totalPrice += s.price || 0;
    }
    container.innerHTML = html;

    // ✅ БЕЗОПАСНОЕ обновление длительности
    const durationInput = document.getElementById('booking-duration');
    if (durationInput) durationInput.value = totalDuration;

    // Расчет стоимости с учетом скидки
    calcPriceWithDiscount(totalPrice);

    // Обработчики удаления
    document.querySelectorAll('.remove-service').forEach(btn => {
        btn.onclick = () => {
            let idx = parseInt(btn.dataset.index);
            if (window.selectedServices && window.selectedServices[idx]) {
                window.selectedServices.splice(idx, 1);
                updateSelectedServicesList();
                // Обновить слоты времени
                if (typeof window.generateTimeSlotsGrid === 'function' && window.timeSlotsVisible) {
                    window.generateTimeSlotsGrid();
                }
            }
        };
    });
}

// ==========================================
// ОБРАБОТЧИК ДОБАВЛЕНИЯ УСЛУГИ
// ==========================================
document.getElementById('service-type')?.addEventListener('change', function() {
    let serviceId = this.value;
    let option = this.options[this.selectedIndex];
    if (!serviceId || !option) return;

    let serviceName = option.dataset.name || option.text.split(' (')[0];
    let serviceDuration = parseInt(option.dataset.duration) || 0;
    let servicePrice = parseFloat(option.dataset.price) || 0;

    console.log('Добавление услуги:', {id: serviceId, name: serviceName, duration: serviceDuration, price: servicePrice});

    if (!window.selectedServices) window.selectedServices = [];

    // Услуги, которые можно добавлять многократно (по ключевым словам)
    const repeatableKeywords = ['дополнительное время', 'доп. время', 'переработка'];

    const isRepeatable = repeatableKeywords.some(keyword =>
        serviceName.toLowerCase().includes(keyword)
    );

    // Проверка на дубликат (только для не-многократных услуг)
    if (!isRepeatable && window.selectedServices.some(s => s.id == serviceId)) {
        if (typeof showToast === 'function') {
            showToast('⚠️ Эта услуга уже добавлена', 'warning');
        } else {
            alert('Эта услуга уже добавлена');
        }
        this.value = '';
        return;
    }

    window.selectedServices.push({
        id: serviceId,
        name: serviceName,
        duration: serviceDuration,
        price: servicePrice
    });

    updateSelectedServicesList();
    this.value = '';

    // Обновить слоты времени
    if (typeof window.generateTimeSlotsGrid === 'function' && window.timeSlotsVisible) {
        window.generateTimeSlotsGrid();
    }
});

// ==========================================
// ОБРАБОТЧИК ИЗМЕНЕНИЯ СКИДКИ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const discountInput = document.getElementById('discount');
    if (discountInput) {
        discountInput.addEventListener('input', () => {
            let totalPrice = 0;
            if (window.selectedServices) {
                for (let service of window.selectedServices) {
                    totalPrice += service.price || 0;
                }
            }
            calcPriceWithDiscount(totalPrice);
            
            // 🔥 Если мы в режиме товаров, пересчитываем итог
            if (typeof updateProductTotal === 'function') {
                updateProductTotal();
            }
        });
    }
});

// ==========================================
// ПРОДАЖА ТОВАРОВ (АВТОМАТИЧЕСКОЕ ДОБАВЛЕНИЕ)
// ==========================================
let productsForSale = [];
let selectedProducts = [];
let productsLoaded = false;

// ==========================================
// ПРОДАЖА ТОВАРОВ (БЕЗ ТЕСТОВЫХ ТОВАРОВ)
// ==========================================

async function loadProductsForSale() {
    await loadSiteFlags(); // 🔥 Загружаем скрытые товары
    console.log('🔄 Загрузка товаров из /api/services/grouped...');

    try {
        const resp = await fetch('/zamoika/api/services/grouped', { credentials: 'same-origin' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const json = await resp.json();
        const data = (json.success && json.groups) ? json.groups : json;
        console.log('📦 /api/services/grouped загружен');

        // Собираем товары из всех групп
        let allProducts = [];

        for (const [groupName, items] of Object.entries(data)) {
            if (!Array.isArray(items)) continue;

            // Исключаем группу "Дополнительные услуги"
            if (groupName === 'Дополнительные услуги') {
                console.log(`⏭️ Пропускаем группу: ${groupName}`);
                continue;
            }

            // Фильтруем товары
            const filtered = items.filter(item => {
                if (groupName === 'Аксессуары/химия') return true;
                if (item.duration === 0) return true;
                return false;
            });

            filtered.forEach(item => {
                allProducts.push({
                    ...item,
                    group: groupName
                });
            });
        }

        // Убираем дубликаты
        const unique = {};
        productsForSale = allProducts.filter(item => {
            if (unique[item.id]) return false;
            unique[item.id] = true;
            return true;
        });

        // Форматируем
        productsForSale = productsForSale.map(item => ({
            id: item.id,
            name: item.name,
            price: item.price || 0,
            duration: item.duration || 0,
            unit: item.duration === 0 ? 'шт' : 'мин',
            qty: 999,
            group: item.group || 'Товары'
        }));

        productsForSale.sort((a, b) => a.name.localeCompare(b.name));

        productsLoaded = true;
        console.log(`✅ Загружено товаров из grouped_services.json: ${productsForSale.length}`);
        console.log('📋 Группы товаров:', [...new Set(productsForSale.map(p => p.group))]);

        // Инициализируем список товаров
        initializeProductList();

    } catch(e) {
        console.error('❌ Ошибка загрузки товаров:', e);

        // ❌ УДАЛЯЕМ ТЕСТОВЫЕ ТОВАРЫ
        // Вместо тестовых - показываем сообщение об ошибке
        productsForSale = [];
        productsLoaded = false;

        // Показываем сообщение пользователю
        const container = document.getElementById('product-list');
        if (container) {
            container.innerHTML = '<div style="color: #d32f2f; padding: 10px; text-align: center;">❌ Ошибка загрузки товаров. Проверьте файл grouped_services.json</div>';
        }

        console.error('❌ Товары не загружены. Проверьте grouped_services.json');
    }
}

function initializeProductList() {
    // 🔥 АВТОМАТИЧЕСКИ СОЗДАЕМ ПЕРВУЮ СТРОКУ
    const container = document.getElementById('product-list');
    if (!container) return;

    // Очищаем контейнер
    container.innerHTML = '';

    // Создаем первую строку
    createProductRow(container);

    // Добавляем обработчик для автоматического добавления новых строк
    container.addEventListener('change', function(e) {
        if (e.target.classList.contains('product-select')) {
            // Проверяем, выбран ли товар
            if (e.target.value) {
                // Проверяем, есть ли пустая строка в конце
                const rows = container.querySelectorAll('.product-row');
                const lastRow = rows[rows.length - 1];
                const lastSelect = lastRow?.querySelector('.product-select');

                // Если последняя строка заполнена - добавляем новую
                if (lastSelect && lastSelect.value) {
                    createProductRow(container);
                }
            }
        }
    });
}

function createProductRow(container) {
    const row = document.createElement('div');
    row.className = 'product-row';
    row.style.cssText = 'display: flex; gap: 8px; margin-bottom: 8px; align-items: center;';

    const select = document.createElement('select');
    select.className = 'product-select';
    select.style.cssText = 'flex: 2; padding: 6px; border: 1.5px solid var(--border); border-radius: var(--radius-sm);';
    populateProductSelect(select);

    const qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.className = 'product-qty';
    qtyInput.value = 1;
    qtyInput.min = 1;
    qtyInput.style.cssText = 'width: 70px; padding: 6px; border: 1.5px solid var(--border); border-radius: var(--radius-sm);';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-product-row';
    removeBtn.style.cssText = 'background: #f44336; color: white; border: none; border-radius: 50%; width: 28px; height: 28px; cursor: pointer; font-size: 14px;';
    removeBtn.textContent = '✕';

    row.appendChild(select);
    row.appendChild(qtyInput);
    row.appendChild(removeBtn);
    container.appendChild(row);

    // Обработчик удаления строки
    removeBtn.onclick = function() {
        const rows = container.querySelectorAll('.product-row');
        if (rows.length > 1) {
            row.remove();
            updateProductTotal();
        } else {
            // Если осталась последняя строка - просто очищаем select
            select.value = '';
            updateProductTotal();
        }
    };

    // 🔥 АВТОМАТИЧЕСКОЕ ОБНОВЛЕНИЕ ИТОГА ПРИ ИЗМЕНЕНИИ
    select.onchange = function() {
        updateProductTotal();
        // Триггерим событие для автоматического добавления новой строки
        const event = new Event('change');
        container.dispatchEvent(event);
    };

    qtyInput.oninput = updateProductTotal;

    updateProductTotal();
}

function populateProductSelect(selectElement) {
    if (!selectElement) return;

    selectElement.innerHTML = '<option value="">Выберите товар</option>';

    const grouped = {};
    productsForSale.forEach(p => {
        const group = p.group || 'Товары';
        if (!grouped[group]) grouped[group] = [];
        grouped[group].push(p);
    });

    for (const [groupName, items] of Object.entries(grouped)) {
        if (items.length === 0) continue;

        const optgroup = document.createElement('optgroup');
        optgroup.label = groupName;

        for (const p of items) {
            // 🔥 ЖЕСТКАЯ ПРОВЕРКА: скрываем товар, если он в hiddenProducts
            if (window.hiddenProducts && window.hiddenProducts.has(parseInt(p.id))) {
                continue;
            }
            const opt = document.createElement('option');
            opt.value = p.id;
            const qtyText = p.qty !== undefined ? ` (остаток: ${p.qty} ${p.unit || 'шт'})` : '';
            opt.textContent = `${p.name} - ${p.price} руб${qtyText}`;
            opt.dataset.price = p.price;
            opt.dataset.name = p.name;
            opt.dataset.qty = p.qty || 0;
            opt.dataset.unit = p.unit || 'шт';
            opt.dataset.group = groupName;
            optgroup.appendChild(opt);
        }

        selectElement.appendChild(optgroup);
    }
}

function updateProductTotal() {
    const rows = document.querySelectorAll('.product-row');
    let total = 0;

    rows.forEach(row => {
        const select = row.querySelector('.product-select');
        const qty = parseInt(row.querySelector('.product-qty')?.value) || 0;
        const price = parseFloat(select?.selectedOptions[0]?.dataset?.price) || 0;
        total += price * qty;
    });

    // 🔥 Учитываем скидку из поля #discount
    const discount = parseFloat(document.getElementById('discount')?.value || 0);
    const finalTotal = total * (1 - discount / 100);

    const totalInput = document.getElementById('product-total');
    if (totalInput) {
        totalInput.value = finalTotal.toFixed(2) + ' руб';
    }
}

// ✅ Функция getSelectedProducts для отправки
function getSelectedProducts() {
    const products = [];
    const rows = document.querySelectorAll('.product-row');

    rows.forEach(row => {
        const select = row.querySelector('.product-select');
        const qty = parseInt(row.querySelector('.product-qty')?.value) || 0;
        const price = parseFloat(select?.selectedOptions[0]?.dataset?.price) || 0;
        const name = select?.selectedOptions[0]?.dataset?.name || '';
        const id = select?.value;

        if (id && qty > 0) {
            products.push({
                id: parseInt(id),
                name: name,
                qty: qty,
                price: price,
                total: price * qty
            });
        }
    });

    return products;
}

// ==========================================
// ФУНКЦИЯ ОЧИСТКИ ВЫБРАННЫХ УСЛУГ
// ==========================================
function clearSelectedServices() {
    window.selectedServices = [];
    updateSelectedServicesList();
}

// ==========================================
// ФУНКЦИЯ ПОЛУЧЕНИЯ ВЫБРАННЫХ УСЛУГ
// ==========================================
function getSelectedServices() {
    return window.selectedServices || [];
}

// ==========================================
// ЭКСПОРТ ФУНКЦИЙ
// ==========================================
window.productsForSale = productsForSale;
window.selectedProducts = selectedProducts;
window.loadProductsForSale = loadProductsForSale;
window.getSelectedProducts = getSelectedProducts;
window.updateProductTotal = updateProductTotal;
window.populateProductSelect = populateProductSelect;
window.initializeProductList = initializeProductList;

window.loadServices = loadServices;
window.updateSelectedServicesList = updateSelectedServicesList;
window.calcPriceWithDiscount = calcPriceWithDiscount;
window.clearSelectedServices = clearSelectedServices;
window.getSelectedServices = getSelectedServices;
