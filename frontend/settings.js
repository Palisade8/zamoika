(function() {
'use strict';

// ==========================================
// 📄 settings.js — логика страницы настроек
// Изолирован в IIFE, чтобы не перетирать глобальные функции
// ==========================================

// Глобальные переменные для хранения данных
let servicesData = [];
let productsData = [];
let hiddenProducts = new Set();
let currentEditGroup = null;
let currentEditItems = [];

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    // Переключение вкладок
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // Загрузка данных
    loadServices();
    
    async function loadSiteFlags() {
        try {
            const resp = await apiFetch('/zamoika/api/settings/products/site-flags');
            const data = await resp.json();
            hiddenProducts = new Set(data.hidden_products || []);
        } catch(e) { console.error('Error loading site flags:', e); }
    }
    loadSiteFlags().then(() => loadProducts());

    loadChemRates();
    loadGroups();

    // Слушатели фильтров
    const accsFilter = document.getElementById('filter-accs');
    if (accsFilter) accsFilter.addEventListener('change', renderServicesTable);

    const stockFilter = document.getElementById('filter-stock');
    if (stockFilter) stockFilter.addEventListener('change', renderProductsTable);
});

// ==========================================
// УСЛУГИ
// ==========================================
async function loadServices() {
    try {
        const resp = await apiFetch('/zamoika/api/settings/services?_t=' + Date.now());
        const data = await resp.json();
        if (data.success) {
            servicesData = data.services;
            renderServicesTable();
            addSortListeners('services-table', servicesData, renderServicesTable);
        }
    } catch (e) {
        console.error('Error loading services:', e);
    }
}

