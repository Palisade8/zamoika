#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скрипт для вывода всех полей счета 17902 и связанных таблиц
"""

import fdb
from datetime import datetime

# Настройки подключения
DB_CONFIG = {
    'host': '192.168.38.8',
    'database': 'C:/SO8/AVTOM.FDB',
    'user': 'SYSDBA',
    'password': 'masterkey',
    'charset': 'WIN1251'
}

def decode_fb(text):
    """Декодирование текста из Firebird (WIN1251)"""
    if text is None:
        return ''
    if isinstance(text, bytes):
        try:
            return text.decode('cp1251', errors='ignore')
        except:
            return str(text)
    return str(text)

def print_separator(char='═', length=100):
    print(char * length)

def print_section(title):
    print_separator()
    print(f"📋 {title}")
    print_separator('─')

def print_field(name, value, max_len=50):
    """Красивый вывод поля"""
    if value is None:
        value_str = '<NULL>'
    elif isinstance(value, datetime):
        value_str = value.strftime('%Y-%m-%d %H:%M:%S') if value else '<NULL>'
    else:
        value_str = str(value)
    
    # Если строка длинная, обрезаем
    if len(value_str) > max_len:
        value_str = value_str[:max_len] + '...'
    
    print(f"  {name:<20} : {value_str}")

def print_table_data(title, headers, data):
    """Вывод данных в виде таблицы"""
    if not data:
        print(f"  📭 Нет данных в {title}")
        return
    
    print(f"\n  📊 {title}:")
    print("  " + "-" * 80)
    
    # Заголовки
    header_line = "  "
    for h in headers:
        header_line += f"{h:<20} "
    print(header_line)
    print("  " + "-" * 80)
    
    # Данные
    for row in data:
        line = "  "
        for i, val in enumerate(row):
            if val is None:
                val_str = '<NULL>'
            elif isinstance(val, datetime):
                val_str = val.strftime('%Y-%m-%d %H:%M')
            else:
                val_str = str(val)
            if len(val_str) > 18:
                val_str = val_str[:18] + '...'
            line += f"{val_str:<20} "
        print(line)
    
    print("  " + "-" * 80)

def main():
    try:
        conn = fdb.connect(**DB_CONFIG)
        cursor = conn.cursor()
        
        print_separator()
        print("🔍 ПОЛНЫЙ ВЫВОД СЧЕТА 17902")
        print_separator()
        print(f"📅 Дата вывода: {datetime.now().strftime('%d.%m.%Y %H:%M:%S')}")
        print_separator('─')
        
        # ==========================================
        # 1. ИНФОРМАЦИЯ О СЧЕТЕ (INVOICES)
        # ==========================================
        print_section("1. ИНФОРМАЦИЯ О СЧЕТЕ (INVOICES)")
        
        query_invoice = """
            SELECT * FROM INVOICES WHERE INVN = 17902
        """
        cursor.execute(query_invoice)
        columns = [desc[0] for desc in cursor.description]
        row = cursor.fetchone()
        
        if row:
            print(f"\n  📌 Счет №17902 найден!")
            print_separator('─')
            for i, col in enumerate(columns):
                print_field(col, row[i])
        else:
            print("  ❌ Счет 17902 не найден!")
            return
        
        # ==========================================
        # 2. ИНФОРМАЦИЯ О КЛИЕНТЕ (CLIENTS)
        # ==========================================
        print_separator('─')
        print_section("2. ИНФОРМАЦИЯ О КЛИЕНТЕ (CLIENTS)")
        
        query_client = """
            SELECT * FROM CLIENTS 
            WHERE CLNUM = (SELECT CLNUM FROM INVOICES WHERE INVN = 17902)
        """
        cursor.execute(query_client)
        columns_client = [desc[0] for desc in cursor.description]
        row_client = cursor.fetchone()
        
        if row_client:
            for i, col in enumerate(columns_client):
                print_field(col, row_client[i])
        else:
            print("  ❌ Клиент не найден!")
        
        # ==========================================
        # 3. УСЛУГИ В СЧЕТЕ (ORDSPEC)
        # ==========================================
        print_separator('─')
        print_section("3. УСЛУГИ В СЧЕТЕ (ORDSPEC)")
        
        query_ordspec = """
            SELECT 
                o.ORDNO,
                o.ARTNO,
                a.NAME as SERVICE_NAME,
                o.QTY,
                o.PRICE,
                o.DOP,
                o.CLRNO
            FROM ORDSPEC o
            LEFT JOIN ARTIKLS a ON o.ARTNO = a.ARTNO
            WHERE o.INVNO = 17902
            ORDER BY o.ORDNO
        """
        cursor.execute(query_ordspec)
        rows = cursor.fetchall()
        
        if rows:
            total = 0
            print(f"\n  📦 Найдено {len(rows)} услуг:")
            print_separator('─')
            for row in rows:
                artno = row[1] if row[1] else 0
                name = decode_fb(row[2]) if row[2] else 'Без названия'
                qty = float(row[3]) if row[3] else 1
                price = float(row[4]) if row[4] else 0
                total += price * qty
                print(f"  {artno:>6} | {name:<45} | {qty:>5} x {price:>8.2f} = {price*qty:>10.2f} руб")
            print_separator('─')
            print(f"  {'Итого:':<60} {total:>10.2f} руб")
        else:
            print("  📭 Нет услуг в счете")
        
        # ==========================================
        # 4. РАСПИСАНИЕ (ZMRSCHDL)
        # ==========================================
        print_separator('─')
        print_section("4. РАСПИСАНИЕ (ZMRSCHDL)")
        
        query_schedule = """
            SELECT * FROM ZMRSCHDL WHERE INVNO = 17902
        """
        cursor.execute(query_schedule)
        columns_sched = [desc[0] for desc in cursor.description]
        row_sched = cursor.fetchone()
        
        if row_sched:
            for i, col in enumerate(columns_sched):
                print_field(col, row_sched[i])
        else:
            print("  📭 Нет расписания для счета")
        
        # ==========================================
        # 5. ИНФОРМАЦИЯ О МЕНЕДЖЕРЕ (EMPLOYER)
        # ==========================================
        print_separator('─')
        print_section("5. ИНФОРМАЦИЯ О МЕНЕДЖЕРЕ (EMPLOYER)")
        
        query_employer = """
            SELECT EMPNO, EMPLOYNAME, POST, EMAIL
            FROM EMPLOYER 
            WHERE EMPNO = (SELECT EMPLOYNO FROM INVOICES WHERE INVN = 17902)
        """
        cursor.execute(query_employer)
        row_emp = cursor.fetchone()
        
        if row_emp:
            print_field("EMPNO", row_emp[0])
            print_field("EMPLOYNAME", decode_fb(row_emp[1]))
            print_field("POST", decode_fb(row_emp[2]) if row_emp[2] else '<NULL>')
            print_field("EMAIL", decode_fb(row_emp[3]) if row_emp[3] else '<NULL>')
        else:
            print("  📭 Менеджер не найден")
        
        # ==========================================
        # 6. ПОИСК НОМЕРА АВТОМОБИЛЯ
        # ==========================================
        print_separator('─')
        print_section("6. ПОИСК НОМЕРА АВТОМОБИЛЯ")
        
        # Проверяем все поля, где может быть номер
        fields_to_check = {
            'CONTACTNAME': decode_fb(row[columns.index('CONTACTNAME')]) if 'CONTACTNAME' in columns else '',
            'NOTE': decode_fb(row[columns.index('NOTE')]) if 'NOTE' in columns else '',
            'OBJNAME': decode_fb(row[columns.index('OBJNAME')]) if 'OBJNAME' in columns else '',
            'REKL': decode_fb(row[columns.index('REKL')]) if 'REKL' in columns else '',
            'DOSTADDR': decode_fb(row[columns.index('DOSTADDR')]) if 'DOSTADDR' in columns else '',
        }
        
        if row_client:
            fields_to_check['CLNAME'] = decode_fb(row_client[columns_client.index('CLNAME')]) if 'CLNAME' in columns_client else ''
            fields_to_check['CLNOTE'] = decode_fb(row_client[columns_client.index('CLNOTE')]) if 'CLNOTE' in columns_client else ''
        
        found = False
        print("\n  🔍 Поиск номера '715' во всех полях:")
        for field_name, value in fields_to_check.items():
            if value and ('715' in value or 'М715' in value):
                print(f"    ✅ {field_name}: '{value}'")
                found = True
        
        if not found:
            print("    ❌ Номер '715' не найден ни в одном поле")
            print("\n  💡 Возможно, номер автомобиля хранится в другой таблице:")
            print("     - ORDWHS.NOTE")
            print("     - ZMRSCHDL.S_OPTIONS")
            print("     - CLIENTS.CLNAME (как часть имени)")
        
        # ==========================================
        # 7. ДОПОЛНИТЕЛЬНАЯ ИНФОРМАЦИЯ
        # ==========================================
        print_separator('─')
        print_section("7. ДОПОЛНИТЕЛЬНАЯ ИНФОРМАЦИЯ")
        
        # Проверяем заказы
        query_ordwhs = """
            SELECT ORDNO, ORDDATE, NOTE
            FROM ORDWHS 
            WHERE CLNUM = (SELECT CLNUM FROM INVOICES WHERE INVN = 17902)
            ORDER BY ORDDATE DESC
            FETCH FIRST 3 ROWS ONLY
        """
        cursor.execute(query_ordwhs)
        ord_rows = cursor.fetchall()
        
        if ord_rows:
            print("\n  📋 Последние заказы клиента:")
            for r in ord_rows:
                print(f"    - №{r[0]} | {r[1].strftime('%d.%m.%Y') if r[1] else '—'} | {decode_fb(r[2]) if r[2] else ''}")
        else:
            print("  📭 Нет заказов у клиента")
        
        print_separator('═')
        print("✅ Вывод завершен")
        print_separator('═')
        
        cursor.close()
        conn.close()
        
    except fdb.Error as e:
        print(f"❌ Ошибка базы данных: {e}")
    except Exception as e:
        print(f"❌ Ошибка: {e}")

if __name__ == "__main__":
    main()
