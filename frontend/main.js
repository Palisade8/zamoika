// main.js - Инициализация
// ==========================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ==========================================
let currentUser = null;

// ==========================================
// 🌐 apiFetch — обёртка над fetch с cookie-авторизацией
// ==========================================
async function apiFetch(url, options = {}) {
    const resp = await fetch(url, {
        ...options,
        credentials: 'same-origin',   // ← cookie отправляется автоматически
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });

    if (resp.status === 401) {
        // Сессия истекла — разлогиниваем
        console.warn('401 Unauthorized — clearing session');
        try {
            const authForm = document.getElementById('auth-form');
            const userInfo = document.getElementById('user-info');
            if (authForm) authForm.style.display = 'flex';
            if (userInfo) userInfo.style.display = 'none';
            document.querySelectorAll('.auth-dependent').forEach(el => el.style.display = 'none');
            if (typeof showToast === 'function') {
                showToast('Сессия истекла. Войдите заново.', 'warning');
            }
        } catch(e) { console.warn(e); }
        throw new Error('Unauthorized');
    }

    return resp;
}

// ==========================================
// 🔑 Idempotency-Key — защита от двойных броней
// ==========================================
function generateIdempotencyKey() {
    if (window.crypto && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback для старых браузеров
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

let timeSlotsVisible = false;
let currentChemicalUsage = {};
let selectedDate = null;

window.selectedServices = [];
window.selectedAdditionalServices = [];

// ==========================================
// ФОРМАТИРОВАНИЕ ТЕЛЕФОНА
// ==========================================
function formatPhone(value) {
    if (!value) return '';
    let digits = value.replace(/\D/g, '');
    if (digits.length === 0) return '';
    if (digits.startsWith('7')) {
        digits = '8' + digits.slice(1);
    } else if (!digits.startsWith('8')) {
        digits = '8' + digits;
    }
    digits = digits.slice(0, 11);
    let formatted = '8';
    if (digits.length > 1) {
        const part1 = digits.slice(1, 4);
        formatted += part1 ? ` (${part1}` : ' (';
    }
    if (digits.length >= 5) {
        formatted += `) ${digits.slice(4, 7)}`;
    }
    if (digits.length >= 8) {
        formatted += `-${digits.slice(7, 9)}`;
    }
    if (digits.length >= 10) {
        formatted += `-${digits.slice(9, 11)}`;
    }
    return formatted;
}

// ==========================================
// УТИЛИТЫ
// ==========================================
if (typeof escapeHtml === 'undefined') {
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }
}
const safeHtml = escapeHtml;

function formatDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getToday() {
    return formatDate(new Date());
}

function getDefaultDate() {
    let now = new Date();
    let hours = now.getHours();
    let minutes = now.getMinutes();
    if (hours > 21 || (hours === 21 && minutes >= 55)) {
        let tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return formatDate(tomorrow);
    }
    return getToday();
}

// ==========================================
// УВЕДОМЛЕНИЯ (TOAST)
// ==========================================
function showToast(message, type = 'info') {
    const existingToast = document.querySelector('.toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    switch(type) {
        case 'error': toast.style.background = '#d32f2f'; break;
        case 'success': toast.style.background = '#2e7d32'; break;
        case 'warning': toast.style.background = '#ff9800'; break;
        default: toast.style.background = '#333';
    }
    toast.textContent = message;
    document.body.appendChild(toast);

    void toast.offsetWidth;
    toast.style.opacity = '1';

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==========================================
// ФУНКЦИЯ ЗВОНКА
// ==========================================
window.makeCall = async function(phone) {
    if (!phone || phone === '—') {
        showToast('Номер телефона не указан', 'error');
        return;
    }
    if (!confirm(`Позвонить клиенту на номер ${phone}?\n\nВы будете соединены через внутренний номер 30.`)) return;
    try {
        const resp = await apiFetch('/zamoika/api/make-callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, manager_ext: '30' })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        data.success ? showToast('✅ Звонок инициирован!\nВаш телефон (внутренний номер 30) скоро зазвонит.', 'success')
                     : showToast('❌ Ошибка: ' + (data.error || 'Неизвестная ошибка'), 'error');
    } catch(e) {
        showToast('❌ Ошибка соединения: ' + e.message, 'error');
        console.error('Callback error:', e);
    }
};

// ==========================================
// ПРОВЕРКА ПЕРЕСЕЧЕНИЯ ВРЕМЕНИ
// ==========================================
async function checkDurationLocal() {
    const selectedTime = document.getElementById("booking-time")?.value;
    const duration = parseInt(document.getElementById("booking-duration")?.value || "10");
    const selectedDateVal = document.getElementById("booking-date")?.value;

    let warningEl = document.getElementById("time-warning");
    if (!warningEl) {
        const container = document.getElementById("booking-time")?.parentElement;
        if (container) {
            warningEl = document.createElement("div");
            warningEl.id = "time-warning";
            warningEl.className = "time-warning";
            container.appendChild(warningEl);
        }
    }
    warningEl = document.getElementById("time-warning");
    if (!warningEl) return;

    if (!selectedTime || duration === 0) {
        warningEl.style.display = "none";
        document.getElementById("booking-time")?.classList.remove("input-error");
        return;
    }
    try {
        const resp = await apiFetch(`/zamoika/api/free-slots?date=${selectedDateVal}&duration=${duration}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (data.success && data.slots) {
            const isAvailable = data.slots.includes(selectedTime);
            if (!isAvailable) {
                const [hours, minutes] = selectedTime.split(':').map(Number);
                let endMinutes = minutes + duration;
                let endHours = hours + Math.floor(endMinutes / 60);
                endMinutes %= 60;
                const endTime = `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
                warningEl.innerHTML = `⚠️ Интервал ${selectedTime}–${endTime} пересекается с существующей записью.`;
                warningEl.style.display = "block";
                document.getElementById("booking-time")?.classList.add("input-error");
            } else {
                warningEl.style.display = "none";
                document.getElementById("booking-time")?.classList.remove("input-error");
            }
        }
    } catch(e) { console.error('Duration check error:', e); }
}

// ==========================================
// ФУНКЦИЯ ПОКАЗА МОДАЛЬНОГО ОКНА ДЛЯ ВЫБОРА ТОВАРОВ
// ==========================================
async function showChemicalSelectionModal(chemicalUsage) {
    const stockResp = await apiFetch('/zamoika/api/stock-balance');
    const stockData = await stockResp.json();

    if (!stockData.success || !stockData.stocks) {
        showToast('Ошибка загрузки остатков', 'error');
        return;
    }

    const stocks = stockData.stocks;

    let modal = document.getElementById('chemicalSelectionModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'chemicalSelectionModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 800px;">
                <div class="modal-header">
                    <span>🧪 Выбор товаров для списания</span>
                    <span class="modal-close">&times;</span>
                </div>
                <div id="chemical-selection-body" style="max-height: 60vh; overflow-y: auto; padding: 15px;"></div>
                <div style="padding: 15px; border-top: 1px solid #ddd;">
                    <button id="confirm-chemical-btn" class="btn-submit">✅ Создать накладную</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('.modal-close').onclick = () => modal.style.display = 'none';
    }

    let html = '<h4>Выберите товары для списания:</h4>';

    for (const [chemical, itemData] of Object.entries(chemicalUsage)) {
        if (!itemData || typeof itemData !== 'object' || !('unit' in itemData)) {
            console.error(`❌ Некорректный формат для ${chemical}:`, itemData);
            continue;
        }

        const amount = itemData.amount || 0;
        const unit = itemData.unit || 'мл.';
        const displayAmount = unit.trim().startsWith('шт') ? Math.ceil(amount) : amount;

        function scoreMatch(chem, stockName) {
            const c = chem.toLowerCase().trim();
            const s = stockName.toLowerCase().trim();
            if (s === c) return 100;
            if (s.startsWith(c)) return 90;
            if (c.includes(s) && s.split(' ').length >= 2) return 80;
            if (s.includes(c)) return 70;
            const cw = c.split(' ').slice(0, 2).join(' ');
            const sw = s.split(' ').slice(0, 2).join(' ');
            if (cw === sw) return 60;
            const fsw = s.split(' ')[0];
            if (c.includes(fsw) && fsw.length > 3) return 40;
            const fcw = c.split(' ')[0];
            if (s.includes(fcw) && fcw.length > 3) return 20;
            return 0;
        }

        const CHEM_TO_ARTNOS = {
            "Шампунь авто": [1, 25, 27, 28, 29, 33, 34, 35, 36, 38, 39, 42, 43, 44, 45, 46, 47, 66],
            "Чернитель резины": [2, 41],
            "Воск": [4, 40],
            "Незамерзайка": [22, 71],
            "Очиститель дисков": [55],
            "Средство от мух": [56],
            "Замша": [52],
            "Салфетка": [53],
            "Стеклоомыватель": [57, 59],
            "Полироль": [61],
            "Сертификат": [62, 63]
        };

        const validArtnos = CHEM_TO_ARTNOS[chemical] || [];
        let candidates = [];
        if (validArtnos.length > 0) {
            candidates = stocks.filter(s => validArtnos.includes(s.artno)).map(s => ({ ...s, score: 100 }));
        }

        if (candidates.length < 5) {
            const byName = stocks
                .filter(s => !validArtnos.includes(s.artno))
                .map(s => ({ ...s, score: scoreMatch(chemical, s.name) }))
                .filter(s => s.score > 0);
            candidates.push(...byName);
        }

        candidates.sort((a, b) => b.score !== a.score ? b.score - a.score : a.name.localeCompare(b.name));
        const matchingStocks = candidates.slice(0, 5);

        html += `
            <div style="border: 1px solid #ddd; margin: 10px 0; padding: 10px; border-radius: 5px;">
                <div style="font-weight: bold; margin-bottom: 8px;">
                    📍 ${escapeHtml(chemical)}: нужно списать ${displayAmount} ${escapeHtml(unit)}
                </div>
                <div style="margin-left: 15px;">
                    <label>Выберите товар со склада:</label>
                    <select id="select_${chemical.replace(/\s/g, '_')}" class="chemical-select"
                            data-chemical="${chemical}" data-amount="${amount}" data-unit="${unit}"
                            style="width: 100%; padding: 5px; margin-top: 5px;">
                        <option value="">-- выберите товар --</option>
        `;

        for (const stock of matchingStocks) {
            const stockAmount = stock.qty;
            const stockUnit = stock.unit;
            const badge = stock.score >= 90 ? '🟢' : stock.score >= 60 ? '🟡' : '🔴';
            html += `<option value='${JSON.stringify({artno: stock.artno, clrno: stock.clrno || 0, name: stock.name, qty: stockAmount})}'>
                ${badge} ${escapeHtml(stock.name)} [${stock.score} балл.] - остаток: ${stockAmount} ${escapeHtml(stockUnit)}
            </option>`;
        }

        html += `
                    </select>
                    <div style="margin-top: 5px; font-size: 12px; color: #666;">
                        💡 Если подходящего товара нет в списке, добавьте его на склад через приходную накладную
                    </div>
                </div>
            </div>
        `;
    }
    document.getElementById('chemical-selection-body').innerHTML = html;
    modal.style.display = 'flex';

    document.getElementById('confirm-chemical-btn').onclick = async () => {
        const items = [];
        const selects = document.querySelectorAll('.chemical-select');

        for (const select of selects) {
            const selectedValue = select.value;
            if (selectedValue) {
                const item = JSON.parse(selectedValue);
                const chemical = select.dataset.chemical;
                const amount = parseFloat(select.dataset.amount);
                const unit = select.dataset.unit;

                let qty = unit.trim().startsWith('шт') ? Math.ceil(amount) : Math.ceil(amount);

                items.push({
                    artno: item.artno,
                    clrno: item.clrno,
                    qty: qty,
                    price: 0
                });
            }
        }

        if (items.length === 0) {
            showToast("Не выбран ни один товар", 'error');
            return;
        }

        try {
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];

            const resp = await apiFetch("/zamoika/api/create-movement-invoice", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    date: todayStr,
                    items: items,
                    note: `Автосписание химии за ${todayStr}`
                })
            });
            const result = await resp.json();
            if (result.success) {
                showToast(`✅ Расходная накладная №${result.naklno} создана!`, 'success');
                modal.style.display = 'none';
                window.location.href = "/zamoika/invoices.html";
            } else {
                showToast("❌ Ошибка: " + result.error, 'error');
            }
        } catch(e) {
            showToast("❌ Ошибка сети: " + e.message, 'error');
            console.error('Create invoice error:', e);
        }
    };
}

