// ==========================================
// timeSlots.js - Единый модуль для выбора времени
// ==========================================

// Глобальный флаг видимости для модального окна
window.modalTimeSlotsVisible = false;
window.timeSlotsVisible = false;

// Единая функция генерации слотов времени
async function generateTimeSlotsGrid(date, duration, selectedTime = null, containerId = 'time-slots-dropdown', isModal = false) {
    const dropdown = document.getElementById(containerId);
    if (!dropdown) return;

    var effectiveDuration = (duration && duration > 0) ? duration : 0;
    dropdown.innerHTML = '<div class="loading-text" style="grid-column: 1/-1; text-align: center; padding: 8px;">Загрузка...</div>';
    dropdown.classList.remove('hidden');
    dropdown.style.display = 'grid';

    try {
        const resp = await apiFetch('/zamoika/api/schedule?start=' + date + '&end=' + date + '&employee=all');
        const data = await resp.json();

        dropdown.innerHTML = '';
        dropdown.style.cssText = 'display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; padding: 8px;';

        if (!data.success) {
            dropdown.innerHTML = '<div class="no-slots" style="grid-column: 1/-1; text-align: center; color: #999; padding: 12px;">Нет данных</div>';
            return;
        }

        let busyIntervals = [];
        for (const dayKey in data.bookings) {
            for (const hourKey in data.bookings[dayKey]) {
                const list = data.bookings[dayKey][hourKey];
                if (Array.isArray(list)) {
                    for (let b of list) {
                        if (b.status === 'Отменен') continue;
                        if (b.time_start && b.time_end) {
                            busyIntervals.push({
                                start: b.time_start.substring(0,5),
                                end: b.time_end.substring(0,5)
                            });
                        }
                    }
                }
            }
        }

        function isSlotBusy(timeStr, dur) {
            const slotDuration = (dur && dur > 0) ? dur : 1;
            const [h, m] = timeStr.split(':').map(Number);
            const slotStart = h * 60 + m;
            const slotEnd = slotStart + slotDuration;

            return busyIntervals.some(b => {
                const [bh, bm] = b.start.split(':').map(Number);
                const [eh, em] = b.end.split(':').map(Number);
                const bStart = bh * 60 + bm;
                const bEnd = eh * 60 + em;
                return slotStart < bEnd && slotEnd > bStart;
            });
        }

        var realNow = new Date();
        var todayStr = realNow.getFullYear() + '-' + 
                       String(realNow.getMonth() + 1).padStart(2, '0') + '-' + 
                       String(realNow.getDate()).padStart(2, '0');
        var isToday = (date === todayStr);

        // Время для скрытия (текущее минус 5 минут)
        var hideThreshold = new Date(realNow.getTime() - 5 * 60000); 

        var hasSlots = false;

        for (var hour = 8; hour <= 21; hour++) {
            if (isToday && hour < hideThreshold.getHours()) continue;

            // 1️⃣ БАЗОВАЯ СЕТКА
            let hourSlots = [0, 10, 20, 30, 40, 50];

            // 2️⃣ ЗАМЕНА ПОД КОНЕЦ БРОНИ (стыковка)
            busyIntervals.forEach(b => {
                let [eh, em] = b.end.split(':').map(Number);
                if (eh === hour && em % 10 !== 0) {
                    let idx = hourSlots.findIndex(m => m > em);
                    if (idx !== -1) {
                        hourSlots[idx] = em;
                    }
                }
            });

            // 3️⃣ ЗАМЕНА ПОД ТЕКУЩЕЕ ВРЕМЯ (если сейчас 21:25)
            if (isToday && hour === realNow.getHours()) {
                let currentM = realNow.getMinutes();
                // Если минута кратна 5, но не входит в стандартную сетку
                if (currentM % 5 === 0 && !hourSlots.includes(currentM)) {
                    let nextStandard = Math.ceil(currentM / 10) * 10;
                    let idx = hourSlots.indexOf(nextStandard);
                    if (idx !== -1) {
                        hourSlots[idx] = currentM;
                    }
                }
            }

            // Сортируем и убираем дубли
            hourSlots = [...new Set(hourSlots)].sort((a, b) => a - b);

            var rowHasVisible = false;
            var hourButtons = [];

            hourSlots.forEach(minute => {
                var timeStr = hour.toString().padStart(2, '0') + ':' + minute.toString().padStart(2, '0');
                var slotTime = new Date(realNow.getFullYear(), realNow.getMonth(), realNow.getDate(), hour, minute, 0);
                
                // Скрываем, если слот прошел более 5 минут назад
                var isHidden = isToday && slotTime < hideThreshold;

                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'time-slot-btn';
                btn.textContent = timeStr;

                if (isHidden) {
                    btn.style.visibility = 'hidden';
                    btn.style.pointerEvents = 'none';
                } else {
                    rowHasVisible = true;
                    var busy = isSlotBusy(timeStr, effectiveDuration);

                    if (busy) {
                        btn.style.background = '#fce4ec';
                        btn.style.color = '#c2185b';
                        btn.style.textDecoration = 'line-through';
                        btn.style.borderColor = '#f48fb1';
                        btn.disabled = true;
                        btn.classList.add('busy-slot');
                    } else {
                        hasSlots = true;
                        if (selectedTime === timeStr) {
                            btn.style.background = '#1a56db';
                            btn.style.color = 'white';
                            btn.style.borderColor = '#1a56db';
                        } else {
                            btn.style.background = 'white';
                            btn.style.color = '#333';
                        }
                        btn.onclick = (function(t) {
                            return function() { selectTimeSlotUniversal(t, containerId, isModal); };
                        })(timeStr);
                    }
                }
                hourButtons.push(btn);
            });

            if (rowHasVisible) {
                hourButtons.forEach(b => dropdown.appendChild(b));
            }
        }

        if (!hasSlots) {
            dropdown.innerHTML = '<div class="no-slots" style="grid-column: 1/-1; text-align: center; color: #999; padding: 12px;">Нет свободных слотов</div>';
        }
    } catch(e) {
        console.error('Error loading time slots:', e);
        dropdown.innerHTML = '<div class="error-text" style="grid-column: 1/-1; text-align: center; color: #d32f2f; padding: 12px;">Ошибка загрузки</div>';
    }
}
// Единая функция выбора времени
function selectTimeSlotUniversal(time, containerId, isModal) {
    console.log('🎯 Выбран слот времени:', time, 'контейнер:', containerId);

    if (isModal) {
        // Для модального окна
        var modalDisplayInput = document.getElementById('modal-time-display');
        if (modalDisplayInput) {
            modalDisplayInput.value = time;
        }
        var modalDropdown = document.getElementById(containerId);
        if (modalDropdown) {
            modalDropdown.style.display = 'none';
            window.modalTimeSlotsVisible = false;
        }
    } else {
        // Для формы новой заявки
        var displayInput = document.getElementById('booking-time-display');
        var hiddenInput = document.getElementById('booking-time');
        var dropdown = document.getElementById(containerId);
        
        console.log('🔍 displayInput:', displayInput);
        console.log('🔍 hiddenInput:', hiddenInput);

        if (displayInput) {
            displayInput.value = time;
            console.log('✅ displayInput установлен:', time);
        } else {
            console.warn('⚠️ displayInput #booking-time-display не найден!');
        }

        if (hiddenInput) {
            // ✅ ИСПРАВЛЕНИЕ: Корректная установка значения для SELECT
            if (hiddenInput.tagName === 'SELECT') {
                // Пытаемся найти существующую опцию
                let optionFound = false;
                for (let i = 0; i < hiddenInput.options.length; i++) {
                    if (hiddenInput.options[i].value === time) {
                        hiddenInput.selectedIndex = i;
                        optionFound = true;
                        break;
                    }
                }
                
                // Если опции нет (например, время динамическое), создаем её
                if (!optionFound) {
                    // Очищаем старые опции, если они были временными, или добавляем новую
                    // В данном случае лучше добавить новую и выбрать её
                    const newOption = new Option(time, time);
                    hiddenInput.add(newOption);
                    hiddenInput.value = time;
                }
            } else {
                // Если это input
                hiddenInput.value = time;
            }
            console.log('✅ hiddenInput установлен:', time);
        } else {
            console.warn('⚠️ hiddenInput #booking-time не найден!');
        }

        if (dropdown) {
            dropdown.classList.add('hidden');
        dropdown.style.display = 'none';
            window.timeSlotsVisible = false;
        }
    }

    // Проверка пересечения времени
    if (typeof checkDurationLocal === 'function') {
        checkDurationLocal();
    }
}

