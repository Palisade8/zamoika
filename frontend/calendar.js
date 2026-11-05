// ==========================================
// 📅 calendar.js — Календарь с подсветкой дат с бронями
// ==========================================

let currentDate = new Date();
let selectedStartDate = null;
let selectedEndDate = null;
let bookedDates = new Map();   // date → count

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getToday() { return formatDate(new Date()); }

function formatDateRu(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}.${m}`;
}

function getDefaultDate() {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    if (h > 21 || (h === 21 && m >= 55)) {
        const t = new Date();
        t.setDate(t.getDate() + 1);
        return formatDate(t);
    }
    return getToday();
}

function getMonthDays(year, month) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startWeekday = firstDay.getDay() || 7;
    const days = [];
    const prevLast = new Date(year, month, 0).getDate();

    for (let i = startWeekday - 1; i > 0; i--) {
        days.push({
            year: month === 0 ? year - 1 : year,
            month: month === 0 ? 12 : month,
            day: prevLast - i + 1,
            current: false,
        });
    }
    for (let i = 1; i <= lastDay.getDate(); i++) {
        days.push({ year, month: month + 1, day: i, current: true });
    }
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
        days.push({
            year: month === 11 ? year + 1 : year,
            month: month === 11 ? 1 : month + 2,
            day: i,
            current: false,
        });
    }
    return days;
}

function renderCalendar() {
    const container = document.getElementById('calendar-days');
    if (!container) return;

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const days = getMonthDays(year, month);
    const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

    const monthLabel = document.getElementById('current-month-label');
    if (monthLabel) {
        monthLabel.textContent = `${monthNames[month]} ${year}`;
    }

    container.innerHTML = '';
    const today = getToday();
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    for (const d of days) {
        const dateStr = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
        const div = document.createElement('div');
        div.className = 'calendar-day';

        if (!d.current) div.classList.add('other-month');
        if (dateStr === today) div.classList.add('today');

        const cellDate = new Date(dateStr);
        if (cellDate < todayDate) div.classList.add('past');

        // 🟢 ПОДСВЕТКА дат с бронями (3 уровня загруженности)
        if (bookedDates.has(dateStr)) {
            const count = bookedDates.get(dateStr);
            div.classList.add('has-bookings');
            if (count >= 6) {
                div.classList.add('load-high');
            } else if (count >= 3) {
                div.classList.add('load-mid');
            } else {
                div.classList.add('load-low');
            }
            // Подсказка при наведении
            div.title = `Броней: ${count}`;
        }

        if (selectedStartDate && selectedEndDate && dateStr >= selectedStartDate && dateStr <= selectedEndDate) {
            if (dateStr === selectedStartDate) div.classList.add('range-start');
            else if (dateStr === selectedEndDate) div.classList.add('range-end');
            else div.classList.add('in-range');
        } else if (selectedStartDate === dateStr) {
            div.classList.add('selected');
        }

        div.textContent = d.day;
        div.onclick = (function (ds) {
            return function () { selectDate(ds); };
        })(dateStr);

        container.appendChild(div);
    }

    console.log('✅ renderCalendar: подсвечено', document.querySelectorAll('.calendar-day.has-bookings').length);
}

async function loadBookedDates(year, month) {
    console.log('🔄 loadBookedDates START:', year, month);
    try {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const start = formatDate(firstDay);
        const end = formatDate(lastDay);

        console.log('   Период:', start, '—', end);

        const fetchFn = (typeof apiFetch === 'function') ? apiFetch : fetch;
        const resp = await fetchFn(
            `/zamoika/api/schedule?start=${start}&end=${end}&employee=all`,
            { credentials: 'same-origin' }
        );

        if (!resp.ok) {
            console.warn('   ⚠️ HTTP', resp.status);
            return;
        }

        const data = await resp.json();
        console.log('   success:', data.success);

        if (!data.success) {
            console.warn('   ⚠️ success=false');
            return;
        }

        bookedDates = new Map();
        if (data.bookings) {
            for (const date of Object.keys(data.bookings)) {
                const slots = data.bookings[date];
                let count = 0;
                for (const slot of Object.keys(slots)) {
                    if (Array.isArray(slots[slot])) {
                        count += slots[slot].length;
                    }
                }
                if (count > 0) {
                    bookedDates.set(date, count);
                }
            }
        }

        console.log('✅ Даты с бронями:', Array.from(bookedDates));
        renderCalendar();
    } catch (e) {
        console.error('❌ loadBookedDates error:', e);
    }
}

function selectDate(dateStr) {
    if (!selectedStartDate || (selectedStartDate && selectedEndDate)) {
        selectedStartDate = dateStr;
        selectedEndDate = null;
    } else {
        if (dateStr < selectedStartDate) {
            selectedEndDate = selectedStartDate;
            selectedStartDate = dateStr;
        } else {
            selectedEndDate = dateStr;
        }
    }
    renderCalendar();
    if (typeof loadSchedule === 'function') loadSchedule();
}

document.addEventListener('DOMContentLoaded', () => {
    const prevBtn = document.getElementById('prev-month-btn');
    const nextBtn = document.getElementById('next-month-btn');

    if (prevBtn) {
        prevBtn.onclick = () => {
            currentDate.setMonth(currentDate.getMonth() - 1);
            renderCalendar();
            loadBookedDates(currentDate.getFullYear(), currentDate.getMonth());
        };
    }

    if (nextBtn) {
        nextBtn.onclick = () => {
            currentDate.setMonth(currentDate.getMonth() + 1);
            renderCalendar();
            loadBookedDates(currentDate.getFullYear(), currentDate.getMonth());
        };
    }

    renderCalendar();
    loadBookedDates(currentDate.getFullYear(), currentDate.getMonth());
});

window.loadBookedDates = loadBookedDates;
window.renderCalendar = renderCalendar;
window.selectDate = selectDate;
window.getToday = getToday;
window.getDefaultDate = getDefaultDate;