// ==========================================
// РАСХОДНЫЕ МАТЕРИАЛЫ (МОДАЛЬНОЕ ОКНО)
// ==========================================
window.showChemicalModal = async function() {
    const startDate = (typeof selectedStartDate !== 'undefined' && selectedStartDate) ? selectedStartDate : getToday();
    const endDate = (typeof selectedEndDate !== 'undefined' && selectedEndDate) ? selectedEndDate : startDate;

    let modal = document.getElementById('chemicalModal');

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'chemicalModal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content chemical-modal">
                <div class="modal-header">
                    <span>🧪 Расходные материалы</span>
                    <span class="chemical-modal-close">&times;</span>
                </div>
                <div id="chemical-body" class="modal-body"></div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('.chemical-modal-close').onclick = () => modal.style.display = 'none';
        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    }

    modal.style.display = 'flex';
    const bodyDiv = document.getElementById('chemical-body');
    bodyDiv.innerHTML = '<div class="loading-text">Загрузка...</div>';

    try {
        const resp = await apiFetch(`/zamoika/api/chemical-usage?start=${startDate}&end=${endDate}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        const data = await resp.json();

        if (!data.success) {
            bodyDiv.innerHTML = `<div class="error-message">Ошибка: ${escapeHtml(data.error)}</div>`;
            return;
        }

        const totalUsage = data.total_usage || {};
        currentChemicalUsage = totalUsage;

        if (Object.keys(totalUsage).length === 0) {
            bodyDiv.innerHTML = `<div class="empty-state">Нет выполненных услуг за период ${escapeHtml(startDate)} - ${escapeHtml(endDate)}</div>`;
            return;
        }

        let html = `<h4 class="modal-subtitle">Расходные материалы за период ${escapeHtml(startDate)} - ${escapeHtml(endDate)}:</h4>
            <table class="dynamic-table"><thead><tr><th>Химическое средство</th><th class="text-right">Расход</th></tr></thead><tbody>`;

        for (const [chemical, data] of Object.entries(totalUsage)) {
            if (!data || typeof data !== 'object' || !('unit' in data)) {
                console.error(`❌ Некорректный формат данных для ${chemical}:`, data);
                continue;
            }
            const amount = Number(data.amount || 0).toLocaleString();
            const unit = escapeHtml(data.unit);
            html += `<tr><td>${escapeHtml(chemical)}</td><td class="text-right">${amount} ${unit}</td></tr>`;
        }

        html += `</tbody></table>`;
        html += `<div class="modal-actions"><button id="create-from-chemical-btn" class="btn-create">📄 Заполнить расходную накладную</button></div>`;
        bodyDiv.innerHTML = html;

        document.getElementById("create-from-chemical-btn")?.addEventListener("click", async () => {
            const today = new Date();
            const todayStr = getToday();

            if (today.getHours() < 21 || (today.getHours() === 21 && today.getMinutes() < 30)) {
                showToast("⏰ Создать расходную накладную можно только после 21:30!", 'error');
                return;
            }

            try {
                const statusResp = await apiFetch(`/zamoika/api/check-day-status?date=${todayStr}`);
                if (!statusResp.ok) throw new Error(`HTTP ${statusResp.status}`);
                const statusData = await statusResp.json();
                if (statusData.has_pending) {
                    showToast(`⚠️ Есть ${statusData.pending_count} незавершенных записей за сегодня!`, 'error');
                    return;
                }
            } catch(e) {
                showToast("Ошибка проверки статуса: " + e.message, 'error');
                return;
            }

            showChemicalSelectionModal(totalUsage);
        });
    } catch(e) {
        bodyDiv.innerHTML = `<div class="error-message">Ошибка: ${escapeHtml(e.message)}</div>`;
        console.error('Chemical modal error:', e);
    }
};

document.getElementById('show-chemical-btn')?.addEventListener('click', () => window.showChemicalModal());
document.getElementById('invoices-btn')?.addEventListener('click', () => {
    window.location.href = "/zamoika/invoices.html";
});

// ==========================================
// НОВАЯ ЗАЯВКА - СКРЫТИЕ/ПОКАЗ ФОРМЫ
// ==========================================
let newBookingBtn = document.getElementById('new-booking-btn');
if (newBookingBtn) {
    newBookingBtn.addEventListener('click', function() {
        const formCard = document.querySelector('.form-card');
        if (formCard) {
            if (formCard.style.display === 'none' || formCard.style.display === '') {
                formCard.style.display = 'block'; formCard.classList.add('visible');
                this.textContent = '➖ Скрыть форму';
            } else {
                formCard.style.display = 'none';
                this.textContent = '➕ Новая заявка';
            }
        }
    });
}

// ==========================================
// АВТОПОИСК ПО ТЕЛЕФОНУ + МАСКА + ПРОВЕРКА КОДОВ
// ==========================================
(function() {
    const phoneField = document.getElementById("client-phone");
    if (!phoneField) return;

    let phoneSelect = document.getElementById("phone-select");
    if (!phoneSelect) {
        phoneSelect = document.createElement("select");
        phoneSelect.id = "phone-select";
        phoneSelect.size = 5;
        phoneSelect.className = "phone-autocomplete";
        phoneSelect.style.display = "none";
        phoneField.parentElement?.appendChild(phoneSelect);
    }
    phoneSelect.style.display = "none";

    const VALID_CODES = new Set([
        900, 901, 902, 903, 904, 905, 906, 908, 909, 910, 911, 912, 913, 914, 915, 916, 917, 918, 919, 920, 921, 922, 923, 924, 925, 926, 927, 928, 929, 930, 931, 932, 933, 934, 936, 937, 938, 939, 950, 951, 952, 953, 958, 960, 961, 962, 963, 964, 965, 966, 967, 968, 969, 977, 978, 979, 980, 981, 982, 983, 984, 985, 986, 987, 988, 989, 991, 992, 993, 994, 995, 996, 999,
        877, 385, 388, 416, 818, 851, 472, 483, 301, 492, 844, 817, 820, 473, 872, 426, 343, 493, 873, 395, 866, 401, 847, 484, 415, 878, 814, 384, 833, 821, 494, 861, 862, 391, 352, 471, 813, 474, 413, 836, 834, 495, 499, 496, 498, 815, 831, 816, 383, 381, 353, 486, 841, 342, 423, 811, 863, 491, 846, 848, 812, 845, 424, 867, 481, 865, 879, 475, 843, 855, 482, 382, 487, 394, 345, 341, 842, 347, 421, 390, 346, 351, 871, 302, 835, 427, 411, 349, 485, 869, 365
    ]);

    function isValidPhone(phone) {
        const digits = phone.replace(/\D/g, '');
        if (digits.length !== 11 || !digits.startsWith('8')) return false;
        const code = digits.slice(1, 4);
        return VALID_CODES.has(parseInt(code, 10));
    }

    function showPhoneError(msg) {
        const errorDiv = document.getElementById('phone-error');
        if (errorDiv) {
            errorDiv.textContent = msg;
            errorDiv.style.display = 'block';
        }
        phoneField.classList.add('input-error');
    }

    function hidePhoneError() {
        const errorDiv = document.getElementById('phone-error');
        if (errorDiv) {
            errorDiv.style.display = 'none';
            errorDiv.textContent = '';
        }
        phoneField.classList.remove('input-error');
    }

    let searchTimeout;
    phoneField.addEventListener("input", async function() {
        const formatted = formatPhone(this.value);
        this.value = formatted;
        hidePhoneError();

        const digits = formatted.replace(/\D/g, '');

        clearTimeout(searchTimeout);

        if (digits.length >= 4) {
            searchTimeout = setTimeout(async () => {
                try {
                    const resp = await apiFetch(`/zamoika/api/search-client?q=${digits}`);
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const data = await resp.json();
                    if (data.success && data.clients && data.clients.length) {
                        phoneSelect.innerHTML = "";
                        for (const p of data.clients) {
                            const option = document.createElement("option");
                            const phoneValue = p.phone || "";
                            const nameValue = p.name || "Клиент";
                            const noteValue = p.note || "";
                            option.value = phoneValue;
                            option.textContent = phoneValue ? `${phoneValue} - ${nameValue}` : nameValue;
                            option.dataset.name = nameValue;
                            option.dataset.phone = phoneValue;
                            option.dataset.note = noteValue;
                            option.onclick = function(e) {
                                e.preventDefault();
                                const phoneInput = document.getElementById("client-phone");
                                const nameInput = document.getElementById("client-name");
                                const noteInput = document.getElementById("booking-note");
                                if (phoneInput && this.dataset.phone) {
                                    phoneInput.value = formatPhone(this.dataset.phone);
                                }
                                if (nameInput && this.dataset.name) nameInput.value = this.dataset.name;
                                phoneSelect.style.display = "none";

                                hidePhoneError();
                                if (noteInput && this.dataset.note) {
                                    noteInput.value = this.dataset.note;
                                }
                                if (this.dataset.phone) {
                                    loadClientData(this.dataset.phone);
                                }
                            };
                            phoneSelect.appendChild(option);
                        }
                        phoneSelect.style.display = "block";
                        const rect = phoneField.getBoundingClientRect();
                        phoneSelect.style.top = (rect.bottom + window.scrollY) + "px";
                        phoneSelect.style.left = (rect.left + window.scrollX) + "px";
                        phoneSelect.style.width = rect.width + "px";
                    } else { phoneSelect.style.display = "none"; }
                } catch(e) { console.error("Phone search error: ", e); }
            }, 300);
        } else { phoneSelect.style.display = "none"; }
    });

    phoneField.addEventListener("blur", function() {
        setTimeout(() => phoneSelect.style.display = "none", 200);
        const val = this.value;
        if (val && val.length > 5) {
            if (!isValidPhone(val)) {
                const digits = val.replace(/\D/g, '');
                const code = digits.slice(1, 4);
                if (digits.length === 11 && digits.startsWith('8') && !VALID_CODES.has(parseInt(code, 10))) {
                    showPhoneError(`❌ Код ${code} не существует в РФ`);
                } else if (digits.length !== 11) {
                    showPhoneError('❌ Введите 11 цифр: 8 (999) 123-45-67');
                }
            }
        }
    });

    phoneField.addEventListener("change", function() {
        this.value = formatPhone(this.value);
    });
})();

// ==========================================
// АВТОПОИСК ПО ИМЕНИ КЛИЕНТА
// ==========================================
(function() {
    const nameField = document.getElementById("client-name");
    if (!nameField) return;

    let nameSelect = document.getElementById("name-select");
    if (!nameSelect) {
        nameSelect = document.createElement("select");
        nameSelect.id = "name-select";
        nameSelect.size = 5;
        nameSelect.className = "phone-autocomplete";
        nameSelect.style.display = "none";
        nameField.parentElement?.appendChild(nameSelect);
    }
    nameSelect.style.display = "none";

    let searchTimeout = null;

    nameField.addEventListener("input", function() {
        const name = this.value.trim();
        if (name.length < 3) {
            nameSelect.style.display = "none";
            return;
        }

        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }

        searchTimeout = setTimeout(async () => {
            try {
                const encodedName = encodeURIComponent(name);
                const resp = await apiFetch(`/zamoika/api/search-client?q=${encodedName}`);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();

                if (data.success && data.clients && data.clients.length > 0) {
                    nameSelect.innerHTML = "";
                    for (const client of data.clients) {
                        const option = document.createElement("option");
                        const nameValue = client.name || "Клиент";
                        const phoneValue = client.phone || "";
                        const noteValue = client.note || "";
                        option.value = phoneValue;
                        option.textContent = `${nameValue} (${phoneValue})`;
                        option.dataset.name = nameValue;
                        option.dataset.phone = phoneValue;
                        option.dataset.note = noteValue;

                        option.onclick = function(e) {
                            e.preventDefault();
                            const nameInput = document.getElementById("client-name");
                            const phoneInput = document.getElementById("client-phone");
                            const noteInput = document.getElementById("booking-note");

                            if (nameInput && this.dataset.name) {
                                nameInput.value = this.dataset.name;
                            }
                            if (phoneInput && this.dataset.phone) {
                                phoneInput.value = formatPhone(this.dataset.phone);
                            }
                            if (noteInput && this.dataset.note) {
                                noteInput.value = this.dataset.note;
                            }
                            nameSelect.style.display = "none";

                            if (this.dataset.phone) {
                                loadClientData(this.dataset.phone);
                                applyDiscountByClientPhone(this.dataset.phone);
                            }
                        };
                        nameSelect.appendChild(option);
                    }
                    nameSelect.style.display = "block";
                    const rect = nameField.getBoundingClientRect();
                    nameSelect.style.top = (rect.bottom + window.scrollY) + "px";
                    nameSelect.style.left = (rect.left + window.scrollX) + "px";
                    nameSelect.style.width = Math.max(rect.width, 300) + "px";
                } else {
                    nameSelect.style.display = "none";
                }
            } catch(e) {
                console.error("Search by name error:", e);
                nameSelect.style.display = "none";
            }
        }, 300);
    });

    nameField.addEventListener("blur", function() {
        setTimeout(() => {
            nameSelect.style.display = "none";
        }, 200);
    });

    nameField.addEventListener("keydown", function(e) {
        if (e.key === "Enter") {
            nameSelect.style.display = "none";
            if (searchTimeout) {
                clearTimeout(searchTimeout);
            }
        }
    });
})();

// ==========================================
// ПЕРЕКЛЮЧЕНИЕ ПОЛЕЙ ЮР. ЛИЦА
// ==========================================
function toggleLegalFields(show) {
    const fields = document.getElementById('legal-entity-fields');
    if (fields) {
        fields.style.display = show ? 'block' : 'none';
    }

    const checkbox = document.getElementById('is-legal-entity');
    if (checkbox) {
        const label = checkbox.closest('label');
        if (label) {
            if (show) {
                label.style.background = '#e8f5e9';
                label.style.padding = '5px 10px';
                label.style.borderRadius = '8px';
                label.style.border = '1px solid #4caf50';
            } else {
                label.style.background = 'transparent';
                label.style.padding = '0';
                label.style.border = 'none';
            }
        }
    }
}

window.toggleLegalFields = toggleLegalFields;

// ==========================================
// АВТОМАТИЧЕСКАЯ СКИДКА ПО ТЕЛЕФОНУ КЛИЕНТА
// ==========================================
async function applyDiscountByClientPhone(inputPhone) {
    if (!inputPhone || inputPhone.length < 10) return 0;
    try {
        const digits = inputPhone.replace(/\D/g, '');
        const resp = await apiFetch(`/zamoika/api/get-discount-by-client?phone=${digits}`);
        const data = await resp.json();
        if (data.success && data.discount > 0) {
            const discountInput = document.getElementById('discount');
            if (discountInput) {
                discountInput.value = data.discount;
                discountInput.dispatchEvent(new Event('input'));
                showToast(`🎉 Скидка ${data.discount}% для клиента`, 'success');
            }
            return data.discount;
        }
        return 0;
    } catch(e) {
        console.error('Error fetching discount:', e);
        return 0;
    }
}

document.addEventListener('DOMContentLoaded', function() {


    const phoneField = document.getElementById('client-phone');
    if (phoneField) {
        phoneField.addEventListener('blur', function() {
            const phone = this.value;
            if (phone && phone.length >= 10) {
                applyDiscountByClientPhone(phone);
            }
        });
    }
});

// ==========================================
// ЗАГРУЗКА ДАННЫХ КЛИЕНТА ПРИ АВТОПОИСКЕ
// ==========================================
async function loadClientData(phone) {
    try {
        const resp = await apiFetch(`/zamoika/api/search-client?q=${phone}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (data.success && data.clients && data.clients.length > 0) {
            const client = data.clients[0];

            const nameInput = document.getElementById('client-name');
            const phoneInput = document.getElementById('client-phone');

            if (nameInput && client.name) {
                nameInput.value = client.name;
            }
            if (phoneInput && client.phone) {
                phoneInput.value = formatPhone(client.phone);
            }

            const isLegal = client.is_legal || false;
            const legalCheckbox = document.getElementById('is-legal-entity');
            if (legalCheckbox) {
                legalCheckbox.checked = isLegal;
                toggleLegalFields(isLegal);
            }

            if (isLegal) {
                const orgName = document.getElementById('legal-orgname');
                const inn = document.getElementById('legal-inn');
                const kpp = document.getElementById('legal-kpp');
                const ogrn = document.getElementById('legal-ogrn');
                const bik = document.getElementById('legal-bik');
                const bankName = document.getElementById('legal-bankname');
                const rs = document.getElementById('legal-rs');
                const ks = document.getElementById('legal-ks');
                const contno = document.getElementById('legal-contno');

                if (orgName) orgName.value = client.org_name || client.name || '';
                if (inn) inn.value = client.inn || '';
                if (kpp) kpp.value = client.kpp || '';
                if (ogrn) ogrn.value = client.ogrn || '';
                if (bik) bik.value = client.bik || '';
                if (bankName) bankName.value = client.bank_name || '';
                if (rs) rs.value = client.rs || '';
                if (ks) ks.value = client.ks || '';
                if (contno) contno.value = client.contno || '';
            }

            if (client.phone) {
                applyDiscountByClientPhone(client.phone);
            }

            return client;
        }
        return null;
    } catch(e) {
        console.error('Error loading client data:', e);
        return null;
    }
}

