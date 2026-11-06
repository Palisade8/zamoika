"""
Asterisk интеграция
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
import logging

router = APIRouter(prefix="/api", tags=["asterisk"])
log = logging.getLogger("zamoika")


@router.get("/asterisk/status")
def asterisk_status(db: Session = Depends(get_db)):
    """Статус интеграции с Asterisk"""
    return {"success": True, "message": "Asterisk endpoint placeholder"}
