"""
Расписание и просмотр слотов
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from database import get_db
from utils import decode_fb, safe_execute
from datetime import datetime
import logging

router = APIRouter(prefix="/api", tags=["schedule"])
log = logging.getLogger("zamoika")


@router.get("/slots")
def get_time_slots(
    date: str = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(get_db)
):
    """Получение занятых слотов на дату"""
    try:
        query = """
            SELECT
                z.S_NO,
                z.INVNO,
                z.S_START,
                z.S_FINISH,
                z.S_STATE,
                i.CLNUM,
                i.INVSTATE,
                i.AMOUNT,
                COALESCE(c.CLNAME, i.CONTACTNAME, 'Клиент') as client_name,
                COALESCE(c.CLPHONEMOB, c.CLPHONE, '') as client_phone,
                i.CONTNO as car_number,
                z.EMPNO
            FROM ZMRSCHDL z
            LEFT JOIN INVOICES i ON z.INVNO = i.INVNO
            LEFT JOIN CLIENTS c ON i.CLNUM = c.CLNUM
            WHERE CAST(z.S_START AS DATE) = :date
            ORDER BY z.S_START
        """
        rows = safe_execute(db, query, {"date": date}, fetch_all=True)

        slots = []
        for row in rows:
            slots.append({
                "s_no": row[0],
                "invno": row[1],
                "start": row[2],
                "finish": row[3],
                "state": int(row[4]) if row[4] is not None else 0,
                "clnum": row[5],
                "inv_state": int(row[6]) if row[6] is not None else 0,
                "amount": float(row[7]) if row[7] else 0,
                "client_name": decode_fb(row[8]) or "",
                "client_phone": decode_fb(row[9]) or "",
                "car_number": decode_fb(row[10]) or "",
                "empno": row[11],
            })

        return {"success": True, "date": date, "slots": slots}

    except Exception as e:
        log.error(f"Get slots error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.get("/schedule-detail")
def get_schedule_detail(
    invno: int = Query(..., description="Номер счета"),
    db: Session = Depends(get_db)
):
    """Получение деталей записи по INVNO"""
    try:
        query = """
            SELECT
                z.S_NO,
                z.INVNO,
                z.S_START,
                z.S_FINISH,
                z.S_STATE,
                z.NOTE,
                z.EMPNO,
                i.CLNUM,
                i.AMOUNT,
                i.DOPDISCOUNT,
                i.PAID,
                i.INVSTATE,
                i.EMPLOYNO,
                i.CONTNO,
                c.CLNAME,
                c.CLPHONEMOB,
                c.CLPHONE,
                a.NAME as service_name,
                o.PRICE as service_price
            FROM ZMRSCHDL z
            LEFT JOIN INVOICES i ON z.INVNO = i.INVNO
            LEFT JOIN CLIENTS c ON i.CLNUM = c.CLNUM
            LEFT JOIN ORDSPEC o ON i.INVNO = o.INVNO
            LEFT JOIN ARTIKLS a ON o.ARTNO = a.ARTNO
            WHERE z.INVNO = :invno
        """
        row = safe_execute(db, query, {"invno": invno}, fetch_one=True)

        if not row:
            return {"success": False, "error": "Запись не найдена"}

        result = {
            "s_no": row[0],
            "invno": row[1],
            "start": row[2],
            "finish": row[3],
            "state": int(row[4]) if row[4] is not None else 0,
            "note": decode_fb(row[5]) or "",
            "empno": row[6],
            "clnum": row[7],
            "amount": float(row[8]) if row[8] else 0,
            "discount": float(row[9]) if row[9] else 0,
            "paid": int(row[10]) if row[10] is not None else 0,
            "inv_state": int(row[11]) if row[11] is not None else 0,
            "employno": row[12],
            "car_number": decode_fb(row[13]) or "",
            "client_name": decode_fb(row[14]) or "",
            "client_phone_mobile": decode_fb(row[15]) or "",
            "client_phone": decode_fb(row[16]) or "",
            "services": [],
        }

        # Получаем все услуги
        services_query = """
            SELECT a.NAME, o.PRICE, o.QTY
            FROM ORDSPEC o
            LEFT JOIN ARTIKLS a ON o.ARTNO = a.ARTNO
            WHERE o.INVNO = :invno
        """
        services = safe_execute(db, services_query, {"invno": invno}, fetch_all=True)
        if services:
            for s in services:
                result["services"].append({
                    "name": decode_fb(s[0]) or "",
                    "price": float(s[1]) if s[1] else 0,
                    "qty": float(s[2]) if s[2] else 1,
                })

        return {"success": True, "detail": result}

    except Exception as e:
        log.error(f"Schedule detail error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}
