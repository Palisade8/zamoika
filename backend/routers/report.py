"""
Отчёты и генерация PDF
"""
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session
from database import get_db
from utils import decode_fb, safe_execute
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import io
import logging
from datetime import datetime
import os

router = APIRouter(prefix="/api", tags=["report"])
log = logging.getLogger("zamoika")

# Путь к шрифту с поддержкой кириллицы
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def register_font():
    """Регистрация шрифта с поддержкой кириллицы"""
    try:
        if os.path.exists(FONT_PATH):
            pdfmetrics.registerFont(TTFont('DejaVuSans', FONT_PATH))
            return True
    except:
        pass
    return False


@router.get("/invoices-report-pdf")
def get_invoices_report_pdf(
    date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    db: Session = Depends(get_db)
):
    """
    Генерация PDF-отчета по счетам за день
    """
    try:
        query = """
            SELECT
                i.INVN as invno,
                i.INVDATE,
                COALESCE(c.CLNAME, i.CONTACTNAME, 'Клиент') as client_name,
                COALESCE(c.CLPHONEMOB, c.CLPHONE, '') as client_phone,
                COALESCE(i.AMOUNT, 0) as total_price,
                COALESCE(i.DOPDISCOUNT, 0) as discount,
                COALESCE(e.EMPLOYNAME, '') as manager,
                CASE WHEN i.INVTYP = 1 THEN 1 ELSE 0 END as is_product,
                COALESCE(i.INVSTATE, 0) as status,
                COALESCE(o.ARTNO, 0) as artno,
                COALESCE(a.NAME, 'Товар #' || CAST(o.ARTNO AS VARCHAR(10))) as item_name,
                COALESCE(o.QTY, 1) as qty
            FROM INVOICES i
            LEFT JOIN CLIENTS c ON i.CLNUM = c.CLNUM
            LEFT JOIN EMPLOYER e ON i.EMPLOYNO = e.EMPNO
            LEFT JOIN ORDSPEC o ON i.INVNO = o.INVNO
            LEFT JOIN ARTIKLS a ON o.ARTNO = a.ARTNO
            WHERE CAST(i.INVDATE AS DATE) = :date
              AND o.ARTNO IS NOT NULL
            ORDER BY i.INVN, o.ORDNO
        """
        rows = safe_execute(db, query, {"date": date}, fetch_all=True)

        # Группируем по счетам
        invoices_dict = {}
        for row in rows:
            invno = row[0]
            if invno not in invoices_dict:
                invoices_dict[invno] = {
                    "invno": invno,
                    "client_name": decode_fb(row[2]) or "",
                    "client_phone": decode_fb(row[3]) or "",
                    "total_price": float(row[4]) if row[4] else 0,
                    "discount": float(row[5]) if row[5] else 0,
                    "manager": decode_fb(row[6]) or "",
                    "is_product": row[7] == 1,
                    "items": []
                }

            invoices_dict[invno]["items"].append({
                "name": decode_fb(row[10]) or "Без названия",
                "qty": float(row[11]) if row[11] else 1
            })

        invoices = list(invoices_dict.values())

        # Создаем PDF
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=landscape(A4),
            rightMargin=10*mm,
            leftMargin=10*mm,
            topMargin=15*mm,
            bottomMargin=10*mm
        )

        # Регистрируем шрифт
        font_registered = register_font()
        font_name = 'DejaVuSans' if font_registered else 'Helvetica'

        # Стили
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            'TitleStyle',
            parent=styles['Title'],
            fontName=font_name,
            fontSize=14,
            alignment=TA_CENTER,
            spaceAfter=10
        )
        header_style = ParagraphStyle(
            'HeaderStyle',
            parent=styles['Heading2'],
            fontName=font_name,
            fontSize=10,
            textColor=colors.white,
            alignment=TA_CENTER
        )
        normal_style = ParagraphStyle(
            'NormalStyle',
            parent=styles['Normal'],
            fontName=font_name,
            fontSize=8,
            alignment=TA_CENTER
        )
        right_style = ParagraphStyle(
            'RightStyle',
            parent=styles['Normal'],
            fontName=font_name,
            fontSize=8,
            alignment=TA_RIGHT
        )

        # Формируем данные для таблицы
        table_data = []

        # Заголовок
        table_data.append([
            Paragraph("№ счета", header_style),
            Paragraph("Клиент", header_style),
            Paragraph("Телефон", header_style),
            Paragraph("Товар/Услуга", header_style),
            Paragraph("Кол-во", header_style),
            Paragraph("Сумма", header_style),
            Paragraph("Скидка", header_style),
            Paragraph("Итого", header_style),
            Paragraph("Менеджер", header_style)
        ])

        # Данные
        total_sum = 0
        total_final = 0

        for inv in invoices:
            final_price = inv["total_price"] * (1 - inv["discount"] / 100)
            total_sum += inv["total_price"]
            total_final += final_price

            for idx, item in enumerate(inv["items"]):
                is_first = idx == 0
                item_price = inv["total_price"] if is_first else ""
                item_discount = f"{inv['discount']}%" if is_first else ""
                item_final = f"{final_price:.2f}" if is_first else ""

                table_data.append([
                    Paragraph(str(inv["invno"]) if is_first else "", normal_style),
                    Paragraph(inv["client_name"][:25] if is_first else "", normal_style),
                    Paragraph(inv["client_phone"][:15] if is_first else "", normal_style),
                    Paragraph(f"{'↳ ' if not is_first else ''}{item['name'][:40]}", normal_style),
                    Paragraph(str(int(item['qty'])), normal_style),
                    Paragraph(str(item_price) if is_first else "", right_style),
                    Paragraph(item_discount if is_first else "", normal_style),
                    Paragraph(str(item_final) if is_first else "", right_style),
                    Paragraph(inv["manager"][:20] if is_first else "", normal_style)
                ])

        # Итоговая строка
        table_data.append([
            Paragraph("", normal_style),
            Paragraph("", normal_style),
            Paragraph("", normal_style),
            Paragraph("ИТОГО:", normal_style),
            Paragraph("", normal_style),
            Paragraph(f"{total_sum:.2f}", right_style),
            Paragraph("", normal_style),
            Paragraph(f"{total_final:.2f}", right_style),
            Paragraph("", normal_style)
        ])

        # Создаем таблицу
        table = Table(table_data, colWidths=[30, 60, 50, 100, 25, 40, 30, 40, 50])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1a56db')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), font_name),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
            ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#f5f5f5')),
            ('FONTNAME', (0, -1), (-1, -1), font_name),
            ('FONTSIZE', (0, -1), (-1, -1), 9),
            ('FONTWEIGHT', (0, -1), (-1, -1), 'BOLD'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('BOX', (0, 0), (-1, -1), 1, colors.black),
        ]))

        # Собираем документ
        elements = []

        # Заголовок
        elements.append(Paragraph(f"📊 Отчет по счетам за {date}", title_style))
        elements.append(Spacer(1, 5))
        elements.append(Paragraph(f"Всего: {len(invoices)} счетов, {len(table_data)-2} позиций", normal_style))
        elements.append(Spacer(1, 10))
        elements.append(table)

        doc.build(elements)

        # Возвращаем PDF
        pdf_content = buffer.getvalue()
        buffer.close()

        return Response(
            content=pdf_content,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename=invoices_report_{date}.pdf"
            }
        )

    except Exception as e:
        log.error(f"Invoices PDF report error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}