window.loadClientData = loadClientData;

// ==========================================
// ИНИЦИАЛИЗАЦИЯ & ОБРАБОТЧИКИ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const timeSelect = document.getElementById('booking-time');
    if (timeSelect) {
        timeSelect.addEventListener('change', function() { this.size = 1; this.blur(); });
    }
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => { modal.style.display = 'none'; });
    if (typeof loadServices === 'function') loadServices();
    if (typeof renderCalendar === 'function') renderCalendar();
    if (typeof loadSchedule === 'function') loadSchedule();

    const dateInput = document.getElementById('booking-date');
    if (dateInput && !dateInput.value) dateInput.value = getDefaultDate();
    if (dateInput) {
        dateInput.addEventListener('change', () => {
            if (timeSlotsVisible && typeof window.generateTimeSlotsGrid === 'function') {
                window.generateTimeSlotsGrid();
            }
        });
    }
    const durationInput = document.getElementById('booking-duration');
    if (durationInput) {
        durationInput.addEventListener('change', () => {
            if (timeSlotsVisible && typeof window.generateTimeSlotsGrid === 'function') {
                const dateInput = document.getElementById('booking-date');
                const durationInput = document.getElementById('booking-duration');
                if (dateInput && dateInput.value) {
                    window.generateTimeSlotsGrid(dateInput.value, parseInt(durationInput?.value || '30'), null, 'time-slots-dropdown', false);
                }
            }
        });
    }

    const legalCheckbox = document.getElementById('is-legal-entity');
    if (legalCheckbox) {
        legalCheckbox.addEventListener('change', function() {
            toggleLegalFields(this.checked);
        });
    }
});

