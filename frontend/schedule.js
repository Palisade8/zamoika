// ==========================================
// schedule.js - Модуль отображения расписания
// ==========================================

const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

const safeText = function(t) {
    if (!t) return '';
    return String(t).replace(/[&<>"']/g, m => HTML_ESCAPE_MAP[m]);
};

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateRu(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    return `${parts[2]}.${parts[1]}`;
}

function getToday() {
    return formatDate(new Date());
}

function escapeAttr(val) {
    if (!val) return '';
    return String(val)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ==========================================
// 🔥 ИСПОЛЬЗУЕМ groupedServices ИЗ services.js
// ==========================================

let availableServices = [];

function getAvailableServicesFromGrouped() {
    const flatList = [];
    const grouped = window.groupedServices;

    if (grouped && typeof grouped === 'object') {
        for (const [groupName, services] of Object.entries(grouped)) {
            if (Array.isArray(services)) {
                for (const service of services) {
                    flatList.push({
                        id: service.id,
                        name: service.name,
                        duration: service.duration || 0,
                        price: service.price || 0,
                        group: groupName
                    });
                }
            }
        }
    }
    return flatList;
}

function loadServicesFromGrouped() {
    const services = getAvailableServicesFromGrouped();
    if (services.length > 0) {
        availableServices = services;
        console.log(`✅ [schedule.js] Загружено услуг из groupedServices: ${availableServices.length}`);
        return true;
    }
    return false;
}

window.addEventListener('servicesLoaded', function() {
    console.log('📡 [schedule.js] Получено событие servicesLoaded');
    loadServicesFromGrouped();
});

if (window.groupedServices && Object.keys(window.groupedServices).length > 0) {
    loadServicesFromGrouped();
} else {
    let pollAttempts = 0;
    const pollInterval = setInterval(() => {
        pollAttempts++;
        if (loadServicesFromGrouped() || pollAttempts >= 20) {
            clearInterval(pollInterval);
            if (!availableServices.length) {
                console.error('❌ [schedule.js] Не удалось загрузить услуги из groupedServices за 10 секунд');
            }
        }
    }, 500);
}

// ==========================================
// ОСНОВНЫЕ ФУНКЦИИ РАСПИСАНИЯ
// ==========================================

async function loadSchedule() {
    // 🔥 Безопасное получение дат
    let start = (typeof selectedStartDate !== 'undefined' && selectedStartDate) ? selectedStartDate : getToday();
    let end = (typeof selectedEndDate !== 'undefined' && selectedEndDate) ? selectedEndDate : start;

    if (typeof window.selectedStartDate === 'undefined') {
        window.selectedStartDate = start;
    }
    if (typeof window.selectedEndDate === 'undefined') {
        window.selectedEndDate = end;
    }

    console.log("📅 Загрузка расписания:", { start, end });

    try {
        const resp = await apiFetch(`/zamoika/api/schedule?start=${start}&end=${end}&employee=all`);

        if (!resp.ok) {
            throw new Error(`HTTP ошибка: ${resp.status}`);
        }

        const data = await resp.json();
        if (data.success) {
            renderSchedule(data, start, end);
        }
    } catch(e) {
        console.error('Ошибка загрузки расписания:', e);
        if (typeof showToast === 'function') {
            showToast('❌ Ошибка загрузки расписания', 'error');
        }
    }
}

function isOverdue(bookingDate, startTime, endTime, status) {
    if (status === 'Выполнен' || status === 'Отменен') return false;

    let finishTime = endTime;
    if (!finishTime || finishTime === '?') {
        const [hours, minutes] = startTime.split(':').map(Number);
        const endM = minutes + 30;
        finishTime = `${hours + Math.floor(endM / 60)}:${endM % 60}`;
    }

    const now = new Date();
    const [year, month, day] = bookingDate.split('-').map(Number);
    const [endHours, endMinutes] = finishTime.split(':').map(Number);

    const bookingEnd = new Date(year, month - 1, day, endHours, endMinutes, 0);
    return bookingEnd < now;
}

function getStatusClass(status, isOverdueFlag) {
    const statusMap = {
        'Запланирован': 'booking-status-scheduled',
        'Согласован': 'booking-status-confirmed',
        'Выполнен': 'booking-status-completed',
        'Отменен': 'booking-status-cancelled'
    };

    const baseClass = statusMap[status] || '';
    return isOverdueFlag ? `${baseClass} booking-overdue` : baseClass;
}

// ==========================================
// 🔥 ОТРИСОВКА РАСПИСАНИЯ (исправлена)
// ==========================================
function renderSchedule(data, startDate, endDate) {
    // Страница без расписания (например, invoices.html) — пропускаем
    if (!document.getElementById('calendar-head') && !document.getElementById('calendar-body')) {
        console.log('ℹ️ renderSchedule: на этой странице нет расписания — пропускаем');
        return;
    }
    const allDays = [];
    const cur = new Date(`${startDate}T12:00:00`);
    const end = new Date(`${endDate}T12:00:00`);

    while (cur <= end) {
        allDays.push(formatDate(cur));
        cur.setDate(cur.getDate() + 1);
    }

    const timeSlots = data.time_slots;
    const weekDays = ['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'];

    let thead = '<table><th>Время</th>';
    for (const day of allDays) {
        const dateObj = new Date(day);
        const dayIdx = dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1;
        thead += `<th>${safeText(weekDays[dayIdx])}<br>${formatDateRu(day)}</th>`;
    }
    thead += '</tr>';

    // 🔥 Безопасная установка заголовка
    const headEl = document.getElementById('calendar-head');
    if (headEl) {
        headEl.innerHTML = thead;
    } else {
        console.warn('⚠️ Элемент #calendar-head не найден');
    }

    let tbody = '';
    for (const slot of timeSlots) {
        tbody += `<tr><td class="time-cell">${slot}</td>`;
        for (const day of allDays) {
            const bookings = data.bookings[day]?.[slot] || [];
            let cell = '<div class="empty-cell">';

            for (const b of bookings) {
                const overdue = isOverdue(day, b.time_start, b.time_end, b.status);
                const statusClass = getStatusClass(b.status, overdue);
                const warningIcon = overdue ? '⚠️ ' : '';

                let displayText = `${warningIcon}${b.time_start}–${b.time_end || '?'}`;
                displayText += ` ${safeText(b.client_name.substring(0, 25))}`;
                if (b.car_number) {
                    displayText += ` 🚗${safeText(b.car_number)}`;
                }

                cell += `<div class="booking ${statusClass}"` +
                    ` data-invno="${escapeAttr(b.invno)}"` +
                    ` data-invn="${escapeAttr(b.invn || b.invno)}"` +
                    ` data-paid="${escapeAttr(b.paid || 0)}"` +
                    ` data-dopdiscount="${escapeAttr(b.dopdiscount || 0)}"` +
                    ` data-manager="${escapeAttr(b.manager_name || '')}"` +
                    ` data-name="${escapeAttr(b.client_name)}"` +
                    ` data-phone="${escapeAttr(b.client_phone)}"` +
                    ` data-car-number="${escapeAttr(b.car_number || '')}"` +
                    ` data-services="${escapeAttr(b.services_list ? b.services_list.join('||') : '')}"` +
                    ` data-time-start="${escapeAttr(b.time_start)}"` +
                    ` data-time-end="${escapeAttr(b.time_end)}"` +
                    ` data-amount="${escapeAttr(b.amount)}"` +
                    ` data-status="${escapeAttr(b.status)}"` +
                    ` data-note="${escapeAttr(b.note || '')}"` +
                    ` data-date="${day}"` +
                    ` data-overdue="${overdue}">` +
                    displayText +
                    `</div>`;
            }

            cell += '</div>';
            tbody += `<td>${cell}</td>`;
        }
        tbody += '</tr>';
    }

    // 🔥 Безопасная установка тела таблицы
    const bodyEl = document.getElementById('calendar-body');
    if (bodyEl) {
        bodyEl.innerHTML = tbody;
    } else {
        console.warn('⚠️ Элемент #calendar-body не найден');
    }

    initClicks();
}

function initClicks() {
    const bookings = document.querySelectorAll('.booking');

    bookings.forEach(booking => {
        booking.addEventListener('click', function(e) {
            e.stopPropagation();

            const target = e.currentTarget;
            const bookingData = {
                invno: target.dataset.invno,
                invn: target.dataset.invn,
                paid: parseFloat(target.dataset.paid) || 0,
                dopdiscount: parseFloat(target.dataset.dopdiscount) || 0,
                manager_name: target.dataset.manager,
                time_start: target.dataset.timeStart || '',
                time_end: target.dataset.timeEnd || '',
                client_name: target.dataset.name,
                client_phone: target.dataset.phone,
                car_number: target.dataset.carNumber || '',  // ✅ data-car-number → carNumber
                amount: parseFloat(target.dataset.amount) || 0,
                status: target.dataset.status,
                services: target.dataset.services ? target.dataset.services.split('||') : [],
                note: target.dataset.note,
                date: target.dataset.date,
                duration: 30
            };

            showModal(bookingData);
        });
    });
}

function generateDateOptions(selectedDate) {
    let options = '';
    const today = new Date();

    for (let i = 0; i < 14; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const ds = formatDate(d);
        const selected = ds === selectedDate ? 'selected' : '';
        options += `<option value="${ds}" ${selected}>${formatDateRu(ds)} (${ds})</option>`;
    }

    return options;
}

function updateTotals() {
    const items = document.querySelectorAll('#modal-services-list .service-edit-item');
    let newDuration = 0;
    let newPrice = 0;

    for (const item of items) {
        const id = parseInt(item.dataset.serviceId);
        const svc = availableServices.find(s => s.id == id);

        if (svc) {
            // 🔥 Прибавляем время только если оно > 0
            if (svc.duration > 0) {
                if (svc.duration > 0) { newDuration += svc.duration; }
            }
            newPrice += svc.price;
        }
    }

    const durationEl = document.getElementById('modal-total-duration');
    const priceEl = document.getElementById('modal-total-price');
    const finalEl = document.getElementById('modal-final-price');
    const discountInput = document.getElementById('modal-discount-input');

    if (durationEl) durationEl.textContent = newDuration;
    if (priceEl) priceEl.textContent = newPrice;

    const discount = discountInput ? (parseInt(discountInput.value) || 0) : 0;
    if (finalEl) {
        finalEl.textContent = (newPrice * (1 - discount / 100)).toFixed(2);
    }

    const discountValueSpan = document.getElementById('modal-discount-value');
    if (discountValueSpan) {
        discountValueSpan.textContent = discount;
    }

    return {
        duration: newDuration,
        price: newPrice,
        ids: Array.from(items).map(el => parseInt(el.dataset.serviceId))
    };
}

// ==========================================
// МОДАЛЬНОЕ ОКНО
// ==========================================

function showModal(b) {
    if (!b || !b.invno) {
        console.log("showModal: нет данных");
        return;
    }

    const modalBody = document.getElementById('modal-body');
    if (!modalBody) return;

    const currentServiceIds = [];
    for (const serviceName of b.services) {
        const found = availableServices.find(s => s.name === serviceName);
        if (found) {
            currentServiceIds.push(found.id);
        }
    }

    let totalDuration = 0;
    let totalPrice = 0;

    for (const serviceId of currentServiceIds) {
        const svc = availableServices.find(s => s.id == serviceId);
        if (svc) {
            if (svc.duration > 0) { totalDuration += svc.duration; }
            totalPrice += svc.price || 0;
        }
    }

    const statusOptions = ['Запланирован', 'Согласован', 'Выполнен', 'Отменен'];
    const statusHtml = `
        <select id="modal-status-select" class="status-select">
            ${statusOptions.map(opt =>
                `<option value="${opt}" ${opt === b.status ? 'selected' : ''}>${safeText(opt)}</option>`
            ).join('')}
        </select>
    `;

    const isPaid = b.paid > 0;
    const paymentHtml = `
        <div class="modal-row">
            <span class="modal-label">🔥 Счет:</span>
            <div class="modal-payment-info">
                <span class="invoice-number">№ ${escapeAttr(b.invn)}</span>
                <span class="invoice-amount">сумма ${b.amount} руб</span>
                <label class="payment-checkbox-label">
                    <input type="checkbox" id="modal-paid-checkbox" class="payment-checkbox" ${isPaid ? 'checked' : ''}>
                    Оплачен
                </label>
            </div>
        </div>
    `;

    const dateOptions = generateDateOptions(b.date);

    let servicesListHtml = '<div id="modal-services-list" class="modal-services-edit-list">';
    for (const serviceId of currentServiceIds) {
        const svc = availableServices.find(s => s.id == serviceId);
        if (svc) {
            servicesListHtml += `
                <div class="service-edit-item" data-service-id="${svc.id}">
                    <span class="service-name">${safeText(svc.name)}</span>
                    <span class="service-price">${svc.price} руб</span>
                    <button type="button" class="remove-service-btn" data-id="${svc.id}">✖</button>
                </div>
            `;
        }
    }
    servicesListHtml += '</div>';

    let servicesSelectOptions = '';

    const grouped = window.groupedServices;
    if (grouped && typeof grouped === 'object' && Object.keys(grouped).length > 0) {
        for (const [groupName, services] of Object.entries(grouped)) {
            if (!Array.isArray(services) || services.length === 0) continue;

            servicesSelectOptions += `<optgroup label="${safeText(groupName)}">`;
            for (const svc of services) {
                servicesSelectOptions += `
                    <option value="${svc.id}"
                            data-duration="${svc.duration}"
                            data-price="${svc.price}"
                            data-name="${escapeAttr(svc.name)}">
                        ${safeText(svc.name)} - ${svc.price} руб
                    </option>
                `;
            }
            servicesSelectOptions += `</optgroup>`;
        }
    } else {
        for (const svc of availableServices) {
            servicesSelectOptions += `
                <option value="${svc.id}"
                        data-duration="${svc.duration}"
                        data-price="${svc.price}"
                        data-name="${escapeAttr(svc.name)}">
                    ${safeText(svc.name)} - ${svc.price} руб
                </option>
            `;
        }
    }

    const servicesSelectHtml = `
        <select id="modal-service-select" class="modal-service-select">
            <option value="">-- Добавить услугу --</option>
            ${servicesSelectOptions}
        </select>
    `;

    const totalsHtml = `
        <div class="modal-info-row">
            <div class="info-item">
                <span class="info-label">⏱ Длительность:</span>
                <span class="info-value" id="modal-total-duration">${totalDuration}</span>
                <span class="info-unit"> мин</span>
            </div>
            <div class="info-item">
                <span class="info-label">💰 Стоимость:</span>
                <span class="info-value" id="modal-total-price">${totalPrice}</span>
                <span class="info-unit"> руб</span>
            </div>
            <div class="info-item">
                <span class="info-label">🏷️ Скидка:</span>
                <span class="info-value" id="modal-discount-value">${b.dopdiscount || 0}</span>
                <span class="info-unit">%</span>
                <input type="number" id="modal-discount-input" class="info-discount-input"
                       value="${b.dopdiscount || 0}" min="0" max="100" step="5" style="display:none;">
            </div>
            <div class="info-item info-total">
                <span class="info-label">💳 Итого:</span>
                <span class="info-value" id="modal-final-price">
                    ${(totalPrice * (1 - (b.dopdiscount || 0) / 100)).toFixed(2)}
                </span>
                <span class="info-unit"> руб</span>
            </div>
        </div>
    `;

    const carNumberHtml = `
        <div class="modal-row">
            <span class="modal-label">🚗 Номер авто:</span>
            <input type="text" id="modal-car-number" class="modal-car-input"
                   value="${escapeAttr(b.car_number || '')}"
                   placeholder="Введите номер авто">
        </div>
    `;

    modalBody.innerHTML = `
        ${paymentHtml}
        <div class="modal-row">
            <span class="modal-label">📅 Дата:</span>
            <select id="modal-date-select" class="modal-date-select">${dateOptions}</select>
        </div>
        <div class="modal-row">
            <span class="modal-label">🕒 Время:</span>
            <div class="time-slot-container modal-time-container">
                <input type="text" id="modal-time-display" class="time-display-input" value="${b.time_start}" readonly>
                <div id="modal-time-slots-dropdown" class="time-slots-dropdown" style="display: none;"></div>
            </div>
        </div>
        <div class="modal-row" style="align-items: center;">
            <span class="modal-label">👤 Клиент:</span>
            <div id="client-name-view" style="flex: 1; font-weight: 600; display: flex; align-items: center; gap: 10px;">
                <span id="client-name-text">${safeText(b.client_name)}</span>
                <button type="button" id="btn-edit-name" title="Редактировать имя" style="background: none; border: none; cursor: pointer; font-size: 16px; opacity: 0.6; padding: 0;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">✏️</button>
            </div>
            <div id="client-name-edit" style="flex: 1; display: none; gap: 5px; align-items: center;">
                <input type="text" id="modal-client-name-input" value="${escapeAttr(b.client_name)}" style="flex: 1; padding: 6px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px;">
                <button type="button" id="btn-cancel-edit-name" style="background: #dc3545; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer;">✖</button>
            </div>
        </div>
        ${carNumberHtml}
        <div class="modal-row modal-row-phone">
            <span class="modal-label"></span>
            <div class="phone-block">
                <a href="tel:${escapeAttr(b.client_phone)}" class="phone-link">${escapeAttr(b.client_phone)}</a>
                <button onclick="window.makeCall('${escapeAttr(b.client_phone)}')" class="btn-call">📞 Позвонить</button>
            </div>
        </div>
        <div class="modal-row">
            <span class="modal-label">👔 Менеджер:</span>
            <div>${safeText(b.manager_name || '—')}</div>
        </div>
        <div class="modal-row modal-services-edit-row">
            <span class="modal-label">🛠 Услуги:</span>
            <div class="modal-services-edit-content">
                ${servicesListHtml}
                <div class="add-service-row">
                    ${servicesSelectHtml}
                    <button type="button" id="modal-add-service-btn" class="btn-add-service">+</button>
                </div>
            </div>
        </div>
        ${totalsHtml}
        <div class="modal-row">
            <span class="modal-label"> Статус:</span>
            ${statusHtml}
        </div>
        ${b.note ? `
            <div class="modal-row">
                <span class="modal-label">📝 Прим:</span>
                <div>${safeText(b.note)}</div>
            </div>
        ` : ''}
        <div class="modal-actions-bottom">
            <div style="display: flex; gap: 10px; margin-bottom: 10px;"><button type="button" class="btn-submit" style="background: #17a2b8; color: white; flex: 1;" onclick="printInvoice(${b.invno})">🖨️ Печать счёта</button><button type="button" class="btn-submit" style="background: #28a745; color: white; flex: 1;" onclick="printAct(${b.invno})">🖨️ Печать акта</button></div><button id="save-all-btn" class="btn-save-status">💾 Сохранить изменения</button>
            <span id="status-message" class="status-message"></span>
        </div>
    `;

    document.getElementById('bookingModal').style.display = 'flex';

    if (typeof initModalTimePicker === 'function') {
        initModalTimePicker(b.date, b.time_start, totalDuration || 30);
    }

    if (b.client_phone && b.client_phone.length >= 10) {
        setTimeout(() => {
            applyDiscountToModal(b.client_phone);
        }, 100);
    }

    const addBtn = document.getElementById('modal-add-service-btn');
    if (addBtn) {
        addBtn.addEventListener('click', function() {
            const select = document.getElementById('modal-service-select');
            const id = parseInt(select.value);

            if (!id) return;

            if (document.querySelector(`#modal-services-list .service-edit-item[data-service-id="${id}"]`)) {
                if (typeof showToast === 'function') {
                    showToast('Услуга уже добавлена', 'warning');
                }
                select.value = '';
                return;
            }

            const svc = availableServices.find(s => s.id == id);
            if (svc) {
                const list = document.getElementById('modal-services-list');
                const div = document.createElement('div');
                div.className = 'service-edit-item';
                div.dataset.serviceId = id;
                div.innerHTML = `
                    <span class="service-name">${safeText(svc.name)}</span>
                    <span class="service-price">${svc.price} руб</span>
                    <button type="button" class="remove-service-btn">✖</button>
                `;

                const removeBtn = div.querySelector('.remove-service-btn');
                if (removeBtn) {
                    removeBtn.addEventListener('click', function() {
                        div.remove();
                        updateTotals();
                    });
                }

                list.appendChild(div);
                select.value = '';
                updateTotals();
            }
        });
    }

    document.querySelectorAll('#modal-services-list .remove-service-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const item = btn.closest('.service-edit-item');
            if (item) {
                item.remove();
                updateTotals();
            }
        });
    });

    const discountInput = document.getElementById('modal-discount-input');
    if (discountInput) {
        discountInput.addEventListener('input', function() {
            const discount = parseInt(discountInput.value) || 0;
            const discountSpan = document.getElementById('modal-discount-value');
            if (discountSpan) {
                discountSpan.textContent = discount;
            }
            updateTotals();
        });
    }

    const saveBtn = document.getElementById('save-all-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', async function() {
            const newStatus = document.getElementById('modal-status-select').value;
            const isPaidChecked = document.getElementById('modal-paid-checkbox').checked;
            const newDate = document.getElementById('modal-date-select').value;
            const newTime = document.getElementById('modal-time-display').value;
            const newDiscount = parseInt(document.getElementById('modal-discount-input').value) || 0;
            const newCarNumber = document.getElementById('modal-car-number').value;
            const messageSpan = document.getElementById('status-message');

            const serviceItems = document.querySelectorAll('#modal-services-list .service-edit-item');
            const serviceIds = Array.from(serviceItems).map(item => parseInt(item.dataset.serviceId));

            // 🔥 Проверяем услуги ТОЛЬКО если статус НЕ "Отменен"
            if (newStatus !== 'Отменен' && serviceIds.length === 0) {
                if (messageSpan) {
                    messageSpan.textContent = '❌ Добавьте хотя бы одну услугу!';
                    messageSpan.style.color = '#d32f2f';
                }
                return;
            }

            let newDuration = 0;
            for (const serviceId of serviceIds) {
                const svc = availableServices.find(s => s.id == serviceId);
                if (svc) {
                    // 🔥 Прибавляем время только если оно > 0
                    if (svc.duration > 0) {
                        if (svc.duration > 0) { newDuration += svc.duration; }
                    }
                }
            }

            // empno больше не нужен — бэкенд берёт его из JWT-cookie
            console.log('📤 Отправка:', {
                invno: b.invno,
                services: serviceIds,
                date: newDate,
                time: newTime,
                duration: newDuration,
                discount: newDiscount,
                status: newStatus,
                paid: isPaidChecked,
                car_number: newCarNumber
            });

            if (messageSpan) {
                messageSpan.textContent = 'Сохранение...';
                messageSpan.style.color = 'var(--text-gray)';
            }

            try {
                // 🔥 Сначала проверяем, изменилось ли имя клиента
                const editWrap = document.getElementById('client-name-edit');
                const inputName = document.getElementById('modal-client-name-input');
                const oldName = document.getElementById('client-name-text').innerText;

                if (editWrap && editWrap.style.display === 'flex' && inputName) {
                    const newName = inputName.value.trim();
                    if (newName && newName !== oldName) {
                        
                        // 👇 ДОБАВЛЕНО ДЛЯ ОТЛАДКИ
                        console.log('🚀 Отправка имени в API. INVNO:', b.invno, 'Тип:', typeof b.invno);

                        const resName = await apiFetch('/zamoika/api/update-client-name', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            // 👇 Убрали parseInt, чтобы бэкенд сам разобрался с типом
                            body: JSON.stringify({ invno: b.invno, client_name: newName })
                        });
                        const dataName = await resName.json();
                        if (!dataName.success) {
                            if (messageSpan) {
                                messageSpan.textContent = `❌ Ошибка имени: ${dataName.error || 'неизвестно'}`;
                                messageSpan.style.color = '#d32f2f';
                            }
                            return; // Прерываем сохранение заявки
                        }
                        console.log('✅ Имя клиента обновлено на:', newName);
                    }
                }
                // Далее — стандартное сохранение заявки
                const resp = await apiFetch('/zamoika/api/update-booking-full', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        invno: parseInt(b.invno),
                        services: serviceIds,
                        date: newDate,
                        time: newTime,
                        duration: newDuration,
                        discount: newDiscount,
                        status: newStatus,
                        paid: isPaidChecked,
                        car_number: newCarNumber
                    })
                });

                const data = await resp.json();
                console.log('📥 Ответ:', data);

                if (data.success) {
                    if (messageSpan) {
                        messageSpan.textContent = '✅ Сохранено!';
                        messageSpan.style.color = 'var(--success)';
                    }
                    setTimeout(() => {
                        document.getElementById('bookingModal').style.display = 'none';
                        loadSchedule();
                    }, 500);
                } else {
                    if (messageSpan) {
                        messageSpan.textContent = `❌ ${data.error || 'Ошибка'}`;
                        messageSpan.style.color = '#d32f2f';
                    }
                }
            } catch(e) {
                console.error('Ошибка сохранения:', e);
                if (messageSpan) {
                    messageSpan.textContent = `❌ Ошибка: ${e.message}`;
                    messageSpan.style.color = '#d32f2f';
                }
            }

            setTimeout(() => {
                if (messageSpan) {
                    messageSpan.textContent = '';
                }
            }, 3000);
        });
    }
}

