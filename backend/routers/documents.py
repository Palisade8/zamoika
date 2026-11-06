"""
Документы: счёт и акт PDF
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from database import get_db
from utils import decode_fb, safe_execute
import io
import logging

router = APIRouter(prefix="/api", tags=["documents"])
log = logging.getLogger("zamoika")


@router.get("/documents/invoice")
def get_invoice_pdf(
    invno: int = Query(..., description="Номер счета"),
    db: Session = Depends(get_db)
):
    """Генерация PDF-счёта на оплату"""
    try:
        # TODO: реализовать генерацию PDF через reportlab
        # Аналогично invoices-report-pdf
        return {"success": True, "message": "PDF invoice generation not implemented yet"}

    except Exception as e:
        log.error(f"Invoice PDF error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.get("/documents/act")
def get_act_pdf(
    invno: int = Query(..., description="Номер счета"),
    db: Session = Depends(get_db)
):
    """Генерация PDF-акта выполненных работ"""
    try:
        # TODO: реализовать генерацию PDF акта
        return {"success": True, "message": "PDF act generation not implemented yet"}

    except Exception as e:
        log.error(f"Act PDF error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}
