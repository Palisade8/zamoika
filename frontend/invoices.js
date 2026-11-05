// invoices.js - скрипты для страницы расходных накладных
function getTodayStr() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'flex' : 'none';
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.background = type === 'error' ? '#d32f2f' : type === 'success' ? '#2e7d32' : '#333';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

async function safeFetch(url, options = {}) {
    try {
        showLoading(true);
        // Используем apiFetch (с credentials: 'same-origin' для cookie JWT)
        const fetchFn = (typeof apiFetch === 'function') ? apiFetch : fetch;
        const response = await fetchFn(url, {
            ...options,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', ...options.headers }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error('Fetch error:', error);
        showToast(`Ошибка сети: ${error.message}`, 'error');
        return { success: false, error: error.message };
    } finally {
        showLoading(false);
    }
}

let allProducts = [];
let currentInvoice = null;

const CHEM_MAPPING = {
    "Шампунь авто": { artno: 1, clrno: 4 },
    "Воск": { artno: 4, clrno: 4 },
    "Чернитель резины": { artno: 2, clrno: 6 },
    "Средство от мух": { artno: 56, clrno: 0 },
    "Очиститель дисков": { artno: 55, clrno: 0 },
    "Шампунь для двигателя": { artno: 31, clrno: 0 }
};

async function fetchAllProducts() {
    const data = await safeFetch('/zamoika/api/all-products');
    if (data.success) allProducts = data.products || [];
    else showToast('Не удалось загрузить товары', 'error');
}

function getProductOptions(selectedArtno) {
    let html = '<option value="">Выберите артикул</option>';
    for (let p of allProducts) {
        const name = p.name || "";
        if (name.includes("мин") || name.includes("час") || name.includes("сек")) continue;
        const selected = (p.artno == selectedArtno) ? 'selected' : '';
        const shortName = escapeHtml(name.substring(0, 40));
        html += `<option value="${p.artno}" ${selected}>${p.artno} - ${shortName}</option>`;
    }
    return html;
}

function updateProductName(select) {
    const row = select.closest('tr');
    const artno = select.value;
    const nameInput = row?.querySelector('.edit-name');
    if (!nameInput) return;
    nameInput.value = artno ? (allProducts.find(p => p.artno == artno)?.name || '') : '';
}

async function loadInvoices() {
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    if (!startDate || !endDate) { showToast('Выберите период дат', 'error'); return; }

    const data = await safeFetch(`/zamoika/api/movement-invoices?start=${startDate}&end=${endDate}`);
    if (!data.success) {
        document.getElementById('invoices-list').innerHTML = `<div class="error-message">Ошибка: ${escapeHtml(data.error)}</div>`;
        return;
    }

    const invoices = data.invoices || [];
    if (invoices.length === 0) {
        document.getElementById('invoices-list').innerHTML = '<div class="empty-state">Нет накладных за выбранный период</div>';
        return;
    }

    let html = '<table class="invoices-table"><thead><tr><th>№</th><th>Дата</th><th>Статус</th><th>Примечание</th></tr></thead><tbody>';
    for (const inv of invoices) {
        const statusClass = inv.proved ? 'status-posted' : 'status-draft';
        const statusText = inv.proved ? '✅ Проведен' : ' Черновик';
        const note = escapeHtml(inv.note || '—');
        html += `<tr onclick="showInvoiceDetail(${inv.moveno})">
            <td>${escapeHtml(inv.naklno)}</td>
            <td>${escapeHtml(inv.date)}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>${note}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    document.getElementById('invoices-list').innerHTML = html;
}

async function showInvoiceDetail(moveno) {
    const data = await safeFetch(`/zamoika/api/invoice-details?moveno=${moveno}`);
    if (!data.success) {
        document.getElementById('detail-panel').innerHTML = `<div class="error-message">Ошибка: ${escapeHtml(data.error)}</div>`;
        return;
    }
    currentInvoice = data;
    const header = data.header;
    const items = data.items || [];

    let html = `<div class="detail-panel">
        <h3>Расходная накладная №${escapeHtml(header.naklno)} от ${escapeHtml(header.date)}</h3>
        <p>Статус: <span style="${header.proved ? 'color:#2e7d32' : 'color:#ff9800'}">${header.proved ? 'Проведен' : 'Черновик'}</span></p>
        <p>Примечание: ${escapeHtml(header.note || '—')}</p>`;

    if (items.length > 0) {
        html += `<table class="detail-table"><thead><tr><th>Артикул</th><th>Товар</th><th>Кол-во</th><th>Ед.изм.</th></tr></thead><tbody>`;
        for (const item of items) {
            // 🔥 Берем единицу измерения СТРОГО из базы (поле unit)
            let unit = item.unit || "шт";
            html += `<tr><td>${escapeHtml(item.artno)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.qty)}</td><td>${unit}</td></tr>`;
        }
        html += `</tbody></table>`;
    }

    html += `<div style="margin-top:15px;">`;
    if (!header.proved) {
        html += `<button class="btn-edit" onclick="editInvoice()">✏️ Редактировать</button>`;
        html += `<button class="btn-post" onclick="postInvoice(${header.moveno}, true)">✅ Провести</button>`;
    } else {
        html += `<button class="btn-unpost" onclick="postInvoice(${header.moveno}, false)">🔄 Отменить проведение</button>`;
    }
    html += `</div></div>`;
    const panel = document.getElementById('detail-panel');
    panel.innerHTML = html;
    panel.style.display = 'block';
}

async function postInvoice(moveno, post) {
    if (!confirm(post ? 'Провести накладную?' : 'Отменить проведение?')) return;
    const data = await safeFetch('/zamoika/api/post-invoice', { method: 'POST', body: JSON.stringify({ moveno, post }) });
    if (data.success) {
        showToast(post ? 'Накладная проведена!' : 'Проведение отменено!', 'success');
        await loadInvoices();
        showInvoiceDetail(moveno);
    } else showToast('Ошибка: ' + data.error, 'error');
}

function editInvoice() {
    if (!currentInvoice || !currentInvoice.header) return;
    const header = currentInvoice.header;
    const items = currentInvoice.items || [];
    let itemsHtml = '';
    for (let i = 0; i < items.length; i++) {
        const selectedOptions = getProductOptions(items[i].artno);
        const name = escapeHtml(items[i].name || '');
        const qty = items[i].qty || 1;
        itemsHtml += `<tr>
            <td><select class="edit-artno" onchange="updateProductName(this)">${selectedOptions}</select></td>
            <td><input type="text" class="edit-name" value="${name}" placeholder="Название"></td>
            <td><input type="number" class="edit-qty" value="${qty}" step="0.01"></td>
            <td><button class="remove-btn" onclick="removeProductRow(this)">✖</button></td>
        </tr>`;
    }
    const note = escapeHtml(header.note || '');
    let html = `<div class="edit-form">
        <h4>Редактирование накладной №${escapeHtml(header.naklno)}</h4>
        <div><label>Примечание:</label><br><textarea id="edit-note">${note}</textarea></div>
        <div><label>Товары:</label></div>
        <table class="edit-items-table">
            <thead><tr><th>Артикул</th><th>Товар</th><th>Кол-во</th><th></th></tr></thead>
            <tbody id="edit-items-tbody">${itemsHtml}</tbody>
        </table>
        <button class="add-btn" onclick="addProductRow()">+ Добавить товар</button>
        <div class="edit-form-buttons">
            <button class="save-btn" onclick="saveInvoiceEdit(${header.moveno})">💾 Сохранить</button>
            <button class="cancel-btn" onclick="cancelEdit()">Отмена</button>
        </div>
    </div>`;
    const panel = document.getElementById('detail-panel');
    panel.innerHTML = html;
    panel.style.display = 'block';
}

function addProductRow() {
    const tbody = document.getElementById('edit-items-tbody');
    if (!tbody) return;
    const productOptions = getProductOptions();
    const newRow = document.createElement('tr');
    newRow.innerHTML = `<td><select class="edit-artno" onchange="updateProductName(this)">${productOptions}</select></td>
        <td><input type="text" class="edit-name" placeholder="Название"></td>
        <td><input type="number" class="edit-qty" value="1" step="0.01"></td>
        <td><button class="remove-btn" onclick="removeProductRow(this)">✖</button></td>`;
    tbody.appendChild(newRow);
}

function removeProductRow(btn) { btn.closest('tr').remove(); }
function cancelEdit() { if (currentInvoice) showInvoiceDetail(currentInvoice.header.moveno); }

async function saveInvoiceEdit(moveno) {
    const note = document.getElementById('edit-note')?.value.trim() || '';
    const items = [];
    const rows = document.querySelectorAll('#edit-items-tbody tr');
    for (const row of rows) {
        const artno = row.querySelector('.edit-artno')?.value;
        const name = row.querySelector('.edit-name')?.value.trim();
        const qty = parseFloat(row.querySelector('.edit-qty')?.value);
        if (!artno && !name) continue;
        if (!qty || qty <= 0) { showToast('Укажите корректное количество', 'error'); return; }
        items.push({ artno: artno ? parseInt(artno) : 0, clrno: 0, qty, price: 0 });
    }
    if (items.length === 0) items.push({ artno: 22, clrno: 0, qty: 1, price: 0 });
    const data = await safeFetch('/zamoika/api/update-movement-invoice', { method: 'POST', body: JSON.stringify({ moveno, items, note }) });
    if (data.success) {
        showToast('Накладная обновлена!', 'success');
        await loadInvoices();
        showInvoiceDetail(moveno);
    } else showToast('Ошибка: ' + data.error, 'error');
}

async function showChemicalUsage() {
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    if (!startDate || !endDate) {
        showToast('Выберите период', 'error'); return;
    }
    const previewDiv = document.getElementById('chemical-preview');
    previewDiv.style.display = 'block';
    previewDiv.innerHTML = '<div>Загрузка...</div>';
    const data = await safeFetch(`/zamoika/api/chemical-usage?start=${startDate}&end=${endDate}`);
    if (!data.success) { previewDiv.innerHTML = `<div class="error-message">Ошибка: ${escapeHtml(data.error)}</div>`; return; }

    const totalUsage = data.total_usage || {};
    if (Object.keys(totalUsage).length === 0) { previewDiv.innerHTML = '<div>Нет расхода химии</div>'; return; }

    let html = '<h4>Расход химии</h4><table class="detail-table"><thead><tr><th>Химия</th><th>мл</th><th>шт</th></tr></thead><tbody>';
    for (const [chem, chemData] of Object.entries(totalUsage)) {
        const amount = chemData.amount || chemData;
        const unit = chemData.unit || 'мл.';
        const isPiece = unit.trim().startsWith('шт');
        html += `<tr><td>${escapeHtml(chem)}</td><td>${isPiece ? '—' : amount}</td><td>${isPiece ? amount : '—'}</td></tr>`;
    }
    html += `</tbody></table><button class="close-preview" onclick="document.getElementById('chemical-preview').style.display='none'">Закрыть</button>`;
    previewDiv.innerHTML = html;
}

async function createInvoice() {
    const today = new Date().toISOString().split("T")[0];
    const chemData = await safeFetch(`/zamoika/api/chemical-usage?start=${today}&end=${today}`);
    const totalUsage = chemData?.total_usage || {};
    const items = [];

    for (const [chemical, chemData] of Object.entries(totalUsage)) {
        const mapping = CHEM_MAPPING[chemical];
        const amount = chemData.amount || chemData;

        if (mapping && amount > 0) {
            const qty = Math.ceil(amount);
            items.push({ artno: mapping.artno, clrno: mapping.clrno, qty, price: 0 });
        }
    }

    if (items.length === 0) items.push({ artno: 22, clrno: 0, qty: 1, price: 0 });

    const data = await safeFetch("/zamoika/api/create-movement-invoice", {
        method: "POST",
        body: JSON.stringify({ date: today, items, note: `Списание за ${today}` })
    });

    if (data.success) {
        showToast(`Накладная №${data.naklno} создана!`, "success");
        await loadInvoices();
    } else showToast("Ошибка: " + data.error, "error");
}

// ==========================================
// ПОКАЗ ОСТАТКОВ НА СКЛАДЕ
// ==========================================
async function showStock() {
    const stockDiv = document.getElementById('stock-preview');
    stockDiv.style.display = 'block';
    stockDiv.innerHTML = '<div class="loading-text">Загрузка остатков...</div>';
    try {
        const resp = await apiFetch('/zamoika/api/stock-balance');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (!data.success) {
            stockDiv.innerHTML = `<div class="error-message">Ошибка: ${escapeHtml(data.error)}</div>`;
            return;
        }

        const stocks = data.stocks || [];
        if (stocks.length === 0) {
            stockDiv.innerHTML = '<div class="empty-state">Нет товаров на складе с положительным остатком</div>';
            return;
        }

        let html = `
            <div class="stock-header">
                <h4>📦 Остатки на складе</h4>
                <input type="text" id="stock-search" class="stock-search" placeholder="🔍 Поиск по названию...">
            </div>
            <div class="stats">
                <span>📊 Всего позиций: ${stocks.length}</span>
                <span>💧 Жидкости: ${stocks.filter(s => s.unit === 'мл').length}</span>
                <span>🔧 Штучные: ${stocks.filter(s => s.unit === 'шт').length}</span>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table class="stock-table" id="stock-table">
                    <thead><tr><th>Артикул</th><th>Наименование</th><th>Остаток</th><th>Ед.изм.</th></tr></thead>
                    <tbody id="stock-tbody">`;

        for (const item of stocks) {
            const unit = item.unit === 'ml' ? 'мл' : (item.unit === 'pcs' ? 'шт' : item.unit);
            const qtyClass = item.qty > 1000 ? 'stock-positive' : '';
            let displayQty = item.qty;
            let displayUnit = unit;

            if (unit === 'мл' && item.qty >= 1000) {
                displayQty = (item.qty / 1000).toFixed(2);
                displayUnit = 'л';
            } else {
                displayQty = item.qty.toFixed(0);
            }

            html += `<tr><td>${escapeHtml(item.artno)}</td><td>${escapeHtml(item.name || 'Товар ' + item.artno)}</td><td class="${qtyClass}">${displayQty}</td><td>${displayUnit}</td></tr>`;
        }

        html += `</tbody></table></div><button class="close-preview" onclick="document.getElementById('stock-preview').style.display='none'">Закрыть</button>`;
        stockDiv.innerHTML = html;

        document.getElementById('stock-search')?.addEventListener('input', function(e) {
            const search = e.target.value.toLowerCase();
            document.querySelectorAll('#stock-tbody tr').forEach(row => {
                row.style.display = row.textContent.toLowerCase().includes(search) ? '' : 'none';
            });
        });
    } catch(e) {
        stockDiv.innerHTML = `<div class="error-message">Ошибка: ${escapeHtml(e.message)}</div>`;
        console.error('Stock error:', e);
    }
}

// ==========================================
// ИНИЦИАЛИЗАЦИЯ
// ==========================================
async function init() {
    console.log('🔄 invoices.js: init()');

    // Загружаем список товаров
    await fetchAllProducts();

    // Устанавливаем даты
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const startInput = document.getElementById("start-date");
    const endInput = document.getElementById("end-date");
    // 🔥 Устанавливаем СЕГОДНЯШНЮЮ дату по умолчанию для обоих полей
    if (startInput) { startInput.value = todayStr; startInput.max = todayStr; }
    if (endInput) { endInput.value = todayStr; endInput.max = todayStr; }

    const reportDateInput = document.getElementById("report-date");
    if (reportDateInput) { reportDateInput.value = todayStr; reportDateInput.max = todayStr; }

    // Загружаем список накладных
    await loadInvoices();

    // Привязываем обработчики к существующим кнопкам (с проверкой на null!)
    const refreshBtn = document.getElementById("refresh-btn");
    if (refreshBtn) refreshBtn.onclick = loadInvoices;

    const createBtn = document.getElementById("create-btn");
    if (createBtn) createBtn.onclick = createInvoice;

    const generateBtn = document.getElementById("generate-report-btn");
    if (generateBtn) {
        generateBtn.onclick = function() {
            if (typeof ReportModule !== "undefined" && ReportModule.handleGenerate) {
                ReportModule.handleGenerate();
            }
        };
    }

    // Инициализация вкладок
    initTabs();

    // Загружаем отчёт по умолчанию, если секция видима
    if (typeof ReportModule !== "undefined" && ReportModule.init) {
        // ReportModule уже сам вызовет init по DOMContentLoaded
    }

    console.log('✅ invoices.js: init() завершён');
}

// ==========================================
// 📑 ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК
// ==========================================
function initTabs() {
    const tabs = document.querySelectorAll('.tab-item');
    const panels = document.querySelectorAll('.tab-panel');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.dataset.tab;
            
            // Переключаем активную вкладку
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Переключаем панели
            panels.forEach(p => p.classList.remove('active'));
            const target = document.getElementById(targetId);
            if (target) target.classList.add('active');
            
            // Ленивая загрузка данных
            if (targetId === 'tab-chemical') {
                loadChemicalUsageForTab();
            } else if (targetId === 'tab-stock') {
                loadStockForTab();
            }
        });
    });
    
    console.log('✅ Вкладки инициализированы');
}

// Загрузка расхода химии на вкладке
async function loadChemicalUsageForTab() {
    console.log('🔄 loadChemicalUsageForTab START');
    
    const container = document.getElementById('chemical-preview');
    if (!container) {
        console.warn('⚠️  #chemical-preview не найден');
        return;
    }
    
    const startDate = document.getElementById('start-date')?.value;
    const endDate = document.getElementById('end-date')?.value;
    
    console.log('   Период:', startDate, '—', endDate);
    if (!startDate || !endDate) {
        container.innerHTML = '<div class="empty-state">Выберите период</div>';
        return;
    }
    
    container.innerHTML = '<div class="loading-text">Загрузка расхода химии...</div>';
    
    try {
        const data = await safeFetch(`/zamoika/api/chemical-usage?start=${startDate}&end=${endDate}`);
        if (!data.success) {
            container.innerHTML = `<div class="error-message">Ошибка: ${escapeHtml(data.error)}</div>`;
            return;
        }
        
        const totalUsage = data.total_usage || {};
        if (Object.keys(totalUsage).length === 0) {
            container.innerHTML = '<div class="empty-state">Нет расхода химии за период</div>';
            return;
        }
        
        let html = '<h4>🧪 Расход химии за период</h4>';
        html += '<table class="detail-table"><thead><tr><th>Химия</th><th>Расход</th></tr></thead><tbody>';
        for (const [chem, chemData] of Object.entries(totalUsage)) {
            const amount = chemData.amount || chemData;
            const unit = chemData.unit || 'мл';
            html += `<tr><td>${escapeHtml(chem)}</td><td>${amount} ${escapeHtml(unit)}</td></tr>`;
        }
        html += '</tbody></table>';
        container.innerHTML = html;
    } catch(e) {
        container.innerHTML = `<div class="error-message">Ошибка: ${escapeHtml(e.message)}</div>`;
    }
}

// Загрузка склада на вкладке
async function loadStockForTab() {
    const container = document.getElementById('stock-preview');
    if (!container) return;
    
    container.innerHTML = '<div class="loading-text">Загрузка остатков...</div>';
    
    try {
        const resp = await apiFetch('/zamoika/api/stock-balance');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        
        if (!data.success) {
            container.innerHTML = `<div class="error-message">Ошибка: ${escapeHtml(data.error)}</div>`;
            return;
        }
        
        const stocks = data.stocks || [];
        if (stocks.length === 0) {
            container.innerHTML = '<div class="empty-state">Нет товаров на складе</div>';
            return;
        }
        
        let html = `
            <div class="stock-header">
                <h4>📦 Остатки на складе</h4>
                <input type="text" id="stock-search" class="stock-search" placeholder="🔍 Поиск...">
            </div>
            <div class="stats">
                <span>📊 Всего: ${stocks.length}</span>
                <span>💧 Жидкости: ${stocks.filter(s => s.unit === 'мл').length}</span>
                <span>🔧 Штучные: ${stocks.filter(s => s.unit === 'шт').length}</span>
            </div>
            <div style="overflow-x: auto; max-height: 60vh; overflow-y: auto;">
                <table class="stock-table">
                    <thead><tr><th>Артикул</th><th>Цвет</th><th>Наименование</th><th>Остаток</th><th>Ед.</th></tr></thead>
                    <tbody id="stock-tbody">`;
        
        for (const item of stocks) {
            const unit = item.unit === 'ml' ? 'мл' : (item.unit === 'pcs' ? 'шт' : item.unit);
            let displayQty = item.qty;
            let displayUnit = unit;
            if (unit === 'мл' && item.qty >= 1000) {
                displayQty = (item.qty / 1000).toFixed(2);
                displayUnit = 'л';
            } else {
                displayQty = item.qty.toFixed(0);
            }
            const rowClass = item.qty <= 0 ? 'style="background:#ffebee; color:#c62828;"' : '';
            const colorBadge = item.clrno ? `<span class="color-badge">${escapeHtml(String(item.clrno))}</span>` : '—';
            html += `<tr ${rowClass}><td>${escapeHtml(item.artno)}</td><td>${colorBadge}</td><td>${escapeHtml(item.name || 'Товар ' + item.artno)}</td><td>${displayQty}</td><td>${displayUnit}</td></tr>`;
        }
        html += '</tbody></table></div>';
        container.innerHTML = html;
        
        document.getElementById('stock-search')?.addEventListener('input', function(e) {
            const search = e.target.value.toLowerCase();
            document.querySelectorAll('#stock-tbody tr').forEach(row => {
                row.style.display = row.textContent.toLowerCase().includes(search) ? '' : 'none';
            });
        });
    } catch(e) {
        container.innerHTML = `<div class="error-message">Ошибка: ${escapeHtml(e.message)}</div>`;
    }
}

// ==========================================
// ЗАПУСК
// ==========================================
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}


// ==========================================
// 🔥 АВТО-ПЕРЕЗАГРУЗКА ПРИ СМЕНЕ ДАТ
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    console.log('🔥 Привязка обработчиков к датам');

    const startInput = document.getElementById('start-date');
    const endInput = document.getElementById('end-date');
    const refreshBtn = document.getElementById('refresh-btn');

    // Определяем активную вкладку
    function getActiveTab() {
        const active = document.querySelector('.tab-item.active');
        return active ? active.dataset.tab : 'tab-invoices';
    }

    // Перезагрузка активной вкладки
    function reloadActiveTab() {
        const tab = getActiveTab();
        console.log('🔄 Reload active tab:', tab);

        if (tab === 'tab-chemical') {
            loadChemicalUsageForTab();
        } else if (tab === 'tab-stock') {
            loadStockForTab();
        } else if (tab === 'tab-invoices') {
            loadInvoices();
        } else if (tab === 'tab-report') {
            // Отчёт загружается вручную
        }
    }

    if (startInput) {
        startInput.addEventListener('change', () => {
            console.log('📅 start-date изменился:', startInput.value);
            reloadActiveTab();
        });
    }

    if (endInput) {
        endInput.addEventListener('change', () => {
            console.log('📅 end-date изменился:', endInput.value);
            reloadActiveTab();
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            console.log('🔄 Кнопка Обновить');
            reloadActiveTab();
        });
    }

    // Логирование клика по вкладкам
    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.addEventListener('click', () => {
            console.log('📑 Вкладка:', tab.dataset.tab);
            const targetId = tab.dataset.tab;

            // Ленивая загрузка
            setTimeout(() => {
                if (targetId === 'tab-chemical') {
                    loadChemicalUsageForTab();
                } else if (targetId === 'tab-stock') {
                    loadStockForTab();
                }
            }, 50);
        });
    });

    console.log('✅ Обработчики дат привязаны');
});