async function applyDiscountToModal(phone) {
    if (!phone) return;

    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) return;

    try {
        const resp = await apiFetch(`/zamoika/api/get-discount-by-client?phone=${digits}`);

        if (!resp.ok) {
            throw new Error(`HTTP ошибка: ${resp.status}`);
        }

        const data = await resp.json();
        console.log('Скидка для модального окна:', data);

        if (data.success && data.discount > 0) {
            const discountInput = document.getElementById('modal-discount-input');
            const discountSpan = document.getElementById('modal-discount-value');

            if (discountInput) {
                discountInput.value = data.discount;

                if (discountSpan) {
                    discountSpan.textContent = data.discount;
                }

                discountInput.dispatchEvent(new Event('input'));

                if (typeof showToast === 'function') {
                    showToast(`🎉 Скидка ${data.discount}% применена`, 'success');
                }
            }
        }
    } catch(e) {
        console.error('Error applying discount to modal:', e);
    }
}

const closeBtn = document.querySelector('.modal-close');
if (closeBtn) {
    closeBtn.addEventListener('click', function() {
        const modal = document.getElementById('bookingModal');
        if (modal) {
            modal.style.display = 'none';
        }
    });
}

window.addEventListener('click', function(e) {
    const modal = document.getElementById('bookingModal');
    if (modal && e.target === modal) {
        modal.style.display = 'none';
    }
});