window.onclick = function(e) {
    const chemicalModal = document.getElementById('chemicalModal');
    if (e.target == chemicalModal) chemicalModal.style.display = 'none';
    const chemicalSelectionModal = document.getElementById('chemicalSelectionModal');
    if (e.target == chemicalSelectionModal) chemicalSelectionModal.style.display = 'none';
    const newModal = document.getElementById('newBookingModal');
    if (e.target == newModal) newModal.style.display = 'none';
    const bookingModal = document.getElementById('bookingModal');
    if (e.target == bookingModal) bookingModal.style.display = 'none';
};

const discountInput = document.getElementById('discount');
if (discountInput) {
    discountInput.addEventListener('input', function() {
        let val = parseInt(this.value) || 0;
        if (val > 100) this.value = 100;
        if (val < 0) this.value = 0;
        if (typeof updateSelectedServicesList === 'function') {
            updateSelectedServicesList();
        }
    });
}

// ==========================================
// АВТОРИЗАЦИЯ
// ==========================================
async function loadEmployees() {
    try {
        const resp = await apiFetch('/zamoika/api/employees');
        const data = await resp.json();
        if (data.success) {
            const select = document.getElementById('auth-user');
            if (select) {
                select.innerHTML = '<option value="">Выберите сотрудника</option>';
                for (const emp of data.employees) {
                    select.innerHTML += `<option value="${emp.id}">${safeHtml(emp.name)}</option>`;
                }
            } else {
                console.warn('⚠️ Элемент #auth-user не найден');
            }
        }
    } catch(e) { console.error('Error loading employees:', e); }
}

