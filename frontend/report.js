/**
 * report.js - Модуль формирования отчета о всех счетах за день
 */
const ReportModule = {
    data: null,
    elements: {},

    SALARY_RATES: {
        base: 2000,
        per_row: 20,
        threshold: 18,
        wash_rates: {
            10: 150,
            15: 230,
            20: 300,
            30: 350,
            40: 400,
            50: 450,
            60: 500,
            70: 600
        }
    },

    ARENDYCH_PHONE: '89810410000',

    init: function() {
        this.elements.dateInput = document.getElementById('report-date');
        this.elements.generateBtn = document.getElementById('generate-report-btn');
        this.elements.exportBtn = document.getElementById('export-pdf-btn');
        this.elements.printBtn = document.getElementById('print-report-btn');
        this.elements.resultContainer = document.getElementById('report-result');
        this.elements.section = document.getElementById('report-section');

        if (!this.elements.generateBtn || !this.elements.resultContainer) return;

        if (!this.elements.dateInput.value) {
            this.elements.dateInput.value = new Date().toISOString().split('T')[0];
        }

        this.elements.generateBtn.addEventListener('click', this.handleGenerate.bind(this));
        if (this.elements.exportBtn) this.elements.exportBtn.addEventListener('click', this.handleExportPDF.bind(this));
        if (this.elements.printBtn) this.elements.printBtn.addEventListener('click', this.handlePrint.bind(this));
        
        // 🔥 Обработчики для фильтров
        const filterPaid = document.getElementById('filter-paid');
        const filterCompleted = document.getElementById('filter-completed');
        if (filterPaid) filterPaid.addEventListener('change', () => this.renderFiltered());
        if (filterCompleted) filterCompleted.addEventListener('change', () => this.renderFiltered());

        // 🔥 Инициализация отчёта «Арендыч»
        const arendychBtn = document.getElementById('arendych-generate-btn');
        const arendychMonth = document.getElementById('arendych-month');
        if (arendychBtn && arendychMonth) {
            const now = new Date();
            arendychMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            arendychBtn.addEventListener('click', this.handleGenerateArendych.bind(this));
            console.log('🚗 Arendych report инициализирован');
        }

        if (this.elements.section) {
            // Проверка сессии через /api/me (JWT в cookie)
            apiFetch('/zamoika/api/me')
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    if (data && data.success) {
                        this.elements.section.classList.remove('auth-dependent');
                        this.elements.section.classList.add('visible');
                        this.elements.section.style.display = 'block';
                    }
                })
                .catch(() => {
                    // не авторизован — секция остаётся скрытой
                });
        }

        console.log('✅ ReportModule инициализирован');
    },

    getServiceDurationByArtno: function(artno) {
        const services = window.groupedServices || {};

        if (typeof services === 'undefined' || !services || Object.keys(services).length === 0) {
            return 0;
        }

        for (const [groupName, servicesList] of Object.entries(services)) {
            for (const service of servicesList) {
                if (service.id === artno) {
                    return service.duration || 0;
                }
            }
        }
        return 0;
    },

    getServiceDurationByName: function(serviceName) {
        const services = window.groupedServices || {};

        if (typeof services === 'undefined' || !services || Object.keys(services).length === 0) {
            return 0;
        }

        const cleanItemName = (serviceName || '').trim().toLowerCase();

        for (const [groupName, servicesList] of Object.entries(services)) {
            for (const service of servicesList) {
                const cleanServiceName = (service.name || '').trim().toLowerCase();
                if (cleanServiceName === cleanItemName) {
                    return service.duration || 0;
                }
            }
        }
        return 0;
    },

    calculateArendychBonus: function(invoices) {
        const arendychInvoices = [];
        let totalBonus = 0;

        invoices.forEach(inv => {
            const phone = (inv.client_phone || '').replace(/\D/g, '');
            if (phone === this.ARENDYCH_PHONE) {
                let invoiceDuration = 0;
                if (inv.items && Array.isArray(inv.items)) {
                    inv.items.forEach(item => {
                        const duration = this.getServiceDurationByArtno(item.artno);
                        invoiceDuration += duration;
                    });
                }

                let bonus = 0;
                let appliedRate = 0;
                if (invoiceDuration > 0) {
                    const bonusRates = this.SALARY_RATES.wash_rates;
                    const durations = Object.keys(bonusRates).map(Number).sort((a, b) => a - b);

                    for (const dur of durations) {
                        if (invoiceDuration <= dur) {
                            appliedRate = dur;
                            bonus = bonusRates[dur];
                            break;
                        }
                    }

                    if (bonus === 0 && invoiceDuration > 70) {
                        appliedRate = 70;
                        bonus = bonusRates[70];
                    }

                    if (bonus === 0 && invoiceDuration > 0) {
                        appliedRate = 10;
                        bonus = bonusRates[10];
                    }

                    totalBonus += bonus;
                }

                arendychInvoices.push({
                    invno: inv.invno,
                    client_name: inv.client_name,
                    duration: invoiceDuration,
                    bonus: bonus,
                    appliedRate: appliedRate,
                    items: inv.items || []
                });
            }
        });

        return {
            totalWashes: arendychInvoices.length,
            totalBonus: totalBonus,
            invoices: arendychInvoices
        };
    },

    handleGenerate: async function() {
        const date = this.elements.dateInput.value;
        if (!date) { alert('Выберите дату'); return; }

        this.elements.generateBtn.disabled = true;
        this.elements.generateBtn.textContent = '⏳ Загрузка...';
        this.elements.resultContainer.style.display = 'block';
        this.elements.resultContainer.innerHTML = '<div class="loading-text">Запрос данных...</div>';

        if (this.elements.exportBtn) this.elements.exportBtn.style.display = 'none';
        if (this.elements.printBtn) this.elements.printBtn.style.display = 'none';

        try {
            const response = await apiFetch(`/zamoika/api/invoices-report?date=${date}`);
            const json = await response.json();

            console.log('📥 API Response:', json);

            if (json.success) {
                this.data = json;
                this.renderFiltered();
                if (this.elements.exportBtn) this.elements.exportBtn.style.display = 'inline-block';
                if (this.elements.printBtn) this.elements.printBtn.style.display = 'inline-block';
            } else {
                this.elements.resultContainer.innerHTML = `<div class="error-text">Ошибка: ${this.escapeHtml(json.error)}</div>`;
            }
        } catch (e) {
            console.error('❌ Fetch error:', e);
            this.elements.resultContainer.innerHTML = `<div class="error-text">Ошибка: ${this.escapeHtml(e.message)}</div>`;
        } finally {
            this.elements.generateBtn.disabled = false;
            this.elements.generateBtn.textContent = '📄 Сформировать';
        }
    },

    renderFiltered: function() {
        if (!this.data || !this.data.invoices) return;

        const filterPaid = document.getElementById('filter-paid')?.checked;
        const filterCompleted = document.getElementById('filter-completed')?.checked;

        let filteredInvoices = this.data.invoices;

        if (filterPaid) {
            filteredInvoices = filteredInvoices.filter(inv => inv.paid == 1);
        }
        if (filterCompleted) {
            filteredInvoices = filteredInvoices.filter(inv => inv.state == 2);
        }

        const filteredData = {
            ...this.data,
            invoices: filteredInvoices
        };
        this.render(filteredData);
    },

    render: function(data) {
        const { invoices, summary } = data;

        if (!invoices || invoices.length === 0) {
            this.elements.resultContainer.innerHTML = `<div class="empty-state">Нет счетов за ${this.escapeHtml(this.elements.dateInput.value)}</div>`;
            return;
        }

        const processedInvoices = invoices.map(inv => {
            if (Array.isArray(inv.items)) {
                return inv;
            }
            if (typeof inv.items === 'string') {
                const itemsList = inv.items.split(',').map(s => s.trim()).filter(s => s);
                return {
                    ...inv,
                    items: itemsList.map(name => ({
                        name: name,
                        qty: 1,
                        price: 0,
                        artno: 0
                    }))
                };
            }
            return {
                ...inv,
                items: []
            };
        });

        const totalPositions = processedInvoices.reduce((sum, inv) => sum + (inv.items ? inv.items.length : 0), 0);

        let html = `
            <div class="report-summary">
                <div class="report-summary-title">📊 Итоги за ${this.escapeHtml(data.date)}</div>
                <div class="report-summary-grid">
                    <div>📋 Всего счетов: <b>${processedInvoices.length}</b></div>
                    <div>📦 Всего позиций: <b>${totalPositions}</b></div>
                    <div>🏷️ Скидки: <b>${this.formatCurrency(summary.total_discount)}</b></div>
                    <div class="report-total-highlight">💳 ИТОГО: <b>${this.formatCurrency(summary.net_revenue)}</b></div>
                </div>
            </div>
            <div class="report-table-wrapper">
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>№ счета</th>
                            <th>Клиент</th>
                            <th>Товар/Услуга</th>
                            <th>Кол-во</th>
                            <th class="report-cell-amount">Цена</th>
                            <th class="report-cell-discount">Скидка</th>
                            <th class="report-cell-total">Сумма</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        let totalSum = 0;
        let totalFinal = 0;

        processedInvoices.forEach(inv => {
            //const finalPrice = inv.total_price * (1 - inv.discount / 100);
            let finalPrice = inv.total_price;
            totalSum += inv.total_price || 0;
            totalFinal += finalPrice;

            if (!inv.items || inv.items.length === 0) {
                html += `
                    <tr>
                        <td><b>${this.escapeHtml(inv.invno)}</b></td>
                        <td>${this.escapeHtml(inv.client_name || '—')}</td>
                        <td style="color: #999;">—</td>
                        <td></td>
                        <td class="report-cell-amount">${this.formatCurrency(inv.total_price)}</td>
                        <td class="report-cell-discount">${inv.discount || 0}%</td>
                        <td class="report-cell-total"><b>${this.formatCurrency(finalPrice)}</b></td>
                    </tr>
                `;
                return;
            }

            inv.items.forEach((item, index) => {
                const isFirst = index === 0;
                const itemName = item.name || 'Без названия';
                const itemQty = item.qty || 1;
                // 🔥 Берем цену позиции
                const itemPrice = item.price || 0;
                const itemTotal = itemPrice * itemQty;

                html += `
                    <tr ${isFirst ? '' : 'style="background: #f9fafb;"'}>
                        <td>${isFirst ? `<b>${this.escapeHtml(inv.invno)}</b>` : ''}</td>
                        <td>
                           ${isFirst ? this.escapeHtml(inv.client_name || '—') : ''}
                           ${isFirst && inv.contno ? `<br><span style="font-size: 10px; color: #666;">${this.escapeHtml(inv.contno)}</span>` : ''}
                       </td>

                        <td>
                            ${this.escapeHtml(itemName)}
                            ${index === inv.items.length - 1 && inv.items.length > 1 ? ` <span style="color: #999; font-size: 11px;">(${inv.items.length} позиций)</span>` : ''}
                        </td>
                        <td>${itemQty}</td>
                        <td class="report-cell-amount">${this.formatCurrency(itemTotal)}</td>
                        <td class="report-cell-discount">${isFirst ? (inv.discount || 0) + '%' : ''}</td>
                        <td class="report-cell-total">${isFirst ? `<b>${this.formatCurrency(finalPrice)}</b>` : ''}</td>
                    </tr>
                `;
            });
        });

        // Итог по таблице
        html += `
                    <tr style="background: #f5f5f5; font-weight: bold;">
                        <td colspan="2" style="text-align: right;">ИТОГО:</td>
                        <td style="text-align: center;">${totalPositions} позиций</td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td class="report-cell-total">${this.formatCurrency(totalFinal)}</td>
                    </tr>
        `;

        html += `</tbody></table></div>`;

        // --- РАСЧЕТ ЗАРПЛАТЫ ПО МЕНЕДЖЕРАМ ---
        const managers = {};
        processedInvoices.forEach(inv => {
            const manager = inv.manager || 'Неизвестный';
            if (!managers[manager]) {
                managers[manager] = [];
            }
            managers[manager].push(inv);
        });

        if (Object.keys(managers).length > 0) {
            html += `
                <div style="margin-top: 30px;">
                    <h4 style="color: var(--text-dark);">💰 Расчет зарплаты менеджеров</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 20px; margin-top: 15px;">
            `;

            for (const [manager, managerInvoices] of Object.entries(managers)) {
                let totalManagerPositions = 0;
                managerInvoices.forEach(inv => {
                    if (inv.items && Array.isArray(inv.items)) {
                        totalManagerPositions += inv.items.length;
                    } else {
                        totalManagerPositions += 1;
                    }
                });

                const arendychBonusData = this.calculateArendychBonus(managerInvoices);
                const salaryData = this.calculateSalary(managerInvoices, totalManagerPositions);
                const totalSalaryWithBonus = salaryData.total_salary + arendychBonusData.totalBonus;

                let arendychWashesHtml = '';
                if (arendychBonusData.invoices.length > 0) {
                    arendychWashesHtml = arendychBonusData.invoices.map(inv =>
                        `<span style="display: inline-block; background: #fff3cd; padding: 2px 8px; border-radius: 10px; margin: 2px; font-size: 12px; border: 1px solid #ff9800;">
                            №${inv.invno} (${inv.duration}мин) - ${this.formatCurrency(inv.bonus)}
                        </span>`
                    ).join(' ');
                }

                html += `
                    <div style="background: white; border: 1px solid var(--border); border-radius: var(--radius); padding: 15px; box-shadow: var(--shadow);">
                        <h5 style="margin: 0 0 10px 0; color: var(--primary);">👤 ${this.escapeHtml(manager)}</h5>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; font-size: 14px;">
                            <div><b>Счетов:</b> ${managerInvoices.length}</div>
                            <div><b>Позиций:</b> ${totalManagerPositions}</div>
                            <div><b>База:</b> ${this.formatCurrency(salaryData.base_salary)}</div>
                            ${arendychBonusData.totalBonus > 0 ? `
                                <div style="grid-column: 1/3; margin: 5px 0; background: #fff3cd; padding: 5px 10px; border-radius: 8px; border-left: 3px solid #ff9800;">
                                    <b>👑 Арендыч (${arendychBonusData.totalWashes} шт):</b>
                                    <div style="margin-top: 5px;">${arendychWashesHtml}</div>
                                    <div style="margin-top: 5px; font-weight: bold; color: #2e7d32;">
                                        Итого: ${this.formatCurrency(arendychBonusData.totalBonus)}
                                    </div>
                                </div>
                            ` : ''}
                            <div style="grid-column: 1/3; border-top: 1px solid var(--border); padding-top: 8px; margin-top: 8px;">
                                <b style="font-size: 16px; color: #2e7d32;">💰 Итого: ${this.formatCurrency(totalSalaryWithBonus)}</b>
                            </div>
                        </div>
                    </div>
                `;
            }

            html += `</div></div>`;
        }

        this.elements.resultContainer.innerHTML = html;
    },

    calculateSalary: function(invoices, totalPositions) {
        const totalRows = totalPositions || invoices.length;

        let salary = this.SALARY_RATES.base;

        if (totalRows > this.SALARY_RATES.threshold) {
            salary += totalRows * this.SALARY_RATES.per_row;
        }

        let washTotal = 0;
        let washDetails = [];

        invoices.forEach(inv => {
            const phone = (inv.client_phone || '').replace(/\D/g, '');
            if (phone !== this.ARENDYCH_PHONE) {
                const duration = inv.duration || 0;
                if (duration > 0) {
                    const rate = this.SALARY_RATES.wash_rates[duration];
                    if (rate) {
                        washTotal += rate;
                        washDetails.push({
                            invno: inv.invno,
                            duration: duration,
                            rate: rate,
                            client: inv.client_name
                        });
                    }
                }
            }
        });

        const totalSalary = salary + washTotal;

        return {
            total_rows: totalRows,
            base_salary: salary,
            wash_total: washTotal,
            wash_details: washDetails,
            total_salary: totalSalary
        };
    },

    handleExportPDF: function() {
        const date = this.elements.dateInput.value;
        if (!date) {
            alert('Выберите дату');
            return;
        }
        
        window.open(`/zamoika/api/invoices-report-pdf?date=${date}`, '_blank');
    },

    handlePrint: function() {
        const content = this.elements.resultContainer.innerHTML;
        const date = this.elements.dateInput.value;
        const printWindow = window.open('', '', 'width=1000,height=800');
        printWindow.document.write(`
            <html>
            <head>
                <title>Отчет по счетам за ${date}</title>
                <style>
                    /* 🔥 ЧИТАЕМЫЕ СТИЛИ ДЛЯ ПЕЧАТИ */
                    body { 
                        font-family: Arial, sans-serif; 
                        padding: 0; 
                        margin: 0; 
                        font-size: 10px; 
                        width: 100%;
                    }
                    
                    h2 { font-size: 16px; margin-bottom: 10px; text-align: center; }
                    
                    .report-summary { 
                        margin-bottom: 10px; 
                        background: #e8f5e9; 
                        padding: 5px; 
                        border: 1px solid #4caf50; 
                        font-size: 12px; 
                        width: 100%;
                        box-sizing: border-box;
                    }
                    .report-summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
                    .report-total-highlight { color: #1b5e20; font-weight: bold; font-size: 13px; }
                    
                    /* Таблица занимает 100% ширины */
                    table { 
                        width: 100% !important; 
                        border-collapse: collapse; 
                        margin-top: 5px; 
                        table-layout: fixed; 
                    }
                    
                    th, td { 
                        border: 1px solid #999; 
                        padding: 3px 4px; 
                        text-align: left; 
                        vertical-align: middle; 
                        line-height: 1.2; 
                        word-wrap: break-word;
                        font-size: 10px !important; /* Нормальный размер для всех ячеек */
                    }
                    
                    th { background: #e2efda; font-weight: bold; text-align: center; color: #000; font-size: 10px !important; }
                    
                    /* Номера счетов (чуть меньше остальных, но читаемо) */
                    .report-table tbody td:nth-child(1) { 
                        font-size: 9px !important; 
                        text-align: center; 
                    }
                    
                    /* Суммы и цены */
                    .report-cell-amount, .report-cell-total { text-align: right; white-space: nowrap; }
                    .report-cell-discount { text-align: center; white-space: nowrap; }
                    
                    .report-table-wrapper { margin-top: 10px; width: 100%; }
                    
                    /* ШИРИНА КОЛОНОК */
                    .report-table th:nth-child(1) { width: 7%; }  /* № счета */
                    .report-table th:nth-child(2) { width: 15%; } /* Клиент */
                    .report-table th:nth-child(3) { width: 43%; } /* Товар/Услуга */
                    .report-table th:nth-child(4) { width: 5%; }  /* Кол-во */
                    .report-table th:nth-child(5) { width: 10%; } /* Цена */
                    .report-table th:nth-child(6) { width: 7%; }  /* Скидка */
                    .report-table th:nth-child(7) { width: 13%; } /* Сумма */
                    
                    /* Портретная ориентация, убираем поля */
                    @page { margin: 10mm; size: portrait; }
                    tr { page-break-inside: avoid; }
                </style>
            </head>
            <body>
                <h2>📊 Отчет по счетам за ${date}</h2>
                ${content}
                <script>window.onload = function() { window.print(); }<\/script>
            </body>
            </html>
        `);
        printWindow.document.close();
    },
    // ============================================
    // 📊 Ежемесячный отчёт по машинам Арендыча
    // ============================================
    handleGenerateArendych: async function() {
        const monthInput = document.getElementById('arendych-month');
        const container = document.getElementById('arendych-result');
        const btn = document.getElementById('arendych-generate-btn');

        if (!monthInput || !container || !btn) return;

        const month = monthInput.value; // YYYY-MM
        if (!month) { alert('Выберите месяц'); return; }

        btn.disabled = true;
        btn.textContent = '⏳ Загрузка...';
        container.style.display = 'block';
        container.innerHTML = '<div class="loading-text">Запрос данных...</div>';

        try {
            const response = await apiFetch(`/zamoika/api/arendych-report?month=${month}`);
            const json = await response.json();

            if (json.success) {
                this.renderArendych(json, container);
            } else {
                container.innerHTML = `<div class="error-text">Ошибка: ${this.escapeHtml(json.error)}</div>`;
            }
        } catch (e) {
            container.innerHTML = `<div class="error-text">Ошибка: ${this.escapeHtml(e.message)}</div>`;
        } finally {
            btn.disabled = false;
            btn.textContent = '📄 Сформировать';
        }
    },

    renderArendych: function(data, container) {
        const { by_day, by_manager, total_invoices, total_sum, total_bonus, month } = data;

        if (!by_day || Object.keys(by_day).length === 0) {
            container.innerHTML = `<div class="empty-state">Нет моек Арендыча за ${this.escapeHtml(month)}</div>`;
            return;
        }

        // Собираем всех менеджеров (для колонок)
        const managers = Object.keys(by_manager).sort();

        // Заголовок таблицы: Дата | ФИО | Марка и номер | № счёта | Время | Сумма (по менеджерам) | Получено (по менеджерам)
        let html = `
            <div class="report-summary">
                <div class="report-summary-title">📊 Мойка Авто. Арендыч — ${this.escapeHtml(month)}</div>
                <div class="report-summary-grid">
                    <div>📋 Всего моек: <b>${total_invoices}</b></div>
                    <div>💳 Сумма: <b>${this.formatCurrency(total_sum)}</b></div>
                    <div>👤 Бонус менеджерам: <b>${this.formatCurrency(total_bonus)}</b></div>
                </div>
            </div>
            <div class="report-table-wrapper">
                <table class="report-table arendych-table">
                    <thead>
                        <tr>
                            <th rowspan="2">Дата мойки</th>
                            <th rowspan="2">ФИО сотрудника</th>
                            <th rowspan="2">Марка и номер авто</th>
                            <th rowspan="2">№ счёта-заказа</th>
                            <th rowspan="2">Время мойки</th>
                            <th colspan="${managers.length}">Сумма</th>
                            <th colspan="${managers.length}">Получено за мойку</th>
                        </tr>
                        <tr>
                            ${managers.map(m => `<th>${this.escapeHtml(m)}</th>`).join('')}
                            ${managers.map(m => `<th>${this.escapeHtml(m)}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
        `;

        // Итого по менеджерам
        const totalsSum = {};
        const totalsBonus = {};
        managers.forEach(m => { totalsSum[m] = 0; totalsBonus[m] = 0; });

        // Строки по дням
        const sortedDays = Object.keys(by_day).sort();
        sortedDays.forEach(day => {
            const invoices = by_day[day];

            // Группируем счета по менеджеру внутри дня
            const byMgr = {};
            invoices.forEach(inv => {
                const m = inv.manager || 'Неизвестный';
                if (!byMgr[m]) byMgr[m] = [];
                byMgr[m].push(inv);
            });

            Object.entries(byMgr).forEach(([manager, list]) => {
                list.forEach((inv, idx) => {
                    const isFirst = idx === 0;
                    totalsSum[manager] = (totalsSum[manager] || 0) + inv.total_price;
                    totalsBonus[manager] = (totalsBonus[manager] || 0) + inv.bonus;

                    html += `
                        <tr>
                            <td>${isFirst ? this.escapeHtml(day) : ''}</td>
                            <td>${isFirst ? 'X' : ''}</td>
                            <td>${this.escapeHtml(inv.contno || '—')}</td>
                            <td>${this.escapeHtml(inv.invno)}</td>
                            <td>${inv.duration || 0} мин</td>
                            ${managers.map(m => `
                                <td class="report-cell-amount">
                                    ${m === manager ? this.formatCurrency(inv.total_price) : ''}
                                </td>
                            `).join('')}
                            ${managers.map(m => `
                                <td class="report-cell-amount">
                                    ${m === manager ? this.formatCurrency(inv.bonus) : ''}
                                </td>
                            `).join('')}
                        </tr>
                    `;
                });
            });
        });

        // Итоговая строка
        html += `
                    <tr style="background: #f5f5f5; font-weight: bold;">
                        <td colspan="4" style="text-align: right;">ИТОГО:</td>
                        <td></td>
                        ${managers.map(m => `<td class="report-cell-amount">${this.formatCurrency(totalsSum[m])}</td>`).join('')}
                        ${managers.map(m => `<td class="report-cell-amount">${this.formatCurrency(totalsBonus[m])}</td>`).join('')}
                    </tr>
        `;

        html += `</tbody></table></div>`;
        container.innerHTML = html;
    },

    escapeHtml: function(text) {
        if (text === null || text === undefined) return '';
        if (typeof text !== 'string') {
            if (text instanceof Date) return text.toLocaleString('ru-RU');
            return String(text);
        }
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    },

    formatCurrency: function(value) {
        return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value || 0);
    }
};

document.addEventListener('DOMContentLoaded', function() {
    ReportModule.init();
});
