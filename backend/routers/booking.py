"""
Модуль бронирования и управления записями
"""
from fastapi import APIRouter, Depends, Request, HTTPException, Query
from typing import Optional
import idempotency
from sqlalchemy.orm import Session
from sqlalchemy import text
from schemas import BookingCreate, UpdateStatus, UpdatePayment, ProductInvoiceCreate
from database import get_db
from utils import decode_fb, get_next_gen_id, safe_execute, retry_on_deadlock
from datetime import datetime, timedelta
from decimal import Decimal
import logging

from jwt_auth import get_current_empno

router = APIRouter(prefix="/api", tags=["booking"])
log = logging.getLogger("zamoika")


def to_cp1251(text: str) -> str:
    """Безопасное преобразование строки в CP1251 (Firebird WIN1251)."""
    if not text:
        return text
    return text.encode('cp1251', errors='replace').decode('cp1251')


@router.post("/create-booking")
@router.post("/book")
def create_booking(
    data: BookingCreate,
    empno: int = Depends(get_current_empno),
    idempotency_key: Optional[str] = None,
    db: Session = Depends(get_db),
):
    # 🔒 Идемпотентность
    if idempotency_key:
        is_new, cached = idempotency.acquire(idempotency_key)
        if not is_new:
            if cached is not None:
                log.info(f"♻️ Idempotent replay: key={idempotency_key[:8]}...")
                return cached
            return {
                "success": False,
                "error": "Запрос с таким Idempotency-Key уже обрабатывается",
                "code": "IDEMPOTENCY_CONFLICT",
            }

    try:
        start_dt = datetime.strptime(f"{data.date} {data.time}", "%Y-%m-%d %H:%M")
        end_dt = start_dt + timedelta(minutes=data.duration)

        # 🔥 ЛОГИКА ПОИСКА КЛИЕНТА (с учетом ID-чата)
        cl = None
        chat_id = getattr(data, 'chat_id', None)

        if chat_id and chat_id.strip():
            # Ищем по ID-чату (в поле CLPHONEHOME)
            cl = safe_execute(db, "SELECT CLNUM AS clnum FROM CLIENTS WHERE CLPHONEHOME = :chat", {"chat": chat_id.strip()}, fetch_one=True)
            if cl:
                log.info(f"✅ Клиент найден по ID-чату: {chat_id}")
        else:
            # Если ID-чата нет, ищем по мобильному телефону
            cl = safe_execute(db, "SELECT CLNUM AS clnum FROM CLIENTS WHERE CLPHONEMOB = :p", {"p": data.client_phone}, fetch_one=True)
            if cl:
                log.info(f"✅ Клиент найден по телефону: {data.client_phone}")

        if cl:
            clnum = cl.clnum
        else:
            # Создаем нового клиента
            final_mobile = None
            final_home = None

            if chat_id and chat_id.strip():
                final_home = to_cp1251(chat_id.strip())
            else:
                final_mobile = data.client_phone

            new_client = safe_execute(db, """
                INSERT INTO CLIENTS (CLNAME, CLPHONE, CLPHONEMOB, CLPHONEHOME, CLDEP, CLTYP, CLURLTS)
                VALUES (:n, NULL, :mob, :home, 1, :t, :u)
                RETURNING CLNUM
            """, {
                "n": to_cp1251(data.client_name),
                "mob": final_mobile,
                "home": final_home,
                "t": data.client_type,
                "u": data.urlts
            }, fetch_one=True)
            clnum = new_client.clnum if new_client else None
            if not clnum:
                raise Exception("Не удалось получить ID нового клиента")

        invno = get_next_gen_id(db, "INVNO_NEW")
        manager = safe_execute(db, "SELECT EMPLOYNAME AS employname FROM EMPLOYER WHERE EMPNO = :e", {"e": empno}, fetch_one=True)
        manager_name = to_cp1251(decode_fb(manager.employname)) if manager else ""

        total = 0.0
        services_data = []
        for art in data.services:
            s = safe_execute(db, "SELECT ARTNO AS artno, PRICE AS price FROM ARTIKLS WHERE ARTNO = :a", {"a": art}, fetch_one=True)
            if s:
                total += float(s.price or 0)
                services_data.append(s)

        final = total * (1 - data.discount / 100)

        safe_execute(db, """INSERT INTO INVOICES (INVNO, CLNUM, AMOUNT, ACCAMOUNT, INVDATE, INVSTATE, DOPDISCOUNT, DEPNO, EMPLOYNO, EMPLOYNAME, OPTINV, CONTNO)
                            VALUES (:i, :c, :am, :am, :invdate, 0, :d, 1, :e, :m, 1, :contno)""",
                     {"i": invno, "c": clnum, "am": final, "d": data.discount, "e": empno,
                      "m": manager_name, "contno": "", "invdate": start_dt.date()})

        for i, s in enumerate(services_data):
            safe_execute(db, "INSERT INTO INVSPEC (INVNO, DEPNO, ORDNO, SYSNO, QTY, PRICE, CLRNO) VALUES (:i, 1, :o, 0, 1, 0, 0)", {"i": invno, "o": i})
            safe_execute(db, "INSERT INTO ORDSPEC (INVNO, DEPNO, ORDNO, ARTNO, CLRNO, QTY, PRICE, DOP) VALUES (:i, 1, :o, :a, 1, 1, :p, 1)", {"i": invno, "o": i, "a": s.artno, "p": float(s.price)})

        s_no_row = safe_execute(db, "SELECT OUTNUMB AS outnumb FROM GETNEXTNUMB(18, NULL, EXTRACT(YEAR FROM CURRENT_DATE), 0, 0, 0, 0)", fetch_one=True)
        s_no = s_no_row.outnumb if s_no_row else 1

        AUTOMOYKA_EMPNO = 4

        safe_execute(db, """INSERT INTO ZMRSCHDL (S_NO, INVNO, S_START, S_FINISH, NOTE, S_STATE, EMPNO, DEPNO, S_OPTIONS)
                            VALUES (:n, :i, :st, :en, :nt, 0, :empno_auto, 1, 2)""",
                     {"n": s_no, "i": invno, "st": start_dt, "en": end_dt, "nt": to_cp1251(data.note), "empno_auto": AUTOMOYKA_EMPNO})

        db.commit()

        result = {"success": True, "invno": invno, "amount": final}

        if idempotency_key:
            idempotency.store(idempotency_key, result)

        return result

    except Exception as e:
        db.rollback()
        log.error(f"Booking create failed: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.post("/update-status")
@retry_on_deadlock(max_retries=3)
def update_status(data: UpdateStatus, db: Session = Depends(get_db)):
    log.info(f"📥 update-status received: invno={data.invno}, status={data.status}, empno={getattr(data, 'empno', 'NOT SET')}")

    st_map = {"Запланирован": 0, "Согласован": 1, "Выполнен": 2, "Отменен": 3}
    if data.status not in st_map:
        return {"success": False, "error": "Неверный статус"}

    status_code = st_map[data.status]
    empno = getattr(data, 'empno', None)

    db.execute(text("UPDATE ZMRSCHDL SET S_STATE = :s WHERE INVNO = :i"),
               {"s": status_code, "i": data.invno})

    if status_code == 3:
        db.execute(text("DELETE FROM ORDSPEC WHERE INVNO = :i"), {"i": data.invno})
        db.execute(text("DELETE FROM INVSPEC WHERE INVNO = :i"), {"i": data.invno})
        db.execute(text("UPDATE INVOICES SET AMOUNT = 0, DOPDISCOUNT = 0, PAID = 0, INVSTATE = 3 WHERE INVNO = :i"), {"i": data.invno})

    elif status_code == 2 and empno:
        db.execute(text("""
            UPDATE INVOICES
            SET
                EMPLOYNO = :empno,
                INVSTATE = 2,
                INVDATE = COALESCE(
                    (SELECT CAST(z.S_START AS DATE) FROM ZMRSCHDL z WHERE z.INVNO = :invno ROWS 1),
                    CURRENT_DATE
                )
            WHERE INVNO = :invno
        """), {"empno": empno, "invno": data.invno})

    db.commit()
    return {"success": True}


@router.post("/update-payment")
@retry_on_deadlock(max_retries=3)
def update_payment(data: UpdatePayment, db: Session = Depends(get_db)):
    val = 1 if data.paid else 0
    dt = datetime.now().date() if data.paid else None

    db.execute(text("UPDATE INVOICES SET PAID = :p, PAYDATE = :d WHERE INVNO = :i"), {"p": val, "d": dt, "i": data.invno})
    db.commit()
    return {"success": True}


@router.post("/update-booking-full")
def update_booking_full(data: dict, db: Session = Depends(get_db)):
    try:
        invno = data.get('invno')
        service_ids = data.get('services', [])
        new_date = data.get('date')
        new_time = data.get('time')
        duration = data.get('duration', 30)
        discount = data.get('discount', 0)
        status = data.get('status')
        paid = data.get('paid', False)
        empno = data.get('empno')
        car_number = to_cp1251(data.get('car_number', ''))

        st_map = {"Запланирован": 0, "Согласован": 1, "Выполнен": 2, "Отменен": 3}
        status_code = st_map.get(status, 0)

        hour = int(new_time[:2])
        minute = int(new_time[3:5])
        start_dt = datetime.strptime(f"{new_date} {hour:02d}:{minute:02d}:00", "%Y-%m-%d %H:%M:%S")
        end_dt = start_dt + timedelta(minutes=duration)

        safe_execute(db, """
            UPDATE ZMRSCHDL
            SET S_START = :st, S_FINISH = :en, S_STATE = :state
            WHERE INVNO = :i
        """, {"st": start_dt, "en": end_dt, "state": status_code, "i": invno})

        safe_execute(db, "DELETE FROM ORDSPEC WHERE INVNO = :i", {"i": invno})
        safe_execute(db, "DELETE FROM INVSPEC WHERE INVNO = :i", {"i": invno})

        total = 0.0
        if status_code != 3:
            for i, art_id in enumerate(service_ids):
                s = safe_execute(db, "SELECT PRICE FROM ARTIKLS WHERE ARTNO = :a", {"a": art_id}, fetch_one=True)
                if s:
                    price = float(s[0])
                    total += price
                    safe_execute(db, "INSERT INTO INVSPEC (INVNO, DEPNO, ORDNO, SYSNO, QTY, PRICE, CLRNO) VALUES (:i, 1, :o, 0, 1, 0, 0)",
                               {"i": invno, "o": i})
                    safe_execute(db, "INSERT INTO ORDSPEC (INVNO, DEPNO, ORDNO, ARTNO, CLRNO, QTY, PRICE, DOP) VALUES (:i, 1, :o, :a, 1, 1, :p, 1)",
                               {"i": invno, "o": i, "a": art_id, "p": price})

        final_amount = total * (1 - discount / 100)

        if status_code == 3:
            safe_execute(db, """
                UPDATE INVOICES
                SET AMOUNT = 0, DOPDISCOUNT = 0, PAID = 0, CONTNO = :car
                WHERE INVNO = :i
            """, {"i": invno, "car": car_number})
        elif status_code == 2 and empno:
            safe_execute(db, """
                UPDATE INVOICES
                SET
                    AMOUNT = :am,
                    DOPDISCOUNT = :d,
                    PAID = :p,
                    EMPLOYNO = :empno,
                    INVDATE = :invdate,
                    CONTNO = :car,
                    INVSTATE = 2
                WHERE INVNO = :i
            """, {"am": final_amount, "d": discount, "p": 1 if paid else 0,
                  "empno": empno, "i": invno, "car": car_number,
                  "invdate": start_dt.date()})
        else:
            safe_execute(db, """
                UPDATE INVOICES
                SET AMOUNT = :am, DOPDISCOUNT = :d, PAID = :p, CONTNO = :car, INVDATE = :invdate
                WHERE INVNO = :i
            """, {"am": final_amount, "d": discount, "p": 1 if paid else 0,
                  "i": invno, "car": car_number, "invdate": start_dt.date()})

        db.commit()
        log.info(f"Booking {invno} updated successfully, car_number: {car_number}, invdate: {start_dt.date()}")
        return {"success": True, "invno": invno}
    except Exception as e:
        db.rollback()
        log.error(f"Update booking full failed: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.post("/create-product-invoice")
def create_product_invoice(
    data: ProductInvoiceCreate,
    empno: int = Depends(get_current_empno),
    db: Session = Depends(get_db),
):
    """
    Продажа товаров клиенту — создаёт счёт (INVOICES) без накладной.
    """
    try:
        log.info(f"📥 create-product-invoice received")
        log.info(f"📥 items={data.items}")
        log.info(f"📥 client_name={data.client_name}, client_phone={data.client_phone}")
        log.info(f"📥 is_paid={data.is_paid}, discount={data.discount}")

        # Получаем имя сотрудника
        manager = safe_execute(
            db,
            "SELECT EMPLOYNAME FROM EMPLOYER WHERE EMPNO = :e",
            {"e": empno},
            fetch_one=True,
        )
        manager_name = to_cp1251(decode_fb(manager[0])) if manager else ""

        # 🔥 НАХОДИМ ИЛИ СОЗДАЕМ КЛИЕНТА по телефону/имени
        clnum = None
        if getattr(data, 'is_arendych', False):
            # Арендич — специальный клиент
            cl = safe_execute(db, "SELECT CLNUM FROM CLIENTS WHERE CLPHONEMOB = '89810410000' OR CLPHONE = '89810410000'", fetch_one=True)
            if cl:
                clnum = cl[0]
                log.info(f"✅ Найден клиент Арендич: CLNUM={clnum}")
        elif data.client_phone:
            # Ищем клиента по телефону
            cl = safe_execute(
                db,
                "SELECT CLNUM FROM CLIENTS WHERE CLPHONEMOB = :p OR CLPHONE = :p",
                {"p": data.client_phone},
                fetch_one=True,
            )
            if cl:
                clnum = cl[0]
                log.info(f"✅ Клиент найден по телефону: {data.client_phone}, CLNUM={clnum}")
            elif data.client_name:
                # Создаём нового клиента
                new_cl = safe_execute(
                    db,
                    """
                    INSERT INTO CLIENTS (CLNAME, CLPHONEMOB, CLDEP)
                    VALUES (:n, :p, 1)
                    RETURNING CLNUM
                    """,
                    {"n": to_cp1251(data.client_name), "p": data.client_phone},
                    fetch_one=True,
                )
                if new_cl:
                    clnum = new_cl[0]
                    log.info(f"✅ Создан новый клиент: {data.client_name}, CLNUM={clnum}")
        else:
            log.warning(f"⚠️ Нет client_phone или is_arendych — клиент не привязан")

        # Формируем NOTE
        if data.note and data.note.strip():
            note = data.note.strip()
        else:
            items_summary = []
            for item in data.items:
                art = safe_execute(
                    db,
                    "SELECT NAME FROM ARTIKLS WHERE ARTNO = :a",
                    {"a": int(item.artno)},
                    fetch_one=True,
                )
                art_name = to_cp1251(decode_fb(art[0])) if art else f"#{item.artno}"
                items_summary.append(f"{art_name} ({int(item.qty)} шт)")
            note = "Продажа товаров: " + ", ".join(items_summary)

        note = to_cp1251(note)

        # Создаем счёт (INVOICES) для продажи товаров
        invno = get_next_gen_id(db, "INVNO_NEW")

        # Определяем клиента
        clnum = None
        if getattr(data, 'is_arendych', False):
            cl = safe_execute(db, "SELECT CLNUM FROM CLIENTS WHERE CLPHONEMOB = '89810410000' OR CLPHONE = '89810410000'", fetch_one=True)
            if cl:
                clnum = cl[0]

        # 🔥 БЕЗОПАСНЫЙ РАСЧЕТ СУММЫ
        total_amount = 0.0
        for item in data.items:
            try:
                qty = float(item.qty)
                price = float(item.price)
                total_amount += price * qty
            except Exception as e:
                log.error(f"❌ Ошибка приведения типов: item={item}, error={e}")
                return {"success": False, "error": f"Ошибка в товаре: {item}"}

        discount = float(getattr(data, 'discount', 0) or 0)
        final_amount = total_amount * (1 - discount / 100)

        is_paid = 1 if getattr(data, 'is_paid', True) else 0
        paydate = "CURRENT_DATE" if is_paid else "NULL"

        safe_execute(db, f"""
            INSERT INTO INVOICES (INVNO, CLNUM, AMOUNT, ACCAMOUNT, INVDATE, INVSTATE, DOPDISCOUNT, DEPNO, EMPLOYNO, EMPLOYNAME, OPTINV, CONTNO, PAID, PAYDATE)
            VALUES (:i, :c, :am, :am, CURRENT_DATE, 0, :d, 1, :e, :m, 1, '', {is_paid}, {paydate})
        """, {
            "i": invno,
            "c": clnum,
            "am": float(final_amount),
            "d": data.discount,
            "e": empno,
            "m": manager_name
        })

        # Добавляем позиции в ORDSPEC и INVSPEC
        for idx, item in enumerate(data.items):
            safe_execute(db, "INSERT INTO INVSPEC (INVNO, DEPNO, ORDNO, SYSNO, QTY, PRICE, CLRNO) VALUES (:i, 1, :o, 0, :q, 0, 0)",
                         {"i": invno, "o": idx, "q": int(item.qty)})
            safe_execute(db, "INSERT INTO ORDSPEC (INVNO, DEPNO, ORDNO, ARTNO, CLRNO, QTY, PRICE, DOP) VALUES (:i, 1, :o, :a, 1, :q, :p, 1)",
                         {"i": invno, "o": idx, "a": item.artno, "q": int(item.qty), "p": item.price})

        log.info(f"📄 Создан счет №{invno} на сумму {total_amount}")

        db.commit()

        return {
            "success": True,
            "invno": invno,
            "items_count": len(data.items),
            "message": f"Счет №{invno} создан",
        }

    except Exception as e:
        db.rollback()
        log.error(f"❌ Product sale error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.get("/invoices-report")
def get_invoices_report(date: str = Query(...), db: Session = Depends(get_db)):
    try:
        query = """
            SELECT
                i.INVN as invno,
                COALESCE(c.CLNAME, i.CONTACTNAME, 'Клиент') as client_name,
                COALESCE(c.CLPHONEMOB, c.CLPHONE, '') as client_phone,
                COALESCE(i.AMOUNT, 0) as total_price,
                COALESCE(i.DOPDISCOUNT, 0) as discount,
                COALESCE(e.EMPLOYNAME, '') as manager,
                COALESCE(a.NAME, 'Товар #' || CAST(o.ARTNO AS VARCHAR(10))) as item_name,
                COALESCE(o.QTY, 1) as qty,
                COALESCE(o.PRICE, 0) as item_price,
                o.ARTNO as artno,
                i.CONTNO as contno,
                i.PAID as paid,
                z.S_STATE as state
            FROM INVOICES i
            LEFT JOIN CLIENTS c ON i.CLNUM = c.CLNUM
            LEFT JOIN EMPLOYER e ON i.EMPLOYNO = e.EMPNO
            LEFT JOIN ORDSPEC o ON i.INVNO = o.INVNO
            LEFT JOIN ARTIKLS a ON o.ARTNO = a.ARTNO
            LEFT JOIN ZMRSCHDL z ON z.INVNO = i.INVNO
            WHERE CAST(i.INVDATE AS DATE) = :date
              AND o.ARTNO IS NOT NULL
            ORDER BY i.INVN, o.ORDNO
        """
        rows = safe_execute(db, query, {"date": date}, fetch_all=True)

        invoices_dict = {}
        for row in rows:
            invno = row[0]
            if invno not in invoices_dict:
                invoices_dict[invno] = {
                    "invno": invno,
                    "client_name": decode_fb(row[1]) or "",
                    "client_phone": decode_fb(row[2]) or "",
                    "total_price": float(row[3]) if row[3] else 0,
                    "discount": float(row[4]) if row[4] else 0,
                    "manager": decode_fb(row[5]) or "",
                    "items": [],
                    "contno": decode_fb(row[10]) or "",
                    "paid": int(row[11]) if row[11] is not None else 0,
                    "state": int(row[12]) if row[12] is not None else 0
                }

            invoices_dict[invno]["items"].append({
                "name": decode_fb(row[6]) or "Без названия",
                "qty": float(row[7]) if row[7] else 1,
                "price": float(row[8]) if row[8] else 0,
                "artno": int(row[9]) if row[9] else 0
           })

        invoices = list(invoices_dict.values())

        total_revenue = sum(inv["total_price"] for inv in invoices)
        total_discount = sum(inv["total_price"] * inv["discount"] / 100 for inv in invoices)
        net_revenue = total_revenue - total_discount

        return {
            "success": True,
            "date": date,
            "invoices": invoices,
            "summary": {
                "total_invoices": len(invoices),
                "total_revenue": round(total_revenue, 2),
                "total_discount": round(total_discount, 2),
                "net_revenue": round(net_revenue, 2)
            }
        }
    except Exception as e:
        log.error(f"Invoices report error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


# ==========================================
# 📊 Ежемесячный отчёт по машинам Арендыча
# ==========================================
ARENDYCH_PHONE = '89810410000'

WASH_RATES = {
    10: 150, 15: 230, 20: 300, 30: 350,
    40: 400, 50: 450, 60: 500, 70: 600,
}

def _get_wash_rate(duration_min: int) -> int:
    if duration_min <= 0:
        return 0
    for dur in sorted(WASH_RATES.keys()):
        if duration_min <= dur:
            return WASH_RATES[dur]
    return WASH_RATES[70]


@router.get("/arendych-report")
def arendych_report(month: str = Query(..., description="YYYY-MM"), db: Session = Depends(get_db)):
    """
    Отчёт по Арендычу с добавлением блока незамерзайки
    """
    try:
        try:
            year, mon = map(int, month.split('-'))
            if not (1 <= mon <= 12):
                raise ValueError
        except Exception:
            return {"success": False, "error": "month должен быть в формате YYYY-MM"}

        start_date = f"{year:04d}-{mon:02d}-01"
        end_date = f"{year+1:04d}-01-01" if mon == 12 else f"{year:04d}-{mon+1:02d}-01"

        query = """
            SELECT
                i.INVN AS invno,
                i.INVDATE AS invdate,
                COALESCE(c.CLNAME, i.CONTACTNAME, 'Клиент') AS client_name,
                COALESCE(c.CLPHONEMOB, c.CLPHONE, '') AS client_phone,
                COALESCE(i.AMOUNT, 0) AS total_price,
                COALESCE(i.DOPDISCOUNT, 0) AS discount,
                COALESCE(e.EMPLOYNAME, '') AS manager,
                COALESCE(a.NAME, 'Товар #' || CAST(o.ARTNO AS VARCHAR(10))) AS item_name,
                COALESCE(o.QTY, 1) AS qty,
                COALESCE(o.PRICE, 0) AS item_price,
                o.ARTNO AS artno,
                i.CONTNO AS contno,
                z.S_START AS s_start,
                z.S_FINISH AS s_finish
            FROM INVOICES i
            LEFT JOIN CLIENTS c ON i.CLNUM = c.CLNUM
            LEFT JOIN EMPLOYER e ON i.EMPLOYNO = e.EMPNO
            LEFT JOIN ORDSPEC o ON i.INVNO = o.INVNO
            LEFT JOIN ARTIKLS a ON o.ARTNO = a.ARTNO
            LEFT JOIN ZMRSCHDL z ON z.INVNO = i.INVNO
            WHERE CAST(i.INVDATE AS DATE) >= CAST(:start_dt AS DATE)
              AND CAST(i.INVDATE AS DATE) <  CAST(:end_dt   AS DATE)
              AND (c.CLPHONEMOB = :phone OR c.CLPHONE = :phone)
              AND o.ARTNO IS NOT NULL
            ORDER BY i.INVDATE, i.INVN, o.ORDNO
        """
        rows = safe_execute(db, query, {
            "start_dt": start_date,
            "end_dt": end_date,
            "phone": ARENDYCH_PHONE,
        }, fetch_all=True)

        invoices_dict = {}
        for row in rows:
            invno = row[0]
            if invno not in invoices_dict:
                duration = 0
                s_start = row[12]
                s_finish = row[13]
                if s_start and s_finish:
                    delta = s_finish - s_start
                    duration = int(delta.total_seconds() // 60)

                invoices_dict[invno] = {
                    "invno": invno,
                    "invdate": row[1].strftime("%Y-%m-%d") if row[1] else "",
                    "client_name": decode_fb(row[2]) or "",
                    "client_phone": decode_fb(row[3]) or "",
                    "total_price": float(row[4]) if row[4] else 0,
                    "discount": float(row[5]) if row[5] else 0,
                    "manager": decode_fb(row[6]) or "",
                    "contno": decode_fb(row[11]) or "",
                    "duration": duration,
                    "bonus": _get_wash_rate(duration),
                    "items": [],
                }

            invoices_dict[invno]["items"].append({
                "name": decode_fb(row[7]) or "Без названия",
                "qty": float(row[8]) if row[8] else 1,
                "price": float(row[9]) if row[9] else 0,
                "artno": int(row[10]) if row[10] else 0,
            })

        invoices = list(invoices_dict.values())

        by_day = {}
        for inv in invoices:
            by_day.setdefault(inv["invdate"], []).append(inv)

        by_manager = {}
        for inv in invoices:
            m = inv["manager"] or "Неизвестный"
            by_manager.setdefault(m, {"count": 0, "sum": 0.0, "bonus": 0.0})
            by_manager[m]["count"] += 1
            by_manager[m]["sum"] += inv["total_price"]
            by_manager[m]["bonus"] += inv["bonus"]

        # 🔥 ДОБАВЛЯЕМ БЛОК ПРОДАЖ НЕЗАМЕРЗАЕК
        # 🔥 ДОБАВЛЯЕМ БЛОК ПРОДАЖ НЕЗАМЕРЗАЕК
        # Незамерзайки определяются по наличию "незамерз" или "antifreeze" в названии
        # Или по списку артикулов ANTIFREEZE_ARTNOS
        ANTIFREEZE_KEYWORDS = ["незамерз", "antifreeze", "антифриз", "жидкость"]

        antifreeze_items = []
        for inv in invoices:
            for item in inv["items"]:
                item_name = (item.get("name", "") or "").lower()
                artno = item.get("artno", 0)

                # Проверяем, является ли товар незамерзайкой
                is_antifreeze = any(keyword in item_name for keyword in ANTIFREEZE_KEYWORDS)

                if is_antifreeze:
                    antifreeze_items.append({
                        "invno": inv["invno"],
                        "contno": inv["contno"],
                        "date": inv["invdate"],
                        "item_name": item["name"],
                        "qty": item["qty"],
                        "price": item["price"],
                        "total": item["qty"] * item["price"],
                    })

        # Группируем незамерзайки по дате и суммируем
        antifreeze_by_date = {}
        for item in antifreeze_items:
            date = item["date"]
            if date not in antifreeze_by_date:
                antifreeze_by_date[date] = {
                    "date": date,
                    "total_qty": 0,
                    "total_sum": 0,
                    "by_car": {},
                    "items_detail": []
                }
            antifreeze_by_date[date]["total_qty"] += item["qty"]
            antifreeze_by_date[date]["total_sum"] += item["total"]

            # Группируем по номеру авто
            car = item["contno"] or "Без номера"
            if car not in antifreeze_by_date[date]["by_car"]:
                antifreeze_by_date[date]["by_car"][car] = {
                    "car": car,
                    "qty": 0,
                    "sum": 0
                }
            antifreeze_by_date[date]["by_car"][car]["qty"] += item["qty"]
            antifreeze_by_date[date]["by_car"][car]["sum"] += item["total"]

            antifreeze_by_date[date]["items_detail"].append(item)

        return {
            "success": True,
            "month": month,
            "total_invoices": len(invoices),
            "total_sum": round(sum(i["total_price"] for i in invoices), 2),
            "total_bonus": round(sum(i["bonus"] for i in invoices), 2),
            "by_day": by_day,
            "by_manager": by_manager,
            "invoices": invoices,
            "antifreeze_sales": antifreeze_items,
            "antifreeze_by_date": antifreeze_by_date,
        }

    except Exception as e:
        log.error(f"Arendych report error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}
