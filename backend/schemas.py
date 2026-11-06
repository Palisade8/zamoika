"""
Pydantic схемы для валидации данных
"""
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime


class BookingCreate(BaseModel):
    client_name: str
    client_phone: str
    client_type: int = 0
    chat_id: Optional[str] = None
    urlts: Optional[str] = None
    date: str  # YYYY-MM-DD
    time: str  # HH:MM
    duration: int = 30
    services: List[int]  # список ARTNO
    discount: float = 0
    note: Optional[str] = None


class UpdateStatus(BaseModel):
    invno: int
    status: str  # "Запланирован", "Согласован", "Выполнен", "Отменен"
    empno: Optional[int] = None


class UpdatePayment(BaseModel):
    invno: int
    paid: bool


class ProductInvoiceCreate(BaseModel):
    items: List[Dict[str, Any]]
    note: Optional[str] = None
    discount: float = 0
    is_paid: bool = True
    is_arendych: bool = False
    client_name: Optional[str] = None
    client_phone: Optional[str] = None
