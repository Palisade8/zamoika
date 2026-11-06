"""
Интеграция с платёжным терминалом LIFE PAY
Документация: https://support.life-pay.ru/ru/knowledge_base/article/201/category/123/

Эндпоинты:
- POST /api/lifepay/create-invoice — создание инвойса с позициями
- GET  /api/lifepay/transactions — получение транзакций
- POST /api/lifepay/webhook — вебхук для получения статусов оплаты
"""
from fastapi import APIRouter, Depends, Request, Query, Header
from sqlalchemy.orm import Session
from sqlalchemy import text
from database import get_db
from utils import decode_fb, safe_execute
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import httpx
import hashlib
import json
import logging
from datetime import datetime

router = APIRouter(prefix="/api/lifepay", tags=["lifepay"])
log = logging.getLogger("zamoika")


# ==========================================
# ⚙️ КОНФИГУРАЦИЯ LIFE PAY
# ==========================================
LIFEPAY_CONFIG = {
    "merchant_id": "YOUR_MERCHANT_ID",  # TODO: настроить
    "secret_key": "YOUR_SECRET_KEY",     # TODO: настроить
    "api_url": "https://api.life-pay.ru",
    "version": "6",  # v5 или v6
}


# ==========================================
# 📦 СХЕМЫ
# ==========================================
class PurchaseItem(BaseModel):
    """Позиция для печати на терминале"""
    name: str
    quantity: float
    price: float
    sum: float
    payment_method: int = 1  # 1 = полный расчет
    payment_object: int = 1  # 1 = товар


class LifePayInvoiceCreate(BaseModel):
    """Создание инвойса LIFE PAY"""
    invno: int = Field(..., description="Номер счёта INVOICES")
    amount: float = Field(..., description="Сумма в рублях")
    items: Optional[List[PurchaseItem]] = Field(None, description="Позиции для чека")
    description: Optional[str] = "Оплата на ZA Мойку"


class LifePayTransaction(BaseModel):
    """Транзакция LIFE PAY"""
    transaction_id: str
    amount: float
    status: str
    timestamp: str


# ==========================================
# 🔐 УТИЛИТЫ
# ==========================================
def generate_signature(data: dict, secret_key: str) -> str:
    """
    Генерация подписи запроса к LIFE PAY
    Формат: MD5(json_data + secret_key)
    """
    json_str = json.dumps(data, separators=(',', ':'))
    sign_string = f"{json_str}{secret_key}"
    return hashlib.md5(sign_string.encode('utf-8')).hexdigest()


def verify_signature(payload: dict, signature: str, secret_key: str) -> bool:
    """
    Проверка подписи webhook от LIFE PAY
    """
    expected = generate_signature(payload, secret_key)
    return expected == signature