async function checkAuth(empno, password) {
    try {
        const resp = await apiFetch('/zamoika/api/check-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ empno, password }) });
        return await resp.json();
    } catch(e) { console.error('Auth error:', e); return { success: false, error: e.message }; }
}

async function login() {
    const empno = document.getElementById('auth-user').value;
    const password = document.getElementById('auth-password').value;
    const errorDiv = document.getElementById('auth-error');
    if (!empno) { errorDiv.textContent = 'Выберите сотрудника'; errorDiv.style.display = 'block'; return; }
    if (!password) { errorDiv.textContent = 'Введите пароль'; errorDiv.style.display = 'block'; return; }
    errorDiv.style.display = 'none';
    const result = await checkAuth(empno, password);
    if (result.success) {
        currentUser = result.user;
        // Cookie уже установлена сервером — ничего в localStorage не пишем
        document.getElementById('auth-form').style.display = 'none';
        document.body.classList.remove('read-only-mode'); // 🔥 Убираем режим чтения
        document.getElementById('user-info').style.display = 'flex';
        document.body.classList.remove('read-only-mode'); // 🔥 Убираем режим чтения
        document.getElementById('user-name').textContent = currentUser.name;
        document.querySelectorAll('.auth-dependent:not(.modal)').forEach(el => el.style.display = 'block');
        showToast(`Добро пожаловать, ${safeHtml(currentUser.name)}!`, 'success');
    } else {
        errorDiv.textContent = result.error || 'Неверный пароль'; errorDiv.style.display = 'block';
    }
}

async function logout() {
    // Сначала пробуем удалить cookie на сервере
    try {
        await apiFetch('/zamoika/api/logout', { method: 'POST' });
    } catch(e) {
        // 401 — это нормально, если cookie уже истекла
        console.warn('Logout API error (ignored):', e.message);
    }

    // Локальный разлогин — ВСЕГДА
    currentUser = null;
    const authForm = document.getElementById('auth-form');
    const userInfo = document.getElementById('user-info');
    const authPassword = document.getElementById('auth-password');
    const authUser = document.getElementById('auth-user');

    if (authForm) authForm.style.display = 'flex';
    if (userInfo) userInfo.style.display = 'none';
    if (authPassword) authPassword.value = '';
    if (authUser) authUser.value = '';

    document.querySelectorAll('.auth-dependent').forEach(el => {
        el.style.display = 'none';
    });

    if (typeof showToast === 'function') {
        showToast('🚪 Смена закрыта', 'info');
    }
}

async function checkSession() {
    try {
        const resp = await apiFetch('/zamoika/api/me');
        if (resp.ok) {
            const result = await resp.json();
            if (result.success) {
                currentUser = result.user;
                const authForm = document.getElementById('auth-form');
                const userInfo = document.getElementById('user-info');
                const userName = document.getElementById('user-name');
                if (authForm) authForm.style.display = 'none';
                if (userInfo) userInfo.style.display = 'flex';
                if (userName) userName.textContent = currentUser.name;
                document.querySelectorAll('.auth-dependent:not(.modal)').forEach(el => el.style.display = 'block');
                console.log('✅ Session restored:', currentUser);
        document.body.classList.remove('read-only-mode'); // 🔥 ПРИНУДИТЕЛЬНО УБИРАЕМ РЕЖИМ ЧТЕНИЯ
                return;
            }
        }
    } catch(e) {
        console.warn('Session check failed:', e);
    }
    // Сессии нет — показываем форму логина, если она есть
    const authForm = document.getElementById('auth-form');
    if (authForm) authForm.style.display = 'flex';
}

document.addEventListener('DOMContentLoaded', () => {
    const elementsToHide = ['.form-card', '#new-booking-btn', '#show-chemical-btn', '#invoices-btn'];
    elementsToHide.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => { el.classList.add('auth-dependent'); el.style.display = 'none'; });
    });
    loadEmployees(); checkSession();
    
    // Принудительно скрываем модалку при загрузке
    const bookingModal = document.getElementById('bookingModal');
    if (bookingModal) {
        bookingModal.style.display = 'none';
    }

    const authBtn = document.getElementById('auth-btn');
    if (authBtn) {
        authBtn.onclick = login;
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.onclick = async function(e) {
            if (e) e.preventDefault();
            try {
                await logout();
            } catch(err) {
                // Даже если /api/logout упал — разлогиниваем локально
                console.error('Logout error:', err);
                currentUser = null;
                const authForm = document.getElementById('auth-form');
                const userInfo = document.getElementById('user-info');
                if (authForm) authForm.style.display = 'flex';
                if (userInfo) userInfo.style.display = 'none';
                document.querySelectorAll('.auth-dependent').forEach(el => {
                    el.style.display = 'none';
                });
                if (typeof showToast === 'function') {
                    showToast('Смена закрыта', 'info');
                }
            }
        };
    }
});

