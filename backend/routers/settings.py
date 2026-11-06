"""
Настройки
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from database import get_db
import json
import os
import logging

router = APIRouter(prefix="/api", tags=["settings"])
log = logging.getLogger("zamoika")

SETTINGS_FILE = "/var/www/asterisk-gui/zamoika/product_settings.json"


@router.get("/settings/products/site-flags")
def get_product_site_flags():
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {"hidden_products": []}
    except Exception as e:
        return {"hidden_products": [], "error": str(e)}


@router.post("/settings/products/toggle-site")
def toggle_product_site(data: dict):
    try:
        artno = int(data.get('artno'))
        is_hidden = bool(data.get('hidden'))

        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                settings_data = json.load(f)
        else:
            settings_data = {"hidden_products": []}

        hidden = set(settings_data.get("hidden_products", []))
        if is_hidden:
            hidden.add(artno)
        else:
            hidden.discard(artno)
        settings_data["hidden_products"] = list(hidden)

        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(settings_data, f, ensure_ascii=False, indent=2)

        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}