window.addEventListener('load', function() {
    console.log('📅 Загрузка расписания...');
    loadSchedule();
});

function initBooking() {
    console.log('🔧 initBooking вызвана');

    const newBookingBtn = document.getElementById('new-booking-btn');
    if (newBookingBtn) {
        newBookingBtn.onclick = function() {
            const formCard = document.querySelector('.form-card');
            if (formCard) {
                if (formCard.style.display === 'none' || formCard.style.display === '') {
                    formCard.style.display = 'block';
                    this.textContent = '➖ Скрыть форму';
                } else {
                    formCard.style.display = 'none';
                    this.textContent = '➕ Новая заявка';
                }
            }
        };
    }

    const chemBtn = document.getElementById('show-chemical-btn');
    if (chemBtn) {
        chemBtn.onclick = function() {
            if (typeof window.showChemicalModal === 'function') {
                window.showChemicalModal();
            } else {
                console.warn('⚠️ showChemicalModal не определена');
            }
        };
    }

    const invoicesBtn = document.getElementById('invoices-btn');
    if (invoicesBtn) {
        invoicesBtn.onclick = function() {
            window.location.href = '/zamoika/invoices.html';
        };
    }
}

window.initBooking = initBooking;

document.addEventListener('DOMContentLoaded', function() {
    if (typeof initBooking === 'function') {
        initBooking();
    }
});

