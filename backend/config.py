"""
Конфигурация приложения Zamoika
"""
from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # Database
    FIREBIRD_HOST: str = "192.168.38.17"
    FIREBIRD_PORT: str = "3050"
    FIREBIRD_DB: str = "AVTOM.FDB"
    FIREBIRD_USER: str = "SYSDBA"
    FIREBIRD_PASSWORD: str = "masterkey"
    FIREBIRD_DSN: str = ""

    # JWT
    SECRET_KEY: str = "your-secret-key-here-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # CORS
    CORS_ORIGINS: str = "http://localhost,http://localhost:8080,http://192.168.38.17"
    CORS_ORIGINS_LIST: List[str] = []

    # Logging
    LOG_LEVEL: str = "INFO"
    LOG_FILE: str = "logs/app.log"

    class Config:
        env_file = ".env"


settings = Settings()

# Инициализация списка CORS
settings.CORS_ORIGINS_LIST = [origin.strip() for origin in settings.CORS_ORIGINS.split(",")]
