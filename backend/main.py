from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
import logging
from logging.handlers import RotatingFileHandler
from config import settings as app_config
from database import get_db
from jwt_auth import require_auth


# ==========================================
# 🔧 ЛОГИРОВАНИЕ
# ==========================================
log_format = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"

log_dir = "logs"
import os
os.makedirs(log_dir, exist_ok=True)

file_handler = RotatingFileHandler(
    f"{log_dir}/app.log",
    maxBytes=10 * 1024 * 1024,
    backupCount=5,
    encoding="utf-8",
)
file_handler.setLevel(app_config.LOG_LEVEL)
file_handler.setFormatter(logging.Formatter(log_format))

logging.basicConfig(
    level=app_config.LOG_LEVEL,
    format=log_format,
    handlers=[file_handler],
)

uvicorn_logger = logging.getLogger("uvicorn.access")
uvicorn_logger.disabled = True

log = logging.getLogger("zamoika")


# ==========================================
# 🚀 ПРИЛОЖЕНИЕ
# ==========================================
app = FastAPI(
    title="Zamoika API v2",
    version="2.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


# ==========================================
# 🌐 CORS
# ==========================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=app_config.CORS_ORIGINS_LIST,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type",
        "Authorization",
        "X-API-Key",
        "Idempotency-Key",
    ],
)


# ==========================================
# 🛡️ ГЛОБАЛЬНЫЙ ОБРАБОТЧИК ОШИБОК
# ==========================================
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.error(
        f"Unhandled error on {request.method} {request.url.path}: {exc}",
        exc_info=True,
    )
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": "Внутренняя ошибка сервера"},
    )


# ==========================================
# 📦 РОУТЕРЫ
# ==========================================
from routers import documents
from routers import (
    schedule, booking, warehouse, asterisk, auth,
    stock, discount, settings, report, close_day, lifepay,
)

# --- Публичные (без JWT) ---
app.include_router(documents.router)
app.include_router(auth.router)
from routers import schedule as public_schedule
app.include_router(documents.router)
app.include_router(public_schedule.router)

# --- Защищённые (требуют JWT) ---
protected = [Depends(require_auth)]

app.include_router(booking.router,   dependencies=protected)
app.include_router(warehouse.router, dependencies=protected)
app.include_router(asterisk.router,  dependencies=protected)
app.include_router(discount.router,  dependencies=protected)
app.include_router(settings.router,  dependencies=protected)
app.include_router(report.router,    dependencies=protected)
app.include_router(close_day.router, dependencies=protected)
app.include_router(lifepay.router)  # Публичный роутер


# ==========================================
# ❤️ HEALTHCHECK
# ==========================================
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/db-health")
def db_health():
    try:
        db = next(get_db())
        db.execute(text("SELECT 1 FROM RDB$DATABASE"))
        db.close()
        return {"success": True, "db": "connected", "status": "ok"}
    except Exception as e:
        log.error(f"DB health check failed: {e}", exc_info=True)
        return {
            "success": False,
            "db": "error",
            "status": "error",
            "message": "Database unavailable",
        }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8084,
        log_level=app_config.LOG_LEVEL.lower(),
        access_log=False,
    )