function renderServicesTable() {
    const tbody = document.querySelector('#services-table tbody');
    if (!tbody) return;

    const filterAccs = document.getElementById('filter-accs');
    const countSpan = document.getElementById('filter-count');

    tbody.innerHTML = '';

    let displayData = servicesData;
    if (filterAccs?.checked) {
        displayData = servicesData.filter(item => item.accs == 1);
    }

    if (countSpan) countSpan.textContent = `Показано: ${displayData.length} из ${servicesData.length}`;

    displayData.forEach(s => {
        const tr = document.createElement('tr');
        const colorDisplay = s.color_name
            ? `<span class="color-badge">${s.color_name}</span>`
            : '<span class="text-gray">—</span>';
        const style = s.accs == 1 ? 'background: #f0fdf4;' : '';
        tr.innerHTML = `
            <td style="${style}">${s.artno}</td>
            <td style="${style}">${colorDisplay}</td>
            <td style="${style}">${s.name}</td>
            <td style="${style}">${s.unit}</td>
            <td class="text-right" style="${style}">${s.price.toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// ТОВАРЫ
// ==========================================
async function loadProducts() {
    try {
        const resp = await apiFetch('/zamoika/api/settings/products-stock?_t=' + Date.now());
        const data = await resp.json();
        if (data.success) {
            productsData = data.products;
            renderProductsTable();
            addSortListeners('products-table', productsData, renderProductsTable);
        }
    } catch (e) {
        console.error('Error loading products:', e);
    }
}

function renderProductsTable() {
    const tbody = document.querySelector('#products-table tbody');
    if (!tbody) return;

    const filterStock = document.getElementById('filter-stock');
    const countSpan = document.getElementById('stock-count');

    tbody.innerHTML = '';

    let displayData = productsData;
    if (filterStock?.checked) {
        displayData = productsData.filter(item => item.stock > 0);
    }

    if (countSpan) countSpan.textContent = `Показано: ${displayData.length} из ${productsData.length}`;

    displayData.forEach(p => {
        const tr = document.createElement('tr');
        const stockClass = p.stock > 0 ? 'stock-positive' : '';
        const colorDisplay = p.color_name
            ? `<span class="color-badge">${p.color_name}</span>`
            : '<span class="text-gray">—</span>';
        tr.innerHTML = `
            <td>${p.artno}</td>
            <td>${colorDisplay}</td>
            <td>${p.name}</td>
            <td>${p.unit}</td>
            <td class="text-right ${stockClass}">${p.stock.toFixed(2)}</td>
            <td style="text-align: center;">
                <input type="checkbox" ${!hiddenProducts.has(p.artno) ? 'checked' : ''} 
                       onchange="toggleProductSite(${p.artno}, !this.checked)"
                       style="width: 18px; height: 18px; cursor: pointer;">
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// РАСХОД ХИМИИ
// ==========================================
async function loadChemRates() {
    try {
        const resp = await apiFetch('/zamoika/api/settings/chemical-rates-with-names');
        const data = await resp.json();
        const tbody = document.querySelector('#chem-table tbody');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        if (!data.success) {
            tbody.innerHTML = `<tr><td colspan="5" style="color:#d32f2f;">Ошибка: ${escapeHtml(data.error || '')}</td></tr>`;
            return;
        }
        
        for (const item of (data.rates || [])) {
            const tr = document.createElement('tr');
            const chemDisplay = item.chem_artno 
                ? `${escapeHtml(item.chem_name)} <small style="color:#888;">(ARTNO ${item.chem_artno})</small>`
                : escapeHtml(item.chem_name);
            tr.innerHTML = `
                <td>${item.service_artno}</td>
                <td>${escapeHtml(item.service_name)}</td>
                <td>${chemDisplay}</td>
                <td style="text-align:right;">${item.rate}</td>
                <td>
                    <button class="btn-edit" onclick="editChemRate(${item.service_artno}, ${item.chem_artno || 'null'}, '${escapeHtml(item.chem_name)}', ${item.rate})">✏️</button>
                    <button class="remove-btn" onclick="deleteChemRate('${item.service_artno}', '${item.chem_artno || item.chem_name}')">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        }
    } catch(e) {
        console.error('Error loading chem rates:', e);
    }
}


async function editChemRate(serviceArtno, chemArtno, chemName, currentRate) {
    const newRate = prompt(`Введите новую норму расхода для "${chemName}" (текущая: ${currentRate}):`, currentRate);
    if (newRate === null || newRate === '') return; // Отмена

    const rateNum = parseFloat(newRate);
    if (isNaN(rateNum) || rateNum < 0) {
        alert('Пожалуйста, введите корректное число (больше или равно 0)');
        return;
    }

    try {
        // Загружаем текущий файл коэффициентов
        const resp = await apiFetch('/zamoika/api/settings/chemical-rates');
        const data = await resp.json();
        const rates = data.rates || {};

        // Проверяем, есть ли такая услуга и химия в файле
        if (!rates[serviceArtno]) rates[serviceArtno] = {};
        
        // Ищем ключ химии (он может быть числом или названием)
        let keyToUpdate = null;
        if (rates[serviceArtno][chemName] !== undefined) {
            keyToUpdate = chemName;
        } else if (chemArtno && rates[serviceArtno][chemArtno] !== undefined) {
            keyToUpdate = chemArtno;
        } else {
            // Если нет, попробуем найти по названию
            for (const k in rates[serviceArtno]) {
                if (k.toLowerCase() === chemName.toLowerCase()) {
                    keyToUpdate = k;
                    break;
                }
            }
        }

        if (!keyToUpdate) {
            // Если не нашли, создаем новый (используем chemName как ключ)
            keyToUpdate = chemName;
        }

        rates[serviceArtno][keyToUpdate] = rateNum;

        // Сохраняем на сервер
        const saveResp = await apiFetch('/zamoika/api/settings/chemical-rates', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ rates: rates })
        });
        const result = await saveResp.json();

        if (result.success) {
            // Перезагружаем таблицу
            loadChemRates();
            if (typeof showToast === 'function') {
                showToast('✅ Норма расхода обновлена', 'success');
            }
        } else {
            alert('Ошибка сохранения: ' + (result.error || 'Неизвестно'));
        }
    } catch(e) {
        console.error('Error editing chem rate:', e);
        alert('Ошибка: ' + e.message);
    }
}


async function addChemRate() {
    const artno = document.getElementById('chem-artno').value;
    const name = document.getElementById('chem-name').value;
    const rate = document.getElementById('chem-rate').value;
    const statusDiv = document.getElementById('chem-status');

    if (!artno || !name || !rate) {
        statusDiv.textContent = '❌ Заполните все поля';
        statusDiv.className = 'status-msg error';
        return;
    }

    try {
        const resp = await apiFetch('/zamoika/api/settings/chemical-rates');
        const data = await resp.json();
        const currentRates = data.rates || {};

        if (!currentRates[artno]) currentRates[artno] = {};
        currentRates[artno][name] = Number(rate);

        const saveResp = await apiFetch('/zamoika/api/settings/chemical-rates', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({rates: currentRates})
        });
        const result = await saveResp.json();

        statusDiv.textContent = result.message || (result.error || 'Готово');
        statusDiv.className = `status-msg ${result.success ? 'success' : 'error'}`;

        if (result.success) {
            document.getElementById('chem-artno').value = '';
            document.getElementById('chem-name').value = '';
            document.getElementById('chem-rate').value = '';
            loadChemRates();
        }
    } catch (e) {
        statusDiv.textContent = ' Ошибка: ' + e.message;
        statusDiv.className = 'status-msg error';
    }
}

async function deleteChemRate(artno, name) {
    if (!confirm(`Удалить "${name}" для ARTNO ${artno}?`)) return;
    try {
        const resp = await apiFetch('/zamoika/api/settings/chemical-rates');
        const data = await resp.json();
        const rates = data.rates || {};
        if (rates[artno] && rates[artno][name]) {
            delete rates[artno][name];
            if (Object.keys(rates[artno]).length === 0) {
                delete rates[artno];
            }
        }
        const saveResp = await apiFetch('/zamoika/api/settings/chemical-rates', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({rates: rates})
        });
        const result = await saveResp.json();
        if (result.success) {
            loadChemRates();
        }
    } catch (e) {
        console.error('Error deleting chem rate:', e);
    }
}

// ==========================================
// ГРУППИРОВКА
// ==========================================
async function loadGroups() {
    try {
        const resp = await apiFetch('/zamoika/api/settings/service-groups');
        const data = await resp.json();
        const tbody = document.querySelector('#groups-table tbody');
        if (!tbody) return;

        tbody.innerHTML = '';

        if (data.success) {
            for (const [group, items] of Object.entries(data.groups || {})) {
                if (!Array.isArray(items)) continue;
                const artnosDisplay = items.map(item => {
                    if (typeof item === 'object' && item !== null) {
                        return `${item.id} (${item.name})`;
                    }
                    return String(item);
                }).join(', ');
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${group}</td>
                    <td style="font-size: 12px; line-height: 1.4;">${artnosDisplay}</td>
                    <td><button class="btn-delete remove-btn" onclick="deleteGroup('${group}')">🗑️</button>
                        <button class="btn-edit" onclick="openEditGroupModal('${group}')" style="margin-right: 5px;">✏️</button>
                    </td>
                `;
                tbody.appendChild(tr);
            }
        }
    } catch (e) {
        console.error('Error loading groups:', e);
    }
}

async function addGroup() {
    const name = document.getElementById('group-name').value;
    const artnosStr = document.getElementById('group-artnos').value;
    const statusDiv = document.getElementById('group-status');

    if (!name || !artnosStr) {
        statusDiv.textContent = '❌ Заполните все поля';
        statusDiv.className = 'status-msg error';
        return;
    }

    const artnos = artnosStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));

    if (artnos.length === 0) {
        statusDiv.textContent = '❌ Нет валидных ARTNO';
        statusDiv.className = 'status-msg error';
        return;
    }

    try {
        const resp = await apiFetch('/zamoika/api/settings/service-groups');
        const data = await resp.json();
        const currentGroups = data.groups || {};

        const newItems = artnos.map(artno => {
            const service = servicesData.find(s => s.artno === artno);
            if (service) {
                return {
                    id: service.artno,
                    name: service.name,
                    duration: service.duration || 0,
                    price: service.price || 0
                };
            }
            return artno;
        });

        currentGroups[name] = newItems;

        const saveResp = await apiFetch('/zamoika/api/settings/service-groups', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({groups: currentGroups})
        });
        const result = await saveResp.json();

        statusDiv.textContent = result.message || (result.error || 'Готово');
        statusDiv.className = `status-msg ${result.success ? 'success' : 'error'}`;

        if (result.success) {
            document.getElementById('group-name').value = '';
            document.getElementById('group-artnos').value = '';
            loadGroups();
        }
    } catch (e) {
        statusDiv.textContent = '❌ Ошибка: ' + e.message;
        statusDiv.className = 'status-msg error';
    }
}

