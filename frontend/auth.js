// auth.js — Управление авторизацией и показом формы записи
document.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('auth-btn');
    const authForm = document.getElementById('auth-form');
    const authError = document.getElementById('auth-error');
    const userInfoBlock = document.getElementById('user-info');
    const userNameSpan = document.getElementById('user-name');

    if (!loginBtn) {
        console.warn('⚠️ Кнопка #auth-btn не найдена в DOM');
        return;
    }

    loginBtn.addEventListener('click', async () => {
        const userSelect = document.getElementById('auth-user');
        const passwordInput = document.getElementById('auth-password');
        
        const userId = userSelect?.value;
        const password = passwordInput?.value;

        // 1. Валидация на фронте
        if (!userId) {
            if (authError) {
                authError.textContent = '❌ Выберите сотрудника';
                authError.style.display = 'block';
            }
            return;
        }

        try {
            // 2. Запрос на бэкенд
            // ЗАМЕНИ URL НА СВОЙ РЕАЛЬНЫЙ ЭНДПОИНТ АВТОРИЗАЦИИ
            const response = await apiFetch('/zamoika/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    employeeId: userId,
                    password: password || '' 
                })
            });

            let data;
            if (response.ok) {
                data = await response.json();
            } else {
                // Мок для теста - пока API не готов
                console.warn('⚠️ API авторизации недоступен, используем мок-ответ');
                data = { 
                    success: true, 
                    employeeName: userSelect.options[userSelect.selectedIndex].text 
                };
            }

            if (data.success) {
                console.log('✅ Авторизация успешна, показываем UI');
                
                // 🎯 ГЛАВНОЕ ДЕЙСТВИЕ: Показываем все скрытые элементы
                document.querySelectorAll('.auth-dependent').forEach(el => {
                    el.classList.add('visible');
                    el.classList.remove('hidden');
                });

                // Скрываем саму форму авторизации
                if (authForm) {
                    authForm.classList.add('hidden');
                    authForm.style.display = 'none';
                }

                // Показываем блок пользователя
                if (userInfoBlock) {
                    userInfoBlock.classList.remove('hidden');
                    userInfoBlock.style.display = '';
                }
                
                // Обновляем имя в шапке
                if (userNameSpan && userSelect) {
                    const name = userSelect.options[userSelect.selectedIndex].text;
                    userNameSpan.textContent = name;
                }

                // Триггерим событие для schedule.js и других модулей
                window.dispatchEvent(new CustomEvent('authSuccess', { detail: data }));
                
                console.log('✅ Форма записи показана');

            } else {
                if (authError) {
                    authError.textContent = '❌ ' + (data.error || 'Неверный пароль');
                    authError.style.display = 'block';
                }
            }
        } catch (error) {
            console.error('Auth network error:', error);
            // Для теста: показываем форму даже при ошибке сети
            console.warn('⚠️ Ошибка сети, показываем форму для теста');
            document.querySelectorAll('.auth-dependent').forEach(el => {
                el.classList.add('visible');
                el.classList.remove('hidden');
            });
            if (authForm) {
                authForm.classList.add('hidden');
                authForm.style.display = 'none';
            }
        }
    });

    // Обработчик выхода (закрыть смену)
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            // Скрываем форму записи
            document.querySelectorAll('.auth-dependent').forEach(el => {
                el.classList.remove('visible');
                el.classList.add('hidden');
            });
            
            // Показываем форму авторизации
            if (authForm) {
                authForm.classList.remove('hidden');
                authForm.style.display = '';
            }
            
            // Скрываем блок пользователя
            if (userInfoBlock) {
                userInfoBlock.classList.add('hidden');
                userInfoBlock.style.display = 'none';
            }
            
            // Очищаем поля
            const passwordInput = document.getElementById('auth-password');
            if (passwordInput) passwordInput.value = '';
            
            console.log('👋 Сессия завершена');
        });
    }
});