// ==========================================
// 🔥 ДЕЛЕГИРОВАНИЕ СОБЫТИЙ ДЛЯ РЕДАКТИРОВАНИЯ ИМЕНИ
// Работает для динамически созданных элементов (модалка)
// ==========================================
document.addEventListener('click', function(e) {
    // 1. Клик по карандашу ✏️
    if (e.target && e.target.id === 'btn-edit-name') {
        e.preventDefault();
        e.stopPropagation();
        const viewName = document.getElementById('client-name-view');
        const editName = document.getElementById('client-name-edit');
        const inputName = document.getElementById('modal-client-name-input');

        if (viewName && editName && inputName) {
            viewName.style.display = 'none';
            editName.style.display = 'flex';
            inputName.focus();
            inputName.select();
            console.log('✏️ Включен режим редактирования имени');
        } else {
            console.warn('⚠️ Не найдены элементы редактирования');
        }
    }

    // 2. Клик по крестику ✖ (отмена)
    if (e.target && e.target.id === 'btn-cancel-edit-name') {
        e.preventDefault();
        e.stopPropagation();
        const viewName = document.getElementById('client-name-view');
        const editName = document.getElementById('client-name-edit');
        const textName = document.getElementById('client-name-text');
        const inputName = document.getElementById('modal-client-name-input');

        if (viewName && editName && textName && inputName) {
            editName.style.display = 'none';
            viewName.style.display = 'flex';
            inputName.value = textName.innerText;
            console.log('✖️ Отмена редактирования имени');
        }
    }
});


