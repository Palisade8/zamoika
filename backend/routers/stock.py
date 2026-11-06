"""
Складской учёт (альтернативный)
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
import logging

router = APIRouter(prefix="/api", tags=["stock"])
log = logging.getLogger("zamoika")


@router.get("/stock")
def get_stock(db: Session = Depends(get_db)):
    """Просмотр товаров"""
    return {"success": True, "message": "Stock endpoint placeholder"}
