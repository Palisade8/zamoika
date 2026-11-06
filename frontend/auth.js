/**
 * Аутентификация
 */

async function logout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('empno');
    localStorage.removeItem('user_name');
    showLoginForm();
}
