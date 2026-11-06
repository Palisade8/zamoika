/**
 * Календарь и расписание
 */

async function loadSchedule() {
    const date = new Date().toISOString().split('T')[0];
    try {
        const data = await apiRequest(`/slots?date=${date}`);
        if (data.success) {
            renderSlots(data.slots);
        }
    } catch (error) {
        console.error('Load schedule error:', error);
    }
}

function renderSlots(slots) {
    const container = document.getElementById('time-slots');
    if (!container) return;

    container.innerHTML = slots.map(slot => `
        <div class="slot ${slot.state === 3 ? 'cancelled' : ''}">
            <span class="time">${slot.start?.toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'})}</span>
            <span class="client">${slot.client_name || 'Без имени'}</span>
            <span class="car">${slot.car_number || ''}</span>
            <span class="amount">${slot.amount} ₽</span>
            <button onclick="editBooking(${slot.invno})">Изменить</button>
        </div>
    `).join('');
}

function editBooking(invno) {
    // TODO: открыть модальное окно с деталями записи
    alert(`Редактирование записи #${invno}`);
}
