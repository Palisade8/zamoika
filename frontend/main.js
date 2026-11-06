/**
 * Главный файл приложения ZA Мойка
 */

const API_BASE = 'http://192.168.38.17:8084/api';

function showSection(sectionId) {
    // Скрыть все секции
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    // Показать нужную
    document.getElementById(sectionId).classList.add('active');
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    // Проверка авторизации
    const token = localStorage.getItem('auth_token');
    if (token) {
        checkAuth();
    } else {
        // Показать форму логина
        showLoginForm();
    }
});

function showLoginForm() {
    const main = document.querySelector('main');
    main.innerHTML = `
        <section id="login" class="section active">
            <h2>Вход в систему</h2>
            <form id="login-form" onsubmit="handleLogin(event)">
                <div>
                    <label>EMPNO:</label>
                    <input type="number" id="empno" required>
                </div>
                <div>
                    <label>Пароль:</label>
                    <input type="password" id="password" required>
                </div>
                <button type="submit">Войти</button>
            </form>
            <div id="login-error"></div>
        </section>
    `;
}

async function handleLogin(event) {
    event.preventDefault();
    const empno = document.getElementById('empno').value;
    const password = document.getElementById('password').value;

    try {
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ empno, password })
        });

        const data = await response.json();

        if (data.success) {
            localStorage.setItem('auth_token', data.token);
            localStorage.setItem('empno', data.empno);
            localStorage.setItem('user_name', data.name);
            showSection('schedule');
            loadSchedule();
        } else {
            document.getElementById('login-error').textContent = data.error;
        }
    } catch (error) {
        document.getElementById('login-error').textContent = 'Ошибка подключения к серверу';
        console.error('Login error:', error);
    }
}

async function checkAuth() {
    const token = localStorage.getItem('auth_token');
    const empno = localStorage.getItem('empno');

    if (token && empno) {
        document.getElementById('user-info').textContent = `👤 ${localStorage.getItem('user_name') || 'Менеджер'}`;
        loadSchedule();
    } else {
        localStorage.removeItem('auth_token');
        showLoginForm();
    }
}

// Общепользовательская функция для API запросов с авторизацией
async function apiRequest(endpoint, options = {}) {
    const token = localStorage.getItem('auth_token');
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers
    };

    const config = {
        ...options,
        headers
    };

    const response = await fetch(`${API_BASE}${endpoint}`, config);
    return response.json();
}