async function deleteGroup(name) {
    if (!confirm(`Удалить группу "${name}"?`)) return;
    try {
        const resp = await apiFetch('/zamoika/api/settings/service-groups');
        const data = await resp.json();
        const groups = data.groups || {};
        delete groups[name];
        const saveResp = await apiFetch('/zamoika/api/settings/service-groups', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({groups: groups})
        });
        const result = await saveResp.json();
        if (result.success) {
            loadGroups();
        }
    } catch (e) {
        console.error('Error deleting group:', e);
    }
}

// ==========================================
// СОРТИРОВКА
// ==========================================
function addSortListeners(tableId, dataArray, renderFunction) {
    const table = document.getElementById(tableId);
    if (!table) return;

    const headers = table.querySelectorAll('th');

    headers.forEach((th, index) => {
        const keys = tableId === 'services-table'
            ? ['artno', 'color_name', 'name', 'unit', 'price']
            : ['artno', 'name', 'unit', 'stock'];

        const key = keys[index];
        if (!key) return;

        th.style.cursor = 'pointer';
        th.title = 'Нажмите для сортировки';
        th.innerHTML += ' <span class="sort-indicator">⇅</span>';

        th.addEventListener('click', () => {
            const currentDir = th.dataset.sortDir || 'asc';
            const newDir = currentDir === 'asc' ? 'desc' : 'asc';

            dataArray.sort((a, b) => {
                let valA = a[key];
                let valB = b[key];
                if (typeof valA === 'number' && typeof valB === 'number') {
                    return newDir === 'asc' ? valA - valB : valB - valA;
                }
                valA = String(valA).toLowerCase();
                valB = String(valB).toLowerCase();
                if (valA < valB) return newDir === 'asc' ? -1 : 1;
                if (valA > valB) return newDir === 'asc' ? 1 : -1;
                return 0;
            });

            headers.forEach(h => {
                delete h.dataset.sortDir;
                const ind = h.querySelector('.sort-indicator');
                if (ind) ind.textContent = '⇅';
            });

            th.dataset.sortDir = newDir;
            const ind = th.querySelector('.sort-indicator');
            if (ind) ind.textContent = newDir === 'asc' ? '↑' : '↓';

            renderFunction();
        });
    });
}