// ==========================================
// ТИП КЛИЕНТА & СОЗДАНИЕ ЗАЯВКИ
// ==========================================
function getClientTypeFromCheckbox() {
    const legalCheckbox = document.getElementById('is-legal-schedule');
    const isLegal = legalCheckbox ? legalCheckbox.checked : false;
    return { client_type: isLegal ? 1 : 0, urlts: isLegal ? 1 : 0 };
}

// ==========================================
// РЕНДЕРИНГ МЕСЯЧНОГО КАЛЕНДАРЯ
// ==========================================
function selectCalendarDate(dateStr) {
    selectedDate = dateStr;
    document.querySelectorAll('.calendar-day').forEach(el => el.classList.remove('selected'));
    if (event?.target) event.target.classList.add('selected');

    const dateInput = document.getElementById('booking-date');
    if (dateInput) {
        dateInput.value = dateStr;
        if (typeof window.generateTimeSlotsGrid === 'function') {
            window.generateTimeSlotsGrid();
        }
    }

    if (typeof loadSchedule === 'function') {
        selectedStartDate = dateStr;
        selectedEndDate = dateStr;
        loadSchedule();
    }
}

// ==========================================
// SUBMIT BOOKING
// ==========================================
async function submitBooking(e) {
    e.preventDefault();

    const form = e.target;

    const operationType = document.querySelector('input[name="operation-type"]:checked');
    const isServiceMode = operationType && operationType.value === 'service';

    let clientName = document.getElementById('client-name')?.value || '';
    let clientPhone = document.getElementById('client-phone')?.value || '';
    let bookingDate = document.getElementById('booking-date')?.value || '';

    let bookingTime = '';
    const timeSelect = document.getElementById('booking-time');
    if (timeSelect) {
        bookingTime = timeSelect.value;
    }

    if (!bookingTime) {
        const timeDisplay = document.getElementById('booking-time-display');
        if (timeDisplay) {
            bookingTime = timeDisplay.value;
        }
    }

    let duration = parseInt(document.getElementById('booking-duration')?.value || 0);
    let discount = parseInt(document.getElementById('discount')?.value) || 0;
    let comment = document.getElementById('booking-note')?.value || '';
    let serviceIds = [];
    let totalPrice = 0;

    // empno больше не нужен — бэкенд берёт его из JWT


    const isLegal = document.getElementById('is-legal-entity')?.checked || false;
    const legalData = {
        org_name: document.getElementById('legal-orgname')?.value || '',
        inn: document.getElementById('legal-inn')?.value || '',
        kpp: document.getElementById('legal-kpp')?.value || '',
        ogrn: document.getElementById('legal-ogrn')?.value || '',
        bik: document.getElementById('legal-bik')?.value || '',
        bank_name: document.getElementById('legal-bankname')?.value || '',
        rs: document.getElementById('legal-rs')?.value || '',
        ks: document.getElementById('legal-ks')?.value || '',
        contno: document.getElementById('legal-contno')?.value || ''
    };

    if (isServiceMode) {
        const services = window.selectedServices || [];
        serviceIds = services.map(s => s.id);

        const chatIdVal = document.getElementById('client-chat-id')?.value?.trim() || '';

        // 🔥 Если ID-чата НЕ заполнен, требуем имя и телефон (как раньше)
        if (!chatIdVal) {
            if (!clientName) {
                showToast('❌ Введите имя клиента', 'error');
                return;
            }
            if (!clientPhone || clientPhone.length < 10) {
                showToast('❌ Введите корректный телефон', 'error');
                return;
            }
        } else {
            // Если ID-чата есть, но имя пустое — ставим заглушку
            if (!clientName) {
                clientName = 'Клиент ' + chatIdVal;
            }
            // Если телефона нет — ставим заглушку (чтобы база не упала)
            if (!clientPhone || clientPhone.length < 10) {
                clientPhone = '80000000000';
            }
        }
        if (!bookingDate) {
            showToast('❌ Выберите дату', 'error');
            return;
        }
        if (!bookingTime) {
            showToast('❌ Выберите время', 'error');
            return;
        }
        if (services.length === 0) {
            showToast('❌ Добавьте хотя бы одну услугу', 'error');
            return;
        }

        for (const s of services) {
            totalPrice += s.price || 0;
        }

        duration = parseInt(duration) || 30;
        serviceIds = serviceIds.map(id => parseInt(id)).filter(id => !isNaN(id));

        let client_type = isLegal ? 1 : 0;
        let urlts = isLegal ? 1 : 0;

        const data = {
            client_name: clientName.trim(),
            client_phone: clientPhone.replace(/\D/g, ''),
            chat_id: chatIdVal,
            date: bookingDate,
            time: bookingTime,
            duration: duration,
            services: serviceIds,
            note: comment.trim(),
            discount: discount,
            client_type: client_type,
            urlts: urlts,
            org_name: legalData.org_name,
            inn: legalData.inn,
            kpp: legalData.kpp,
            ogrn: legalData.ogrn,
            bik: legalData.bik,
            bank_name: legalData.bank_name,
            rs: legalData.rs,
            ks: legalData.ks,
            contno: legalData.contno
        };

        try {
            const idempotencyKey = generateIdempotencyKey();
            const resp = await apiFetch('/zamoika/api/create-booking', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': idempotencyKey,
                },
                body: JSON.stringify(data)
            });

            const result = await resp.json();

            if (result.success) {
                showToast('✅ Заявка успешно создана!', 'success');

                // 🔥 СОХРАНЯЕМ ДАТУ
                const savedDate = document.getElementById('booking-date')?.value || getToday();

                form.reset();
                window.selectedServices = [];
                if (typeof updateSelectedServicesList === 'function') {
                    updateSelectedServicesList();
                }

                // 🔥 ВОССТАНАВЛИВАЕМ ДАТУ
                const dateInput = document.getElementById('booking-date');
                if (dateInput) {
                    dateInput.value = savedDate;
                    dateInput.dispatchEvent(new Event('change'));
                }

                if (typeof loadSchedule === 'function') loadSchedule();
                if (typeof renderCalendar === 'function') renderCalendar();
                toggleLegalFields(false);
            } else {
                let errorMsg = result.error || 'Неизвестная ошибка';
                if (result.detail) {
                    if (Array.isArray(result.detail)) {
                        errorMsg = result.detail.map(d => d.msg || d.message || JSON.stringify(d)).join(', ');
                    } else if (typeof result.detail === 'object') {
                        errorMsg = Object.entries(result.detail).map(([k, v]) => `${k}: ${v}`).join(', ');
                    } else {
                        errorMsg = JSON.stringify(result.detail);
                    }
                }
                showToast('❌ Ошибка: ' + errorMsg, 'error');
                console.error('❌ Детали ошибки:', result);
            }
        } catch(e) {
            showToast('❌ Ошибка сети: ' + e.message, 'error');
            console.error('❌ Ошибка отправки:', e);
        }

    } else {
        // Режим товаров
        const productRows = document.querySelectorAll('.product-row');
        const products = [];
        let totalProductsPrice = 0;

        productRows.forEach(row => {
            const select = row.querySelector('.product-select');
            const qty = parseInt(row.querySelector('.product-qty')?.value) || 0;
            const price = parseFloat(select?.selectedOptions[0]?.dataset?.price) || 0;
            const name = select?.selectedOptions[0]?.dataset?.name || '';
            const id = select?.value;

            if (id && qty > 0) {
                products.push({
                    artno: parseInt(id),
                    qty: qty,
                    price: price,
                    name: name
                });
                totalProductsPrice += price * qty;
            }
        });

        if (products.length === 0) {
            showToast('❌ Добавьте хотя бы один товар', 'error');
            return;
        }

        if (!clientName) clientName = 'Продажа товаров';
        if (!clientPhone || clientPhone.length < 10) clientPhone = '89210000000';

        const productComment = products.map(p => `${p.name} (${p.qty} шт)`).join(', ');

        const isArendych = document.getElementById('is-arendych')?.checked || false;

        const isPaidProduct = document.getElementById('is-paid-product')?.checked ?? true;

        const invoiceData = {
            client_name: clientName.trim(),
            client_phone: clientPhone.replace(/\D/g, ''),
            items: products.map(p => ({
                artno: p.artno,
                qty: p.qty,
                price: p.price
            })),
            discount: discount,
            note: `Продажа товаров: ${productComment}`,
            is_arendych: isArendych,
            is_paid: isPaidProduct
        };

        try {
            const idempotencyKey = generateIdempotencyKey();
            const resp = await apiFetch('/zamoika/api/create-product-invoice', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': idempotencyKey,
                },
                body: JSON.stringify(invoiceData)
            });

            const result = await resp.json();

            if (resp.ok && result.success) {
                showToast(`✅ Накладная №${result.naklno} на продажу создана!`, 'success');

                // 🔥 Модальное окно с кнопкой печати счёта
                if (result.invno) {
                    const modal = document.createElement('div');
                    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:9999;';
                    modal.innerHTML = `
                        <div style="background:white; padding:30px; border-radius:12px; max-width:420px; text-align:center; box-shadow:0 10px 40px rgba(0,0,0,0.3);">
                            <h3 style="margin:0 0 15px; color:#2e7d32;">✅ Накладная создана</h3>
                            <p style="margin:5px 0; font-size:14px;">Накладная: <b>№${result.naklno}</b></p>
                            <p style="margin:5px 0; font-size:14px;">Счёт: <b>№${result.invno}</b></p>
                            <div style="display:flex; gap:10px; margin-top:25px;">
                                <button id="print-inv-btn" style="flex:1; padding:12px; background:#17a2b8; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:bold; font-size:14px;">🖨️ Печать счёта</button>
                                <button id="close-inv-btn" style="flex:1; padding:12px; background:#6c757d; color:white; border:none; border-radius:6px; cursor:pointer; font-size:14px;">Закрыть</button>
                            </div>
                        </div>
                    `;
                    document.body.appendChild(modal);

                    document.getElementById('print-inv-btn').onclick = () => {
                        window.open(`/zamoika/api/documents/invoice/${result.invno}/pdf`, '_blank');
                    };
                    document.getElementById('close-inv-btn').onclick = () => modal.remove();
                }

                // 🔥 СОХРАНЯЕМ ДАТУ
                const savedDate = document.getElementById('booking-date')?.value || getToday();

                form.reset();

                const productList = document.getElementById('product-list');
                if (productList) productList.innerHTML = '';
                const productTotal = document.getElementById('product-total');
                if (productTotal) productTotal.value = '0 руб';

                const priceInput = document.getElementById('booking-price');
                if (priceInput) priceInput.value = '0 руб';

                const totalCostInput = document.getElementById('total-cost');
                if (totalCostInput) totalCostInput.value = 0;

                // 🔥 ВОССТАНАВЛИВАЕМ ДАТУ
                const dateInput = document.getElementById('booking-date');
                if (dateInput) {
                    dateInput.value = savedDate;
                    dateInput.dispatchEvent(new Event('change'));
                }

                const formCard = document.querySelector('.form-card');
                const newBookingBtn = document.getElementById('new-booking-btn');
                if (formCard && newBookingBtn) {
                    formCard.style.display = 'none';
                    newBookingBtn.textContent = '➕ Новая заявка';
                }

                if (typeof loadSchedule === 'function') loadSchedule();

            } else {
                let errorMsg = result.error || 'Неизвестная ошибка';
                if (result.detail) {
                    if (Array.isArray(result.detail)) {
                        errorMsg = result.detail.map(d => d.msg || d.message || JSON.stringify(d)).join(', ');
                    } else if (typeof result.detail === 'object') {
                        errorMsg = Object.entries(result.detail).map(([k, v]) => `${k}: ${v}`).join(', ');
                    } else {
                        errorMsg = JSON.stringify(result.detail);
                    }
                }
                showToast('❌ Ошибка: ' + errorMsg, 'error');
                console.error('❌ Детали ошибки:', result);
            }
        } catch(e) {
            console.error('❌ Ошибка отправки:', e);
            showToast('❌ Ошибка сети: ' + e.message, 'error');
        }
    }
}

