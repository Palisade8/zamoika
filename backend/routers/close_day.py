"""
Закрытие дня: формирование общей расходной накладной
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from database import get_db
from utils import decode_fb, safe_execute, get_next_gen_id
from datetime import datetime
import logging

router = APIRouter(prefix="/api", tags=["close-day"])
log = logging.getLogger("zamoika")


@router.post("/close-day")
def close_day(
    date: str = Query(..., description="YYYY-MM-DD"),
    empno: int = Depends(lambda: 1),  # TODO: получить из JWT
    db: Session = Depends(get_db)
):
    """
    Закрытие дня: создание общей расходной накладной для всех продаж товаров за день.
    
    Логика:
    1. Находит все счета (INVOICES) с позициями (ORDSPEC) за дату
    2. Группирует товары по артикулам
    3. Создаёт одну расходную накладную (MOVEWHS) со всеми товарами
    4. Помечает товары как списанные (PROVED = 1)
    """
    try:
        log.info(f"📋 Close day: {date}")

        # 1. Находим все продажи товаров за день
        query = """
            SELECT
                o.ARTNO,
                a.NAME as product_name,
                SUM(o.QTY) as total_qty,
                AVG(o.PRICE) as avg_price,
                COUNT(DISTINCT i.INVNO) as invoice_count
            FROM ORDSPEC o
            LEFT JOIN ARTIKLS a ON o.ARTNO = a.ARTNO
            LEFT JOIN INVOICES i ON o.INVNO = i.INVNO
            WHERE CAST(i.INVDATE AS DATE) = CAST(:date AS DATE)
            GROUP BY o.ARTNO, a.NAME
            ORDER BY o.ARTNO
        """
        rows = safe_execute(db, query, {"date": date}, fetch_all=True)

        if not rows:
            return {
                "success": True,
                "message": f"Нет продаж за {date}",
                "items": [],
                "moveno": None,
                "naklno": None
            }

        # 2. Формируем список товаров для накладной
        items = []
        for row in rows:
            artno = row[0]
            name = decode_fb(row[1]) or f"Товар #{artno}"
            total_qty = float(row[2])
            avg_price = float(row[3]) if row[3] else 0
            invoice_count = int(row[4])

            items.append({
                "artno": artno,
                "name": name,
                "qty": total_qty,
                "price": avg_price,
                "invoice_count": invoice_count,
            })

        log.info(f"📦 Товаров для списания: {len(items)}")

        # 3. Создаём MOVENO (номер накладной)
        moveno_row = safe_execute(
            db,
            "SELECT COALESCE(MAX(MOVENO), 0) + 1 FROM MOVEWHS",
            fetch_one=True,
        )
        moveno = int(moveno_row[0]) if moveno_row else 1

        # 4. Создаём NAKLNO через NUMBNEXT
        naklno_row = safe_execute(db, """
            UPDATE NUMBNEXT SET DOCNUMB = DOCNUMB + 1
            WHERE DOCTYPE = 0 AND DOCYEAR = EXTRACT(YEAR FROM CURRENT_DATE) AND DOCWHS = 1
            RETURNING DOCNUMB
        """, fetch_one=True)
        naklno = int(naklno_row[0]) if naklno_row else moveno

        # 5. Создаём записи в MOVEWHS (расходная накладная)
        # Структура MOVEWHS: MOVENO, MOVDATE, WHSNO, ARTNO, QTY, PRICE, SUM, PROVED, ...
        total_sum = 0
        for idx, item in enumerate(items):
            item_sum = item["qty"] * item["price"]
            total_sum += item_sum

            # Создаём запись в MOVEWHS
            safe_execute(db, """
                INSERT INTO MOVEWHS (MOVENO, MOVDATE, WHSNO, ARTNO, QTY, PRICE, SUM, PROVED, NOTE)
                VALUES (:m, CURRENT_DATE, 1, :a, :q, :p, :s, 1, :n)
            """, {
                "m": moveno,
                "a": item["artno"],
                "q": item["qty"],
                "p": item["price"],
                "s": item_sum,
                "n": f"Закрытие дня {date}: {item['name']}"
            })

            log.info(f"  ✅ {item['name']}: {item['qty']} шт × {item['price']} ₽")

        # 6. Формируем NOTE для накладной
        note_parts = [f"Закрытие дня {date}:"]
        for item in items:
            note_parts.append(f"{item['name']} ({item['qty']} шт)")
        note = " | ".join(note_parts)

        # Обновляем NOTE в MOVEWHS (первая запись)
        safe_execute(db, """
            UPDATE MOVEWHS SET NOTE = :n WHERE MOVENO = :m AND ORDNO = 0
        """, {"n": note, "m": moveno})

        db.commit()

        result = {
            "success": True,
            "message": f"Накладная №{naklno} (MOVENO={moveno}) создана",
            "date": date,
            "moveno": moveno,
            "naklno": naklno,
            "items_count": len(items),
            "total_sum": round(total_sum, 2),
            "items": items,
        }

        log.info(f"✅ День закрыт: {len(items)} товаров, сумма {total_sum} ₽")
        return result

    except Exception as e:
        db.rollback()
        log.error(f"❌ Close day error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.get("/close-day-preview")
def close_day_preview(
    date: str = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(get_db)
):
    """
    Предварительный просмотр: что будет списано при закрытии дня.
    """
    try:
        query = """
            SELECT
                o.ARTNO,
                a.NAME as product_name,
                SUM(o.QTY) as total_qty,
                AVG(o.PRICE) as avg_price,
                COUNT(DISTINCT i.INVNO) as invoice_count
            FROM ORDSPEC o
            LEFT JOIN ARTIKLS a ON o.ARTNO = a.ARTNO
            LEFT JOIN INVOICES i ON o.INVNO = i.INVNO
            WHERE CAST(i.INVDATE AS DATE) = CAST(:date AS DATE)
            GROUP BY o.ARTNO, a.NAME
            ORDER BY o.ARTNO
        """
        rows = safe_execute(db, query, {"date": date}, fetch_all=True)

        items = []
        total_sum = 0
        for row in rows:
            artno = row[0]
            name = decode_fb(row[1]) or f"Товар #{artno}"
            total_qty = float(row[2])
            avg_price = float(row[3]) if row[3] else 0
            invoice_count = int(row[4])
            item_sum = total_qty * avg_price
            total_sum += item_sum

            items.append({
                "artno": artno,
                "name": name,
                "qty": total_qty,
                "price": avg_price,
                "sum": round(item_sum, 2),
                "invoice_count": invoice_count,
            })

        return {
            "success": True,
            "date": date,
            "items": items,
            "items_count": len(items),
            "total_sum": round(total_sum, 2),
            "message": f"Готово к списанию: {len(items)} товаров на {total_sum} ₽"
        }

    except Exception as e:
        log.error(f"Close day preview error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}