// ==========================================
// РЕДАКТИРОВАНИЕ ГРУПП
// ==========================================
function openEditGroupModal(groupName) {
    currentEditGroup = groupName;

    apiFetch('/zamoika/api/settings/service-groups')
        .then(r => r.json())
        .then(data => {
            currentEditItems = data.groups[groupName] || [];
            document.getElementById('edit-group-name').textContent = groupName;
            renderEditGroupServices();
            populateServiceSelect();
            document.getElementById('edit-group-modal').style.display = 'flex';
        })
        .catch(e => console.error('Error loading group data:', e));
}

function closeEditGroupModal() {
    document.getElementById('edit-group-modal').style.display = 'none';
    currentEditGroup = null;
    currentEditItems = [];
}

function renderEditGroupServices() {
    const container = document.getElementById('edit-group-services-list');
    container.innerHTML = '';

    if (currentEditItems.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-gray); padding: 20px;">Нет услуг в группе</div>';
        return;
    }

    currentEditItems.forEach((item, index) => {
        const serviceDiv = document.createElement('div');
        serviceDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px; background: white; border-radius: 6px; margin-bottom: 5px; border: 1px solid var(--border); gap: 10px;';

        const serviceName = typeof item === 'object' ? item.name : `Услуга ${item}`;
        const serviceId = typeof item === 'object' ? item.id : item;
        const serviceDuration = typeof item === 'object' ? (item.duration || 0) : 0;

        // 🔥 Добавляем поле для длительности
        serviceDiv.innerHTML = `
            <span style="flex: 1; font-size: 13px;"><strong>${serviceId}</strong> - ${serviceName}</span>
            <input type="number" class="edit-duration-input" data-index="${index}" value="${serviceDuration}" min="0" style="width: 70px; padding: 4px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px;" title="Длительность (мин)">
            <button class="remove-btn" onclick="removeServiceFromGroup(${index})" style="width: 24px; height: 24px; font-size: 14px; flex-shrink: 0;">✕</button>
        `;
        
        // Сохраняем изменения в поле при вводе
        const input = serviceDiv.querySelector('.edit-duration-input');
        if (input) {
            input.addEventListener('change', function() {
                const idx = parseInt(this.dataset.index);
                if (currentEditItems[idx]) {
                    currentEditItems[idx].duration = parseInt(this.value) || 0;
                    console.log(`⏱ Длительность для ${currentEditItems[idx].name} изменена на ${currentEditItems[idx].duration}`);
                }
            });
        }
        
        container.appendChild(serviceDiv);
    });
}