# ==========================================
# 🚀 ЭНДПОИНТЫ
# ==========================================
@router.post("/create-invoice")
async def create_invoice(
    data: LifePayInvoiceCreate,
    db: Session = Depends(get_db)
):
    """
    Создание инвойса для оплаты через LIFE PAY.
    
    Отправляет состав заказа (позиции) на терминал для печати детализированного чека.
    """
    try:
        log.info(f"📝 Creating LIFE PAY invoice: invno={data.invno}, amount={data.amount}")

        # Получаем детали счёта из БД
        invoice_data = safe_execute(db, """
            SELECT i.INVNO, i.AMOUNT, i.DOPDISCOUNT, c.CLNAME, i.CONTACTNAME
            FROM INVOICES i
            LEFT JOIN CLIENTS c ON i.CLNUM = c.CLNUM
            WHERE i.INVNO = :invno
        """, {"invno": data.invno}, fetch_one=True)

        if not invoice_data:
            return {"success": False, "error": "Счёт не найден"}

        invno, amount, discount, client_name, contact_name = invoice_data
        final_amount = float(amount) * (1 - float(discount or 0) / 100)

        # Получаем позиции счёта
        items_query = """
            SELECT a.NAME, o.QTY, o.PRICE
            FROM ORDSPEC o
            LEFT JOIN ARTIKLS a ON o.ARTNO = a.ARTNO
            WHERE o.INVNO = :invno
        """
        items_rows = safe_execute(db, items_query, {"invno": invno}, fetch_all=True)

        # Формируем purchase для LIFE PAY
        purchase = []
        if items_rows and data.items is None:
            for row in items_rows:
                name = decode_fb(row[0]) or "Товар"
                qty = float(row[1]) if row[1] else 1
                price = float(row[2]) if row[2] else 0
                item_sum = qty * price

                purchase.append({
                    "name": name[:128],
                    "quantity": qty,
                    "price": price,
                    "sum": item_sum,
                    "payment_method": 1,
                    "payment_object": 1,
                })
        elif data.items:
            purchase = [item.dict() for item in data.items]

        # Формируем запрос к LIFE PAY API v6
        api_data = {
            "merchant_id": LIFEPAY_CONFIG["merchant_id"],
            "order_id": str(invno),
            "amount": final_amount,
            "currency": "RUB",
            "description": data.description or f"Счёт #{invno}",
            "purchase": purchase,  # 🔥 Позиции для чека
            "signature": "",  # будет заполнен ниже
        }

        # Генерируем подпись
        api_data["signature"] = generate_signature(api_data, LIFEPAY_CONFIG["secret_key"])

        # Отправляем запрос к LIFE PAY
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{LIFEPAY_CONFIG['api_url']}/v{LIFEPAY_CONFIG['version']}/create-payment",
                json=api_data,
                headers={"Content-Type": "application/json"}
            )

        if response.status_code == 200:
            result = response.json()
            log.info(f"✅ LIFE PAY invoice created: {result}")

            # Сохраняем ссылку на оплату в INVOICES (нужно добавить поле PAYLINK)
            safe_execute(db, """
                UPDATE INVOICES SET PAYLINK = :link, PAYLINK_CREATED = CURRENT_TIMESTAMP
                WHERE INVNO = :invno
            """, {"link": result.get("payment_url"), "invno": invno})

            db.commit()

            return {
                "success": True,
                "invoice_id": result.get("invoice_id"),
                "payment_url": result.get("payment_url"),
                "amount": final_amount,
            }
        else:
            log.error(f"❌ LIFE PAY API error: {response.status_code} - {response.text}")
            return {
                "success": False,
                "error": f"LIFE PAY API error: {response.status_code}",
                "details": response.text
            }

    except Exception as e:
        log.error(f"Create invoice error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.get("/transactions")
def get_transactions(
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """
    Получение списка транзакций из LIFE PAY.
    """
    try:
        log.info(f"📋 Getting LIFE PAY transactions (limit={limit})")

        # Получаем последние оплаченные счёта
        query = """
            SELECT
                i.INVNO,
                i.AMOUNT,
                i.PAID,
                i.PAYDATE,
                c.CLNAME,
                i.CONTACTNAME
            FROM INVOICES i
            LEFT JOIN CLIENTS c ON i.CLNUM = c.CLNUM
            WHERE i.PAID = 1
            ORDER BY i.PAYDATE DESC
            ROWS :limit
        """
        rows = safe_execute(db, query, {"limit": limit}, fetch_all=True)

        transactions = []
        for row in rows:
            invno, amount, paid, paydate, client_name, contact_name = row
            transactions.append({
                "invno": invno,
                "amount": float(amount) if amount else 0,
                "paid": paid,
                "paydate": paydate.strftime("%Y-%m-%d %H:%M") if paydate else None,
                "client": decode_fb(client_name) or decode_fb(contact_name) or "Клиент",
                "source": "lifepay" if paid else "other"
            })

        return {
            "success": True,
            "transactions": transactions,
            "count": len(transactions)
        }

    except Exception as e:
        log.error(f"Get transactions error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.post("/webhook")
async def lifepay_webhook(
    request: Request,
    x_life_signature: Optional[str] = Header(None, alias="X-Life-Signature"),
    db: Session = Depends(get_db)
):
    """
    Вебхук для получения статусов оплаты от LIFE PAY.
    Автоматическое обновление статуса заказа после оплаты.
    """
    try:
        body = await request.json()
        log.info(f"📩 LIFE PAY webhook received: {body}")

        # Проверяем подпись
        if x_life_signature:
            if not verify_signature(body, x_life_signature, LIFEPAY_CONFIG["secret_key"]):
                log.warning("❌ Invalid LIFE PAY signature")
                return {"success": False, "error": "Invalid signature"}

        # Извлекаем данные
        order_id = body.get("order_id")  # INVNO
        status = body.get("status")  # "paid", "failed", etc.
        transaction_id = body.get("transaction_id")

        if not order_id or not status:
            log.warning("❌ Missing order_id or status in webhook")
            return {"success": False, "error": "Missing required fields"}

        # Обновляем статус счёта
        if status in ["paid", "success"]:
            log.info(f"💰 Payment received for INVNO={order_id}")

            safe_execute(db, """
                UPDATE INVOICES
                SET PAID = 1, PAYDATE = CURRENT_TIMESTAMP, INVSTATE = 2
                WHERE INVNO = :invno
            """, {"invno": int(order_id)})

            db.commit()

            return {
                "success": True,
                "message": f"Счёт #{order_id} отмечен как оплаченный",
                "transaction_id": transaction_id
            }

        elif status in ["failed", "cancelled"]:
            log.info(f"❌ Payment failed/cancelled for INVNO={order_id}")

            safe_execute(db, """
                UPDATE INVOICES
                SET PAID = 0, INVSTATE = 3
                WHERE INVNO = :invno
            """, {"invno": int(order_id)})

            db.commit()

            return {
                "success": True,
                "message": f"Счёт #{order_id} отмечен как неоплаченный"
            }

        else:
            log.info(f"ℹ️ Unknown LIFE PAY status: {status}")
            return {"success": True, "message": f"Статус {status} обработан"}

    except Exception as e:
        log.error(f"Webhook error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.post("/check-payment")
def check_payment(
    invno: int = Query(..., description="Номер счёта"),
    db: Session = Depends(get_db)
):
    """
    Проверка статуса оплаты конкретного счёта.
    """
    try:
        row = safe_execute(db, """
            SELECT INVNO, AMOUNT, PAID, PAYDATE, INVSTATE
            FROM INVOICES
            WHERE INVNO = :invno
        """, {"invno": invno}, fetch_one=True)

        if not row:
            return {"success": False, "error": "Счёт не найден"}

        return {
            "success": True,
            "invno": row[0],
            "amount": float(row[1]) if row[1] else 0,
            "paid": bool(row[2]),
            "paydate": row[3].strftime("%Y-%m-%d %H:%M") if row[3] else None,
            "state": row[4]
        }

    except Exception as e:
        log.error(f"Check payment error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}