window.submitBooking = submitBooking;

// ==========================================
// ПЕРЕКЛЮЧЕНИЕ ТИПА ОПЕРАЦИИ
// ==========================================
function toggleOperationType() {
    const serviceRadio = document.querySelector('input[name="operation-type"][value="service"]');
    const productRadio = document.querySelector('input[name="operation-type"][value="product"]');
    const serviceFields = document.getElementById('service-fields');
    const productFields = document.getElementById('product-fields');
    const serviceLabel = document.getElementById('service-type-label');
    const productLabel = document.getElementById('product-type-label');

    const isService = serviceRadio && serviceRadio.checked;

    if (serviceFields) serviceFields.style.display = isService ? 'block' : 'none';
    if (productFields) {
        productFields.style.display = isService ? 'none' : 'block';
        if (!isService && typeof loadProductsForSale === 'function') {
            if (typeof productsLoaded === 'undefined' || !productsLoaded) {
                loadProductsForSale();
            } else {
                if (typeof initializeProductList === 'function') {
                    initializeProductList();
                }
            }
        }
    }

    if (serviceLabel) {
        serviceLabel.style.background = isService ? 'var(--primary)' : 'transparent';
        serviceLabel.style.color = isService ? 'white' : 'var(--text-dark)';
        serviceLabel.style.borderColor = isService ? 'var(--primary)' : 'var(--border)';
    }
    if (productLabel) {
        productLabel.style.background = isService ? 'transparent' : 'var(--primary)';
        productLabel.style.color = isService ? 'var(--text-dark)' : 'white';
        productLabel.style.borderColor = isService ? 'var(--border)' : 'var(--primary)';
    }
}