function populateServiceSelect() {
    const select = document.getElementById('edit-service-select');
    select.innerHTML = '<option value="">-- Выберите услугу --</option>';

    servicesData.forEach(service => {
        const exists = currentEditItems.some(item => {
            const itemId = typeof item === 'object' ? item.id : item;
            return itemId === service.artno;
        });

        if (!exists) {
            const option = document.createElement('option');
            option.value = service.artno;
            option.textContent = `${service.artno} - ${service.name}`;
            select.appendChild(option);
        }
    });
}

function addServiceToGroup() {
    const select = document.getElementById('edit-service-select');
    const artno = parseInt(select.value);

    if (!artno) {
        alert('Выберите услугу');
        return;
    }

    const service = servicesData.find(s => s.artno === artno);
    if (service) {
        currentEditItems.push({
            id: service.artno,
            name: service.name,
            duration: service.duration || 0,
            price: service.price || 0
        });
        renderEditGroupServices();
        populateServiceSelect();
    }
}

function removeServiceFromGroup(index) {
    currentEditItems.splice(index, 1);
    renderEditGroupServices();
    populateServiceSelect();
}

async function saveGroupChanges() {
    if (!currentEditGroup) return;

    try {
        const resp = await apiFetch('/zamoika/api/settings/service-groups');
        const data = await resp.json();
        const currentGroups = data.groups || {};

        currentGroups[currentEditGroup] = currentEditItems;

        const saveResp = await apiFetch('/zamoika/api/settings/service-groups', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({groups: currentGroups})
        });
        const result = await saveResp.json();

        if (result.success) {
            closeEditGroupModal();
            loadGroups();
        } else {
            alert('Ошибка сохранения: ' + (result.error || 'Неизвестная ошибка'));
        }
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

// ==========================================
// ЭКСПОРТ в window (для inline onclick="...")
// ==========================================
window.deleteChemRate = deleteChemRate;
window.editChemRate = editChemRate;
window.addChemRate = addChemRate;
window.deleteGroup = deleteGroup;
window.addGroup = addGroup;
window.openEditGroupModal = openEditGroupModal;
window.closeEditGroupModal = closeEditGroupModal;
window.addServiceToGroup = addServiceToGroup;
window.removeServiceFromGroup = removeServiceFromGroup;
window.saveGroupChanges = saveGroupChanges;

})();


async function toggleProductSite(artno, isHidden) {
    try {
        const resp = await apiFetch('/zamoika/api/settings/products/toggle-site', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ artno: artno, hidden: isHidden })
        });
        const data = await resp.json();
        if (data.success) {
            if (isHidden) hiddenProducts.add(artno);
            else hiddenProducts.delete(artno);
        } else {
            alert('Ошибка: ' + (data.error || 'Неизвестно'));
        }
    } catch (e) {
        console.error('Error toggling product:', e);
    }
}
window.toggleProductSite = toggleProductSite;
