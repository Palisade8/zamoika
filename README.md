# Zamoika — Онлайн-запись на автомойку

## Структура
- `backend/` — FastAPI (Python 3.11, SQLAlchemy, Firebird 2.5)
- `frontend/` — HTML/JS фронтенд для панели менеджера

## Запуск бэкенда
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

## Запуск фронтенда
Открыть `frontend/index.html` через локальный сервер:
```bash
cd frontend
python3 -m http.server 8080
```

## Интеграции
- Firebird 2.5 (`AVTOM.FDB` на `192.168.38.17`)
- LifePay — платёжный терминал (в разработке)
- Отчёты PDF через reportlab
