"""
Скидки
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
import logging

router = APIRouter(prefix="/api", tags=["discount"])
log = logging.getLogger("zamoika")


@router.get("/discounts")
def get_discounts(db: Session = Depends(get_db)):
    """Просмотр скидок"""
    return {"success": True, "message": "Discounts endpoint placeholder"}
