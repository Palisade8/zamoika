"""
Аутентификация сотрудников
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime, timedelta
from jose import JWTError, jwt
from database import get_db
from utils import safe_execute
from config import settings
import logging

router = APIRouter(prefix="/api", tags=["auth"])
log = logging.getLogger("zamoika")


@router.post("/login")
def login(data: dict, db: Session = Depends(get_db)):
    """Логин сотрудника по EMPNO и паролю"""
    empno = data.get('empno')
    password = data.get('password')

    if not empno or not password:
        return {"success": False, "error": "Missing empno or password"}

    try:
        # Получаем сотрудника и хеш пароля
        row = safe_execute(db, """
            SELECT EMPNO, EMPLOYNAME, PASSWORD_HASH
            FROM EMPLOYER
            WHERE EMPNO = :e
        """, {"e": int(empno)}, fetch_one=True)

        if not row:
            return {"success": False, "error": "Сотрудник не найден"}

        empno_db, name, password_hash = row

        # Проверяем пароль (упрощённо, в реальности использовать passlib)
        if password_hash and password_hash == password:  # TODO: заменить на verify_password
            # Создаём JWT токен
            access_token = jwt.encode(
                {
                    "empno": empno_db,
                    "name": name,
                    "exp": datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
                },
                settings.SECRET_KEY,
                algorithm=settings.ALGORITHM
            )

            return {
                "success": True,
                "token": access_token,
                "empno": empno_db,
                "name": name
            }
        else:
            return {"success": False, "error": "Неверный пароль"}

    except Exception as e:
        log.error(f"Login error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.get("/check-auth")
def check_auth(credentials: dict = Depends(lambda: {}), db: Session = Depends(get_db)):
    """Проверка авторизации (без JWT, для устаревших клиентов)"""
    return {"authenticated": False, "error": "Use JWT"}


@router.get("/me")
def get_current_user(empno: int = None, db: Session = Depends(get_db)):
    """Получение данных текущего сотрудника"""
    if not empno:
        return {"success": False, "error": "Missing empno"}

    try:
        row = safe_execute(db, """
            SELECT EMPNO, EMPLOYNAME
            FROM EMPLOYER
            WHERE EMPNO = :e
        """, {"e": empno}, fetch_one=True)

        if row:
            return {"success": True, "empno": row[0], "name": row[1]}
        else:
            return {"success": False, "error": "Сотрудник не найден"}

    except Exception as e:
        log.error(f"Get user error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.post("/logout")
def logout():
    """Выход (для устаревших клиентов)"""
    return {"success": True}
