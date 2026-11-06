"""
Идемпотентность запросов через Redis или in-memory storage
"""
import time
import hashlib
from typing import Optional, Any, Tuple
import threading


# In-memory storage для идемпотентности (заменить на Redis в продакшене)
_idempotency_store = {}
_lock = threading.Lock()


def acquire(key: str) -> Tuple[bool, Optional[Any]]:
    """
    Получить ключ идемпотентности.
    Возвращает (is_new, cached_result)
    """
    with _lock:
        if key in _idempotency_store:
            entry = _idempotency_store[key]
            if entry['expires_at'] > time.time():
                return False, entry['result']
            else:
                del _idempotency_store[key]
        return True, None


def store(key: str, result: Any, ttl: int = 3600):
    """
    Сохранить результат для идемпотентности
    TTL по умолчанию 1 час
    """
    with _lock:
        _idempotency_store[key] = {
            'result': result,
            'expires_at': time.time() + ttl
        }


def cleanup():
    """Очистка истёкших записей"""
    with _lock:
        now = time.time()
        expired = [k for k, v in _idempotency_store.items() if v['expires_at'] < now]
        for k in expired:
            del _idempotency_store[k]
