/**
 * Оплата через LIFE PAY
 */

/**
 * Инициализация оплаты через LIFE PAY
 * Вызывается при нажатии "Оплатить через терминал" в модальном окне записи
 */
async function payWithLifePay(invno) {
    try {
        showLoading(`💳 Оплата счёта #${invno}...`);

        const data = await apiRequest(`/lifepay/init-payment?invno=${invno}`, {
            method: 'POST'
        });

        if (data.success) {
            showSuccess(`✅ Оплата инициализирована. Позиций: ${data.items_count}`);
            // Перезагружаем детали записи для обновления статуса
            loadInvoiceDetails(invno);
        } else {
            showError(`❌ Ошибка: ${data.error}`);
        }
    } catch (error) {
        console.error('Pay error:', error);
        showError('❌ Ошибка подключения к LIFE PAY');
    }
}

/**
 * Проверка статуса оплаты
 */
async function checkPaymentStatus(invno) {
    try {
        const data = await apiRequest(`/lifepay/check-payment?invno=${invno}`);
        
        if (data.success) {
            if (data.paid) {
                // Оплата получена
                showSuccess(`💰 Счёт #${invno} оплачен: ${data.amount}₽`);
                // Обновляем UI — меняем статус на "Выполнен"
                updateBookingStatus(invno, 'Выполнен');
            } else {
                showInfo(`⏳ Счёт #${invno} ожидает оплаты: ${data.amount}₽`);
            }
            
            // Показываем детальную информацию
            if (data.payment_url) {
                document.getElementById('payment-link').innerHTML = 
                    `<a href="${data.payment_url}" target="_blank">Перейти к оплате</a>`;
            }
        } else {
            showError(`❌ ${data.error}`);
        }
    } catch (error) {
        console.error('Check payment error:', error);
    }
}

/**
 * Показать список транзакций
 */
async function showTransactions(month) {
    try {
        const data = await apiRequest(`/lifepay/transactions?limit=100&month=${month || ''}`);
        
        if (data.success) {
            renderTransactionsTable(data.transactions);
        }
    } catch (error) {
        console.error('Get transactions error:', error);
    }
}

function renderTransactionsTable(transactions) {
    const container = document.getElementById('transactions-table');
    if (!container) return;
    
    let html = `
        <table>
            <thead>
                <tr>
                    <th>Дата</th>
                    <th>Счёт</th>
                    <th>Сумма</th>
                    <th>Способ</th>
                    <th>Клиент</th>
                    <th>Авто</th>
                    <th>Номер LIFE PAY</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    for (const t of transactions) {
        html += `
            <tr>
                <td>${t.date || ''}</td>
                <td>${t.invno}</td>
                <td>${t.amount} ₽</td>
                <td>${t.type === 'card' ? '💳 Карта' : '💵 Наличные'}</td>
                <td>${t.client || ''}</td>
                <td>${t.car_number || ''}</td>
                <td>${t.note || ''}</td>
            </tr>
        `;
    }
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

/**
 * Показать статус оплаты в модальном окне
 */
async function showPaymentStatusModal(invno) {
    const modal = document.getElementById('payment-status-modal');
    if (!modal) return;
    
    try {
        const data = await apiRequest(`/lifepay/check-payment?invno=${invno}`);
        
        if (data.success) {
            const statusText = data.paid ? '✅ Оплачен' : '⏳ Ожидает оплаты';
            const statusColor = data.paid ? '#10b981' : '#f59e0b';
            
            modal.innerHTML = `
                <h3>Статус оплаты</h3>
                <p style="color: ${statusColor}; font-size: 1.2em; font-weight: bold;">
                    ${statusText}
                </p>
                <p>Сумма: <strong>${data.amount} ₽</strong></p>
                ${data.paydate ? `<p>Дата оплаты: ${data.paydate}</p>` : ''}
                ${data.payment_url ? 
                    `<a href="${data.payment_url}" target="_blank" class="btn">Перейти к оплате</a>` : ''}
                ${data.payment_detail ? `
                    <details style="margin-top: 10px;">
                        <summary>Детали транзакции</summary>
                        <p>Номер: ${data.payment_detail.pmt_no}</p>
                        <p>LIFE PAY: ${data.payment_detail.note}</p>
                    </details>
                ` : ''}
            `;
        }
    } catch (error) {
        console.error('Payment status error:', error);
    }
}