window.toggleOperationType = toggleOperationType;

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', function() {
    toggleOperationType();

    if (typeof loadProductsForSale === 'function') {
        loadProductsForSale();
    }
});


// ==========================================
// ✅ ГАРАНТИРОВАННАЯ ПРИВЯЗКА submitBooking к форме
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('new-booking-form');
    if (!form) {
        console.warn('⚠️  #new-booking-form не найден');
        return;
    }
    
    // Убираем возможные старые обработчики
    form.onsubmit = null;
    
    // Явно вешаем обработчик
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('🎯 Форма submit перехвачена, вызываю submitBooking');
        
        if (typeof submitBooking === 'function') {
            submitBooking(e).catch(err => {
                console.error('❌ submitBooking упал:', err);
                if (typeof showToast === 'function') {
                    showToast('❌ Ошибка: ' + (err.message || err), 'error');
                }
            });
        } else {
            console.error('❌ submitBooking не найдена — проверьте main.js');
        }
    });
    
    console.log('✅ submitBooking привязан к форме');
});


// ============================================
// 🔥 РЕЖИМ ТОЛЬКО ЧТЕНИЕ (Read-Only)
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    // Проверяем наличие токена в localStorage (или cookie, если используется)
    const token = localStorage.getItem('token') || localStorage.getItem('jwt');
    
    if (!token) {
        document.body.classList.add('read-only-mode');
        console.log('🔒 Включен режим "Только чтение" (нет авторизации)');
    }
});

// Если сессия сбрасывается (401), включаем read-only
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    try {
        const response = await originalFetch.apply(this, args);
        if (response.status === 401) {
            document.body.classList.add('read-only-mode');
            console.log('🔒 Сессия истекла. Включен режим "Только чтение"');
        }
        return response;
    } catch (e) {
        throw e;
    }
};
