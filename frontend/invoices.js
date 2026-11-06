/**
 * Управление счетами
 */

async function loadInvoices(date) {
    try {
        const data = await apiRequest(`/invoices-report?date=${date}`);
        if (data.success) {
            renderInvoices(data.invoices, data.summary);
        }
    } catch (error) {
        console.error('Load invoices error:', error);
    }
}

function renderInvoices(invoices, summary) {
    const container = document.getElementById('invoices-list');
    if (!container) return;

    container.innerHTML = `
        <div class="summary">
            <p>Всего счетов: ${summary.total_invoices}</p>
            <p>Выручка: ${summary.total_revenue} ₽</p>
            <p>Чистая выручка: ${summary.net_revenue} ₽</p>
        </div>
        ${invoices.map(inv => `
            <div class="invoice">
                <h3>Счет #${inv.invno}</h3>
                <p>Клиент: ${inv.client_name}</p>
                <p>Сумма: ${inv.total_price} ₽</p>
                <button onclick="printInvoice(${inv.invno})">Печать</button>
            </div>
        `).join('')}
    `;
}

function printInvoice(invno) {
    window.open(`/api/documents/invoice?invno=${invno}`, '_blank');
}