// Функция переключения видимости сетки времени для формы
function toggleTimeSlots() {
    var dropdown = document.getElementById('time-slots-dropdown');
    if (!dropdown) return;

    var dateInput = document.getElementById('booking-date');
    var durationInput = document.getElementById('booking-duration');

    if (!dateInput || !dateInput.value) {
        if (typeof showToast === 'function') {
            showToast('Сначала выберите дату', 'warning');
        }
        return;
    }

    var isVisible = dropdown.style.display === 'grid';
    if (isVisible) {
        dropdown.classList.add('hidden');
        dropdown.style.display = 'none';
        window.timeSlotsVisible = false;
    } else {
        var date = dateInput.value;
        var duration = parseInt(durationInput?.value || '5');
        var currentTime = document.getElementById('booking-time-display')?.value || null;
        generateTimeSlotsGrid(date, duration, currentTime, 'time-slots-dropdown', false);
        window.timeSlotsVisible = true;
    }
}

// Функция переключения видимости сетки времени для модального окна
function toggleModalTimeSlots(selectedDate, selectedTime, duration) {
    var dropdown = document.getElementById('modal-time-slots-dropdown');
    if (!dropdown) return;

    var isVisible = dropdown.style.display === 'grid';
    if (isVisible) {
        dropdown.classList.add('hidden');
        dropdown.style.display = 'none';
        window.modalTimeSlotsVisible = false;
    } else {
        generateTimeSlotsGrid(selectedDate, duration, selectedTime, 'modal-time-slots-dropdown', true);
        window.modalTimeSlotsVisible = true;
    }
}

