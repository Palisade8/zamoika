"""
Интеграция с платёжным сервисом LIFE PAY
==========================================
Версия API: уточняется (v5 или v6)
Документация: https://support.life-pay.ru/

Схема работы:
1. Клиент нажимает "Оплатить" → создаём invoice в LIFE PAY (с составом заказа)
2. LIFE PAY обрабатывает оплату → отправляет webhook на наш сервер
3. Мы записываем факт оплаты в PAYMNT
4. В конце дня "Закрытие дня" → списание со склада

Таблицы Firebird:
- PAYMNT — факты оплат (TYP=1 карта, TYP=0 наличные)
- INVOICES — счета
- ORDSPEC — позиции заказа
- ARTIKLS — справочник услуг/товаров
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
# ⚙️ КОНФИГУРАЦИЯ
# ==========================================
LIFEPAY_CONFIG = {
    "partner_id": "YOUR_PARTNER_ID",     # TODO: из .env
    "service_id": "YOUR_SERVICE_ID",      # TODO: из .env
    "secret_key": "YOUR_SECRET_KEY",      # TODO: из .env
    "api_url": "https://api.life-pay.ru",
    "version": "2.0",   # Точную версию уточнить в ЛК
}


# ==========================================
# 📦 СХЕМЫ
# ==========================================
class PurchaseItem(BaseModel):
    """Позиция для печати на терминале (invoice_data.items)"""
    name: str
    quantity: float
    sum: float
    unit: str = "service"           # "service" или "piece"
    vat_mode: str = "vat22"         # "vat22", "vat10", "vat0", "none"
    code: Optional[str] = None      # ARTNO
    payment_object: Optional[str] = "service"


class InvoiceData(BaseModel):
    """Состав заказа для LIFE PAY"""
    items: List[PurchaseItem]
    order_id: str                   # INVNO
    description: str = "Оплата на ZA Мойку"
    amount: float


# ==========================================
# 🔐 УТИЛИТЫ
# ==========================================
def generate_md5_signature(params: dict, secret_key: str) -> str:
    """
    Генерация MD5-подписи для verификации webhook.
    
    Формула (упрощённо):
    md5(tid + name + comment + partner_id + service_id + order_id + 
         type + cost + income_total + income + partner_income + 
         system_income + command + phone_number + email + 
         result + resultStr + date_created + version + 
         card + recurrent_order_id + test + secret_key)
    
    Примечание: полный набор полей может отличаться. 
    Требуется уточнение в документации LIFE PAY v5/v6.
    """
    # Упрощённая версия — полный список полей уточнить у LIFE PAY
    sign_string = ""
    for key in sorted(params.keys()):
        val = params.get(key, "")
        if val and val != "null":
            sign_string += str(val)
    sign_string += secret_key
    
    return hashlib.md5(sign_string.encode('utf-8')).hexdigest()


def verify_webhook_signature(payload: dict, check_signature: str) -> bool:
    """
    Верификация подписи webhook LIFE PAY.
    
    Проверяем MD5 хеш из поля 'check'.
    """
    if not check_signature:
        log.warning("❌ Missing check signature in webhook")
        return False
    
    # Формируем строку для подписи (без поля check)
    sign_data = {k: v for k, v in payload.items() if k != 'check'}
    expected = generate_md5_signature(sign_data, LIFEPAY_CONFIG["secret_key"])
    
    if expected == check_signature:
        log.info("✅ Webhook signature verified")
        return True
    else:
        log.warning(f"❌ Signature mismatch: expected={expected}, got={check_signature}")
        return False


def build_invoice_data(invno: int, db: Session) -> dict:
    """
    Формирует invoice_data.items для LIFE PAY.
    
    Запрашивает INVOICES + ORDSPEC + ARTIKLS для INVNO.
    """
    # Получаем счёт
    invoice = safe_execute(db, """
        SELECT INVNO, AMOUNT, DOPDISCOUNT, VAT, INVSTATE
        FROM INVOICES
        WHERE INVNO = :invno
    """, {"invno": invno}, fetch_one=True)
    
    if not invoice:
        return None
    
    invno_db, amount, discount, vat, inv_state = invoice
    final_amount = float(amount) * (1 - float(discount or 0) / 100)
    
    # Определяем режим НДС
    vat_mode = "vat22" if (vat or 22) == 22 else "none"
    
    # Получаем позиции заказа
    items_query = """
        SELECT o.ARTNO, a.NAME, o.QTY, o.PRICE,
               CASE WHEN o.ARTNO > 0 THEN 'piece' ELSE 'service' END as unit_type
        FROM ORDSPEC o
        LEFT JOIN ARTIKLS a ON o.ARTNO = a.ARTNO
        WHERE o.INVNO = :invno
    """
    items_rows = safe_execute(db, items_query, {"invno": invno}, fetch_all=True)
    
    if not items_rows:
        # Если нет позиций — создаём одну универсальную
        items = [
            PurchaseItem(
                name="Услуги автомойки",
                quantity=1,
                sum=final_amount,
                unit="service",
                vat_mode=vat_mode
            )
        ]
    else:
        items = []
        for row in items_rows:
            artno, name, qty, price, unit_type = row
            item_name = decode_fb(name) if name else f"Товар #{artno}"
            item_sum = float(qty or 0) * float(price or 0)
            
            items.append(PurchaseItem(
                name=item_name[:128],
                quantity=float(qty or 1),
                sum=item_sum,
                unit="piece" if unit_type == "piece" else "service",
                vat_mode=vat_mode,
                code=str(artno) if artno else None,
                payment_object="service" if unit_type != "piece" else "commodity"
            ))
    
    return {
        "invoice_data": {
            "items": items,
            "order_id": str(invno),
            "description": f"Заказ #{invno} — ZA Мойка",
            "amount": final_amount
        }
    }


# ==========================================
# 🚀 ЭНДПОИНТЫ
# ==========================================

# --------------------------------------------------
# 1. ИНИЦИАЛИЗАЦИЯ ПЛАТЕЖА (исходящий запрос)
# --------------------------------------------------
@router.post("/init-payment")
def init_payment(
    invno: int = Query(..., description="Номер счёта INVOICES"),
    db: Session = Depends(get_db)
):
    """
    Инициализация платежа в LIFE PAY.
    
    1. Загружаем состав заказа (INVOICES + ORDSPEC + ARTIKLS)
    2. Формируем invoice_data.items
    3. Отправляем на LIFE PAY API
    4. Возвращаем invoiceId или ссылку на оплату
    
    Вызывается при нажатии "Оплатить через терминал" в интерфейсе.
    """
    try:
        log.info(f"💳 Initializing LIFE PAY payment for INVNO={invno}")
        
        # Формируем invoice_data
        invoice_data = build_invoice_data(invno, db)
        if not invoice_data:
            return {"success": False, "error": "Счёт не найден или нет позиций"}
        
        # Добавляем поля авторизации
        api_payload = {
            "partner_id": LIFEPAY_CONFIG["partner_id"],
            "service_id": LIFEPAY_CONFIG["service_id"],
            "order_id": str(invno),
            "description": invoice_data["invoice_data"]["description"],
            "amount": invoice_data["invoice_data"]["amount"],
            "invoice_data": invoice_data["invoice_data"],
        }
        
        # Генерируем подпись
        api_payload["signature"] = generate_md5_signature(api_payload, LIFEPAY_CONFIG["secret_key"])
        
        # Отправляем на LIFE PAY
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{LIFEPAY_CONFIG['api_url']}/v{LIFEPAY_CONFIG['version']}/create-invoice",
                json=api_payload,
                headers={"Content-Type": "application/json"}
            )
        
        if response.status_code == 200:
            result = response.json()
            log.info(f"✅ LIFE PAY invoice created: {result}")
            
            # Сохраняем ссылку на оплату в INVOICES (нужно добавить поле PAYLINK)
            safe_execute(db, """
                UPDATE INVOICES 
                SET PAYLINK = :link, PAYLINK_CREATED = CURRENT_TIMESTAMP 
                WHERE INVNO = :invno
            """, {"link": result.get("payment_url"), "invno": invno})
            
            db.commit()
            
            return {
                "success": True,
                "invoice_id": result.get("invoice_id"),
                "payment_url": result.get("payment_url"),
                "amount": invoice_data["invoice_data"]["amount"],
                "items_count": len(invoice_data["invoice_data"]["items"])
            }
        else:
            log.error(f"❌ LIFE PAY API error: {response.status_code} - {response.text}")
            return {
                "success": False,
                "error": f"LIFE PAY API error {response.status_code}",
                "details": response.text
            }
    
    except Exception as e:
        log.error(f"Init payment error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


# --------------------------------------------------
# 2. WEBHOOK (входящее уведомление)
# --------------------------------------------------
@router.post("/webhook")
async def lifepay_webhook(
    request: Request,
    x_life_signature: Optional[str] = Header(None, alias="X-Life-Signature"),
    db: Session = Depends(get_db)
):
    """
    Webhook от LIFE PAY — входящее уведомление о транзакции.
    
    LIFE PAY отправляет POST после каждой успешной/неуспешной транзакции.
    Мы обязаны ответить HTTP 200, иначе повтор: 1м, 3м, 5м, 10м, ... до 10 попыток.
    
    Сохраняем факт оплаты в PAYMNT:
    - INVNO = из order_id
    - AMNT = amount
    - TYP = 1 (card), 0 (cash)
    - PDATE = created
    - NOTE = number (номер транзакции LIFE PAY)
    
    Идемпотентность: если транзакция уже обработана — не дублируем.
    """
    try:
        body = await request.json()
        log.info(f"📩 LIFE PAY webhook received: {json.dumps(body, ensure_ascii=False)}")
        
        # 1. Верифицируем подпись
        signature = x_life_signature or body.get("check", "")
        if not verify_webhook_signature(body, signature):
            log.warning("❌ Invalid webhook signature — rejecting")
            return {"success": False, "error": "Invalid signature"}, 400
        
        # 2. Извлекаем ключевые поля
        transaction_number = body.get("number")      # Номер транзакции LIFE PAY
        status = body.get("status")                   # "success" или "fail"
        method = body.get("method")                   # "card", "cash", "recurrent"
        amount = float(body.get("amount", 0))
        created = body.get("created")                 # ISO 8601
        order_id = body.get("order_id")               # INVNO
        description = body.get("description", "")
        rrn = body.get("rrn", "")                     # RRN транзакции
        pan = body.get("pan", "")                     # Маскированный номер карты
        
        log.info(f"📋 Transaction: number={transaction_number}, status={status}, "
                 f"amount={amount}, order_id={order_id}, method={method}")
        
        # 3. Обрабатываем только успешные платежи
        if status != "success":
            log.info(f"⚠️ Non-success status: {status} — not writing to PAYMNT")
            return {"success": True, "message": f"Статус {status}, обработка не требуется"}
        
        # 4. Извлекаем INVNO
        invno = None
        if order_id:
            invno = int(order_id)
        elif "Заказ #" in description:
            # Парсим из description: "Заказ #123 — ZA Мойка"
            try:
                invno = int(description.split("#")[1].split(" ")[0])
            except (IndexError, ValueError):
                log.warning(f"❌ Cannot parse INVNO from description: {description}")
        
        if not invno:
            log.warning(f"❌ Cannot determine INVNO for transaction {transaction_number}")
            return {"success": False, "error": "Cannot determine INVNO"}
        
        # 5. Идемпотентность — проверяем, не обработана ли уже эта транзакция
        existing = safe_execute(db, """
            SELECT 1 FROM PAYMNT WHERE NOTE = :note AND INVNO = :invno
        """, {"note": transaction_number, "invno": invno}, fetch_one=True)
        
        if existing:
            log.info(f"⏭️ Transaction {transaction_number} already processed for INVNO={invno}")
            return {"success": True, "message": "Уже обработано"}
        
        # 6. Записываем в PAYMNT
        typ = 1 if method in ["card", "recurrent", "internetAcquiring"] else 0
        
        safe_execute(db, """
            INSERT INTO PAYMNT (INVNO, DEPNO, PDATE, PAYDATE, AMNT, CURENCY, RATIO, TYP, NOTE, AMNTR)
            VALUES (:invno, 1, :pdate, :paydate, :amnt, 1, 1, :typ, :note, :amnt)
        """, {
            "invno": invno,
            "pdate": created,
            "paydate": created[:10],  # YYYY-MM-DD
            "amnt": amount,
            "typ": typ,
            "note": f"LIFE:{transaction_number}|RRN:{rrn}"
        })
        
        # Обновляем статус оплаты в INVOICES
        safe_execute(db, """
            UPDATE INVOICES 
            SET PAID = 1, INVSTATE = 2 
            WHERE INVNO = :invno
        """, {"invno": invno})
        
        db.commit()
        
        log.info(f"✅ Payment recorded: INVNO={invno}, AMNT={amount}, TYP={typ}, "
                 f"NOTE={transaction_number}")
        
        return {
            "success": True,
            "message": f"Оплата {amount}₽ за счёт #{invno} записана",
            "invno": invno,
            "transaction_number": transaction_number,
            "amount": amount,
            "typ": typ
        }
    
    except Exception as e:
        log.error(f"Webhook error: {e}", exc_info=True)
        # Даже при ошибке возвращаем 200, чтобы LIFE PAY не повторял
        return {"success": False, "error": str(e)}


# --------------------------------------------------
# 3. ПРОВЕРКА СТАТУСА ПЛАТЕЖА
# --------------------------------------------------
@router.get("/check-payment")
def check_payment(
    invno: int = Query(..., description="Номер счёта"),
    db: Session = Depends(get_db)
):
    """
    Проверка статуса оплаты конкретного счёта.
    """
    try:
        # Проверяем INVOICES
        invoice = safe_execute(db, """
            SELECT INVNO, AMOUNT, PAID, PAYDATE, INVSTATE, PAYLINK
            FROM INVOICES
            WHERE INVNO = :invno
        """, {"invno": invno}, fetch_one=True)
        
        if not invoice:
            return {"success": False, "error": "Счёт не найден"}
        
        invno_db, amount, paid, paydate, inv_state, paylink = invoice
        
        # Проверяем PAYMNT для детализации
        payment = safe_execute(db, """
            SELECT PMTNO, AMNT, TYP, PDATE, NOTE
            FROM PAYMNT
            WHERE INVNO = :invno
            ORDER BY PDATE DESC
            ROWS 1
        """, {"invno": invno}, fetch_one=True)
        
        payment_info = None
        if payment:
            payment_info = {
                "pmt_no": payment[0],
                "amount": float(payment[1]) if payment[1] else 0,
                "type": payment[2],
                "date": payment[3].strftime("%Y-%m-%d %H:%M") if payment[3] else None,
                "note": decode_fb(payment[4]) or ""
            }
        
        return {
            "success": True,
            "invno": invno_db,
            "amount": float(amount) if amount else 0,
            "paid": bool(paid),
            "paydate": paydate.strftime("%Y-%m-%d %H:%M") if paydate else None,
            "state": inv_state,
            "payment_url": paylink,
            "payment_detail": payment_info
        }
    
    except Exception as e:
        log.error(f"Check payment error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


# --------------------------------------------------
# 4. СПИСОК ТРАНЗАКЦИЙ
# --------------------------------------------------
@router.get("/transactions")
def get_transactions(
    limit: int = Query(50, ge=1, le=200),
    month: Optional[str] = Query(None, description="YYYY-MM для фильтрации"),
    db: Session = Depends(get_db)
):
    """
    Получение списка транзакций LIFE PAY из PAYMNT.
    """
    try:
        if month:
            year, mon = map(int, month.split('-'))
            where_clause = f"""
                WHERE CAST(PDATE AS DATE) >= '{year}-{mon:02d}-01'
                  AND CAST(PDATE AS DATE) < '{year}-{mon+1 if mon < 12 else year+1}-{1 if mon < 12 else 1:02d}-01'
            """
        else:
            where_clause = ""
        
        query = f"""
            SELECT
                p.PMTNO,
                p.INVNO,
                p.AMNT,
                p.TYP,
                p.PDATE,
                p.NOTE,
                i.CLNAME,
                i.CONTNO,
                i.AMOUNT as invoice_amount
            FROM PAYMNT p
            LEFT JOIN INVOICES i ON p.INVNO = i.INVNO
            {where_clause}
            ORDER BY p.PDATE DESC
            ROWS :limit
        """
        rows = safe_execute(db, query, {"limit": limit}, fetch_all=True)
        
        transactions = []
        for row in rows:
            pmt_no, invno, amnt, typ, pdate, note, clname, contno, inv_amount = row
            transactions.append({
                "pmt_no": pmt_no,
                "invno": invno,
                "amount": float(amnt) if amnt else 0,
                "type": "card" if typ == 1 else "cash",
                "date": pdate.strftime("%Y-%m-%d %H:%M") if pdate else None,
                "note": decode_fb(note) or "",
                "client": decode_fb(clname) or "",
                "car_number": decode_fb(contno) or "",
                "invoice_amount": float(inv_amount) if inv_amount else 0,
            })
        
        return {
            "success": True,
            "transactions": transactions,
            "count": len(transactions)
        }
    
    except Exception as e:
        log.error(f"Get transactions error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}
