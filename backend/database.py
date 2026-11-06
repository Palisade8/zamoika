"""
Подключение к Firebird через SQLAlchemy
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from config import settings


# Создаем DSN для Firebird
DB_URL = f"firebird+fdb://{settings.FIREBIRD_USER}:{settings.FIREBIRD_PASSWORD}@{settings.FIREBIRD_HOST}:{settings.FIREBIRD_PORT}/{settings.FIREBIRD_DB}"

engine = create_engine(DB_URL, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """Получение сессии БД"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