// ==========================================
// 🔥 АВТООБНОВЛЕНИЕ РАСПИСАНИЯ (каждые 30 секунд)
// ==========================================
let autoRefreshTimer = null;

function startAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);

    autoRefreshTimer = setInterval(() => {
        // Проверяем, что мы не в модальном окне и страница активна
        const modal = document.getElementById('bookingModal');
        const isModalOpen = modal && modal.style.display === 'flex';

        // Проверяем, что мы на странице расписания (а не в настройках)
        const isSchedulePage = document.getElementById('calendar-body') !== null;

        if (!isModalOpen && isSchedulePage && document.visibilityState === 'visible') {
            console.log('🔄 Автообновление расписания...');
            if (typeof loadSchedule === 'function') { loadSchedule(); } else { console.warn('loadSchedule не определена'); }
        } else {
            console.log('⏸️ Автообновление пропущено (модалка открыта или вкладка неактивна)');
        }
    }, 10000); // 10 секунд (10000 мс)
}

// Запускаем после полной загрузки страницы
document.addEventListener('DOMContentLoaded', function() {
    // Небольшая задержка, чтобы первоначальная загрузка прошла без конфликтов
    setTimeout(startAutoRefresh, 5000);
});

// Если пользователь ушел со вкладки и вернулся — сразу обновляем
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
        const isSchedulePage = document.getElementById('calendar-body') !== null;
        const modal = document.getElementById('bookingModal');
        if (!modal || modal.style.display !== 'flex') {
            if (isSchedulePage) loadSchedule();
        }
    }
});

// ==========================================
// 🖨️ ПЕЧАТЬ ДОКУМЕНТОВ (СЧЕТ / АКТ)
// ==========================================
function printInvoice(invno) {
    if (!invno) {
        alert('Ошибка: не найден номер счёта');
        return;
    }
    window.open(`/zamoika/api/documents/invoice/${invno}/pdf`, '_blank');
}

function printAct(invno) {
    if (!invno) {
        alert('Ошибка: не найден номер счёта');
        return;
    }
    window.open(`/zamoika/api/documents/act/${invno}/pdf`, '_blank');
}
