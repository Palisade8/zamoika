"""
Складской учёт
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
import logging

router = APIRouter(prefix="/api", tags=["warehouse"])
log = logging.getLogger("zamoika")


@router.get("/stock")
def get_stock(db: Session = Depends(get_db)):
    """Просмотр остатков товаров на складе"""
    return {"success": True, "message": "Stock endpoint placeholder"}


@router.post("/stock/write-off")
def write_off_stock(data: dict, db: Session = Depends(get_db)):
    """Списание товаров со склада"""
    return {"success": True, "message": "Write-off endpoint placeholder"}
