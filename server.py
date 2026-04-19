import datetime as dt
import json
import os
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_CANDIDATES = [
    r"C:\Users\smclb\OneDrive\Desktop\cam_sevkiyat_stok_pro.db",
    os.path.join(os.path.dirname(BASE_DIR), "cam_sevkiyat_stok_pro.db"),
]
HOST = "0.0.0.0"
PORT = 8765
STAGE_MAP = {"Basim": "Basım"}

def normalize_stage(value):
    text = str(value or "").strip()
    return STAGE_MAP.get(text, text)

def resolve_db_path():
    for path in DB_CANDIDATES:
        if os.path.exists(path):
            return path
    return DB_CANDIDATES[0]

DB_PATH = resolve_db_path()

def db_connection():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con

def table_columns(con, table_name):
    try:
        rows = con.execute(f"PRAGMA table_info({table_name})").fetchall()
        return {str(row[1]) for row in rows}
    except Exception:
        return set()

def find_glass_type(con, tracking_row):
    source_id = int(tracking_row["source_id"] or 0)
    item_type = str(tracking_row["item_type"] or "").strip().lower()

    checks = []

    if item_type == "order":
        checks.extend([
            ("orders_lines", ["glass_type", "cam_turu", "name"], "order_id"),
            ("order_lines", ["glass_type", "cam_turu", "name"], "order_id"),
        ])

    checks.extend([
        ("production_tracking", ["glass_type", "cam_turu"], "id"),
        ("orders_lines", ["glass_type", "cam_turu", "name"], "id"),
        ("order_lines", ["glass_type", "cam_turu", "name"], "id"),
        ("quote_lines", ["glass_type", "cam_turu", "name"], "id"),
        ("shipment_lines", ["glass_type", "cam_turu", "name"], "id"),
    ])

    for table_name, candidate_columns, fk_name in checks:
        columns = table_columns(con, table_name)
        if not columns or fk_name not in columns:
            continue
        existing_candidates = [col for col in candidate_columns if col in columns]
        if not existing_candidates:
            continue
        for col in existing_candidates:
            try:
                row = con.execute(
                    f"SELECT {col} AS glass_type FROM {table_name} WHERE {fk_name} = ? AND TRIM(COALESCE({col}, '')) <> '' LIMIT 1",
                    (source_id if fk_name != "id" else (int(tracking_row["id"]) if table_name == "production_tracking" else source_id),),
                ).fetchone()
                if row and row["glass_type"]:
                    return str(row["glass_type"]).strip()
            except Exception:
                continue

    return ""

def stage_jobs(stage, search_text=""):
    stage = normalize_stage(stage)
    query = """
        SELECT id, item_type, source_id, source_no, customer, project, total_qty, total_m2, stage, status
        FROM production_tracking
        WHERE status = 'in_progress' AND stage = ?
    """
    params = [stage]
    search_text = (search_text or "").strip()
    if search_text:
        query += " AND (source_no LIKE ? OR customer LIKE ? OR project LIKE ?)"
        like = f"%{search_text}%"
        params.extend([like, like, like])
    query += " ORDER BY updated_at DESC, id DESC"

    jobs = []
    with db_connection() as con:
        rows = con.execute(query, params).fetchall()
        for row in rows:
            glass_type = find_glass_type(con, row)
            jobs.append(
                {
                    "id": int(row["id"]),
                    "orderNo": row["source_no"],
                    "customer": row["customer"],
                    "project": row["project"],
                    "qty": int(row["total_qty"] or 0),
                    "m2": float(row["total_m2"] or 0),
                    "stage": row["stage"],
                    "glassType": glass_type,
                }
            )
    return jobs

def log_stage_completion(con, row):
    now = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    con.execute(
        """
        INSERT OR REPLACE INTO production_stage_history(
            tracking_id, item_type, source_id, source_no, customer, project, stage, total_qty, total_m2, event_at, created_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            int(row["id"]),
            row["item_type"],
            int(row["source_id"]),
            row["source_no"],
            row["customer"],
            row["project"],
            row["stage"],
            int(row["total_qty"] or 0),
            float(row["total_m2"] or 0),
            now,
            now,
        ),
    )

def complete_jobs(ids, stage):
    completed = 0
    stage = normalize_stage(stage)
    with db_connection() as con:
        for tracking_id in ids:
            row = con.execute("SELECT * FROM production_tracking WHERE id = ?", (int(tracking_id),)).fetchone()
            if not row or normalize_stage(row["stage"]) != stage or row["status"] != "in_progress":
                continue
            route_steps = [normalize_stage(item) for item in str(row["route_steps"] or "").split(",") if item]
            current_index = int(row["current_step_index"] or 0)
            log_stage_completion(con, row)
            now = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            if current_index + 1 < len(route_steps):
                next_stage = route_steps[current_index + 1]
                con.execute(
                    """
                    UPDATE production_tracking
                    SET stage = ?, current_step_index = ?, status = 'in_progress', updated_at = ?
                    WHERE id = ?
                    """,
                    (next_stage, current_index + 1, now, int(tracking_id)),
                )
            else:
                con.execute(
                    """
                    UPDATE production_tracking
                    SET status = 'completed', updated_at = ?
                    WHERE id = ?
                    """,
                    (now, int(tracking_id)),
                )
            completed += 1
        con.commit()
    return completed

class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return

    def do_OPTIONS(self):
        self._send(200, {"ok": True})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            return self._send(200, {"ok": True, "db_path": DB_PATH})
        if parsed.path == "/api/stations/jobs":
            params = parse_qs(parsed.query)
            stage = (params.get("stage", ["Kesim"])[0] or "Kesim").strip()
            search_text = params.get("q", [""])[0]
            return self._send(200, {"ok": True, "jobs": stage_jobs(stage, search_text)})
        return self._send(404, {"ok": False, "error": "Bulunamadi"})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/stations/finish":
            return self._send(404, {"ok": False, "error": "Bulunamadi"})
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            payload = {}
        ids = payload.get("ids") or []
        stage = str(payload.get("stage") or "Kesim").strip()
        count = complete_jobs(ids, stage)
        return self._send(200, {"ok": True, "completed": count})

def main():
    print(f"AFTEM Mobil Istasyon sunucusu basladi: http://127.0.0.1:{PORT}")
    print(f"Ag icinden baglanti icin bu bilgisayarin IP adresini kullanin. Veritabani: {DB_PATH}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()

if __name__ == "__main__":
    main()