// Инициализация TimePicker для формы
function initFormTimePicker() {
    var displayInput = document.getElementById('booking-time-display');
    var dropdown = document.getElementById('time-slots-dropdown');
    var dateInput = document.getElementById('booking-date');
    var durationInput = document.getElementById('booking-duration');

    if (!displayInput || !dropdown) return;

    // Удаляем старый обработчик, если есть (через клонирование или флаг)
    // Здесь используем простой подход, так как init вызывается один раз
    displayInput.onclick = function(e) {
        e.stopPropagation();
        if (!dateInput || !dateInput.value) {
            if (typeof showToast === 'function') {
                showToast('Сначала выберите дату', 'warning');
            }
            return;
        }
        toggleTimeSlots();
    };

    // ✅ ИСПРАВЛЕНИЕ: Используем named function для удаления слушателя, если нужно, 
    // но здесь просто добавляем один раз. Важно не добавлять его многократно.
    document.addEventListener('click', function closeDropdown(e) {
        if (!displayInput.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        dropdown.style.display = 'none';
            window.timeSlotsVisible = false;
        }
    });

    if (dateInput) {
        dateInput.onchange = function() {
            var duration = parseInt(durationInput?.value || '5');
            var currentTime = displayInput.value || null;
            generateTimeSlotsGrid(dateInput.value, duration, currentTime, 'time-slots-dropdown', false);
        };
    }

    if (durationInput) {
        durationInput.onchange = function() {
            if (dateInput && dateInput.value) {
                var currentTime = displayInput.value || null;
                generateTimeSlotsGrid(dateInput.value, parseInt(durationInput.value), currentTime, 'time-slots-dropdown', false);
            }
        };
    }
}

// Инициализация TimePicker для модального окна
function initModalTimePicker(selectedDate, selectedTime, duration) {
    var displayInput = document.getElementById('modal-time-display');
    var dropdown = document.getElementById('modal-time-slots-dropdown');
    var dateSelect = document.getElementById('modal-date-select');

    if (!displayInput || !dropdown) return;

    displayInput.onclick = function(e) {
        e.stopPropagation();
        var currentDate = dateSelect ? dateSelect.value : selectedDate;
        if (!currentDate) {
            if (typeof showToast === 'function') {
                showToast('Сначала выберите дату', 'warning');
            }
            return;
        }
        var currentDuration = duration;
        var currentTime = displayInput.value || selectedTime;
        toggleModalTimeSlots(currentDate, currentTime, currentDuration);
    };

    document.addEventListener('click', function(e) {
        if (!displayInput.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        dropdown.style.display = 'none';
            window.modalTimeSlotsVisible = false;
        }
    });

    if (dateSelect) {
        dateSelect.onchange = function() {
            var newDate = dateSelect.value;
            var currentDuration = duration;
            var currentTime = displayInput.value || selectedTime;
            generateTimeSlotsGrid(newDate, currentDuration, currentTime, 'modal-time-slots-dropdown', true);
        };
    }
}

// Автоматическая инициализация TimePicker при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    console.log('🔧 timeSlots: автоматическая инициализация TimePicker');
    if (typeof initFormTimePicker === 'function') {
        initFormTimePicker();
        console.log('✅ TimePicker инициализирован успешно');
    } else {
        console.warn('⚠️ initFormTimePicker не найдена');
    }
});

// Экспорт функций в глобальную область
window.generateTimeSlotsGrid = generateTimeSlotsGrid;
window.selectTimeSlotUniversal = selectTimeSlotUniversal;
window.toggleTimeSlots = toggleTimeSlots;
window.toggleModalTimeSlots = toggleModalTimeSlots;
window.initFormTimePicker = initFormTimePicker;
window.initModalTimePicker = initModalTimePicker;
