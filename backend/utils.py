"""
Вспомогательные функции
"""
from sqlalchemy.orm import Session
from sqlalchemy import text
import logging
from functools import wraps
import time

log = logging.getLogger("zamoika")


def decode_fb(value) -> str:
    """Декодирование значения из Firebird (WIN1251 -> UTF-8)"""
    if value is None:
        return ""
    if isinstance(value, bytes):
        try:
            return value.decode('cp1251')
        except:
            return value.decode('utf-8', errors='replace')
    return str(value)


def to_cp1251(text: str) -> str:
    """Преобразование строки в CP1251 (Firebird WIN1251)"""
    if not text:
        return text
    return text.encode('cp1251', errors='replace').decode('cp1251')


def get_next_gen_id(db: Session, gen_name: str) -> int:
    """Получение следующего ID через GEN_ID"""
    result = db.execute(text(f"SELECT GEN_ID({gen_name}, 1) FROM RDB$DATABASE")).fetchone()
    return result[0] if result else 1


def safe_execute(db: Session, query: str, params: dict = None, fetch_one: bool = False, fetch_all: bool = False):
    """Безопасное выполнение запроса с обработкой ошибок"""
    try:
        result = db.execute(text(query), params)
        if fetch_one:
            row = result.fetchone()
            return row
        elif fetch_all:
            rows = result.fetchall()
            return rows
        db.commit()
        return True
    except Exception as e:
        db.rollback()
        log.error(f"Query error: {e}, query: {query}, params: {params}")
        raise


def retry_on_deadlock(max_retries: int = 3):
    """Декоратор для повторного выполнения при deadlock"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if "deadlock" in str(e).lower() and attempt < max_retries - 1:
                        log.warning(f"Deadlock detected, retry {attempt + 1}/{max_retries}")
                        time.sleep(0.5 * (attempt + 1))
                        continue
                    raise
            return None
        return wrapper
    return decorator
