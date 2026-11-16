#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "0.0.0.0"
PORT = 8000
STATIC_DIR = Path(__file__).resolve().parent / "static"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
CACHE_TTL = 12
PERIODS = {
    "day": {"label": "日线", "scale": 240, "datalen": 120},
    "m15": {"label": "15分钟", "scale": 15, "datalen": 160},
    "m5": {"label": "5分钟", "scale": 5, "datalen": 160},
}

_cache: dict[str, tuple[float, object]] = {}
_cache_lock = threading.Lock()


def cache_get(key: str):
    with _cache_lock:
        item = _cache.get(key)
        if not item:
            return None
        ts, value = item
        if time.time() - ts > CACHE_TTL:
            return None
        return value


def cache_set(key: str, value) -> None:
    with _cache_lock:
        _cache[key] = (time.time(), value)


def http_get(url: str, encoding: str = "utf-8", extra_headers: dict | None = None) -> str:
    headers = {
        "User-Agent": UA,
        "Referer": "https://finance.sina.com.cn/",
        "Accept": "*/*",
    }
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=8) as resp:
        raw = resp.read()
    return raw.decode(encoding, errors="replace")


def to_symbol(raw: str) -> str:
    code = re.sub(r"[^0-9A-Za-z]", "", (raw or "")).lower()
    if not code:
        raise ValueError("股票代码不能为空")
    if code.startswith(("sh", "sz", "bj")) and len(code) >= 8:
        return code
    if len(code) > 6:
        code = code[-6:]
    if not re.fullmatch(r"\d{6}", code):
        raise ValueError(f"无效股票代码: {raw}")
    if code.startswith(("6", "9")):
        return "sh" + code
    if code.startswith(("0", "3")):
        return "sz" + code
    if code.startswith(("4", "8")):
        return "bj" + code
    return "sh" + code


def parse_jsonp_array(text: str):
    start = text.find("([")
    end = text.rfind("])")
    if start < 0 or end < 0:
        raise RuntimeError("K线数据解析失败")
    return json.loads(text[start + 1 : end + 1])


def fetch_sina_klines(symbol: str, scale: int, datalen: int) -> list[dict]:
    qs = urllib.parse.urlencode(
        {"symbol": symbol, "scale": scale, "ma": "no", "datalen": datalen}
    )
    url = f"https://quotes.sina.cn/cn/api/jsonp_v2.php/IO.X=/CN_MarketDataService.getKLineData?{qs}"
    payload = parse_jsonp_array(http_get(url))
    bars = []
    for row in payload:
        bars.append(
            {
                "time": row["day"],
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row.get("volume") or 0),
            }
        )
    return bars


def fetch_tencent_daily(symbol: str, count: int = 120) -> list[dict]:
    url = (
        "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
        f"?param={symbol},day,,,{count},qfq"
    )
    text = http_get(url, extra_headers={"Referer": "https://gu.qq.com/"})
    data = json.loads(text)
    block = (data.get("data") or {}).get(symbol) or {}
    rows = block.get("qfqday") or block.get("day") or []
    bars = []
    for row in rows:
        bars.append(
            {
                "time": row[0],
                "open": float(row[1]),
                "high": float(row[3]),
                "low": float(row[4]),
                "close": float(row[2]),
                "volume": float(row[5]) if len(row) > 5 else 0,
            }
        )
    return bars


def _num(value):
    try:
        if value in (None, "", "-"):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch_quote(symbol: str) -> dict:
    empty = {
        "symbol": symbol,
        "code": symbol[2:] if len(symbol) > 2 else symbol,
        "name": symbol,
        "price": None,
        "prev_close": None,
        "open": None,
        "high": None,
        "low": None,
        "change": None,
        "change_pct": None,
        "turnover": None,
        "time": None,
    }
    try:
        text = http_get(
            f"https://qt.gtimg.cn/q={symbol}",
            encoding="gbk",
            extra_headers={"Referer": "https://gu.qq.com/"},
        )
        m = re.search(r'"([^"]*)"', text)
        if not m:
            return empty
        parts = m.group(1).split("~")
        if len(parts) < 35:
            return empty
        price = _num(parts[3])
        prev = _num(parts[4])
        change = _num(parts[31]) if len(parts) > 31 else None
        change_pct = _num(parts[32]) if len(parts) > 32 else None
        if change is None and price is not None and prev:
            change = price - prev
        if change_pct is None and price is not None and prev:
            change_pct = (price - prev) / prev * 100.0
        return {
            "symbol": symbol,
            "code": parts[2] or symbol[2:],
            "name": parts[1] or symbol,
            "price": price,
            "prev_close": prev,
            "open": _num(parts[5]),
            "high": _num(parts[33]) if len(parts) > 33 else None,
            "low": _num(parts[34]) if len(parts) > 34 else None,
            "change": round(change, 2) if change is not None else None,
            "change_pct": round(change_pct, 2) if change_pct is not None else None,
            "turnover": _num(parts[38]) if len(parts) > 38 else None,
            "time": parts[30] if len(parts) > 30 else None,
        }
    except Exception:
        return empty


def search_stock(keyword: str) -> list[dict]:
    qs = urllib.parse.urlencode({"type": "11,12,13,14,15", "key": keyword})
    text = http_get(f"https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15&{qs}", encoding="gbk")
    m = re.search(r'"([^"]*)"', text)
    if not m or not m.group(1):
        return []
    items = []
    for chunk in m.group(1).split(";"):
        cols = chunk.split(",")
        if len(cols) < 5:
            continue
        items.append(
            {
                "symbol": cols[3],
                "code": cols[2],
                "name": cols[4],
            }
        )
    return items[:8]


def calc_kdj(bars: list[dict], n: int = 9) -> list[dict]:
    result = []
    k = 50.0
    d = 50.0
    for i, bar in enumerate(bars):
        start = max(0, i - n + 1)
        window = bars[start : i + 1]
        hn = max(x["high"] for x in window)
        ln = min(x["low"] for x in window)
        if hn == ln:
            rsv = 50.0
        else:
            rsv = (bar["close"] - ln) / (hn - ln) * 100.0
        k = (2.0 / 3.0) * k + (1.0 / 3.0) * rsv
        d = (2.0 / 3.0) * d + (1.0 / 3.0) * k
        j = 3.0 * k - 2.0 * d
        result.append(
            {
                "time": bar["time"],
                "close": round(bar["close"], 3),
                "k": round(k, 2),
                "d": round(d, 2),
                "j": round(j, 2),
            }
        )
    return result


def judge_signal(k: float, d: float, j: float) -> dict | None:
    if j > 98 and k > d:
        return {
            "type": "overbought",
            "title": "超买提醒",
            "message": f"J={j:.2f} > 98 且 K={k:.2f} > D={d:.2f}",
        }
    if j < 2 and k < d:
        return {
            "type": "oversold",
            "title": "超卖提醒",
            "message": f"J={j:.2f} < 2 且 K={k:.2f} < D={d:.2f}",
        }
    return None


def load_period(symbol: str, period: str) -> dict:
    meta = PERIODS[period]
    cache_key = f"{symbol}:{period}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    if period == "day":
        try:
            bars = fetch_tencent_daily(symbol)
        except Exception:
            bars = fetch_sina_klines(symbol, meta["scale"], meta["datalen"])
    else:
        bars = fetch_sina_klines(symbol, meta["scale"], meta["datalen"])
    kdj = calc_kdj(bars)
    latest = kdj[-1] if kdj else None
    signal = judge_signal(latest["k"], latest["d"], latest["j"]) if latest else None
    payload = {
        "period": period,
        "label": meta["label"],
        "count": len(kdj),
        "latest": latest,
        "signal": signal,
        "series": kdj[-60:],
    }
    cache_set(cache_key, payload)
    return payload


def monitor_one(code: str) -> dict:
    symbol = to_symbol(code)
    quote = fetch_quote(symbol)
    periods = {}
    errors = {}
    for key in ("day", "m15", "m5"):
        try:
            periods[key] = load_period(symbol, key)
        except Exception as exc:
            errors[key] = str(exc)
            periods[key] = {
                "period": key,
                "label": PERIODS[key]["label"],
                "count": 0,
                "latest": None,
                "signal": None,
                "series": [],
                "error": str(exc),
            }
    alerts = []
    for key, item in periods.items():
        if item.get("signal"):
            alerts.append(
                {
                    "period": key,
                    "label": item["label"],
                    **item["signal"],
                }
            )
    return {
        "symbol": symbol,
        "code": symbol[2:],
        "name": quote.get("name") or symbol,
        "quote": quote,
        "periods": periods,
        "alerts": alerts,
        "errors": errors,
        "updated_at": int(time.time() * 1000),
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, payload) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path in ("/", "/index.html"):
            file_path = STATIC_DIR / "index.html"
            self._send(200, file_path.read_bytes(), "text/html; charset=utf-8")
            return

        if path.startswith("/static/"):
            rel = path[len("/static/") :]
            file_path = (STATIC_DIR / rel).resolve()
            if not str(file_path).startswith(str(STATIC_DIR.resolve())) or not file_path.is_file():
                self._json(404, {"error": "not found"})
                return
            ctype = "application/octet-stream"
            if file_path.suffix == ".css":
                ctype = "text/css; charset=utf-8"
            elif file_path.suffix == ".js":
                ctype = "application/javascript; charset=utf-8"
            self._send(200, file_path.read_bytes(), ctype)
            return

        if path == "/api/health":
            self._json(200, {"ok": True})
            return

        if path == "/api/search":
            keyword = (qs.get("q") or [""])[0].strip()
            if not keyword:
                self._json(400, {"error": "请输入代码或名称"})
                return
            try:
                self._json(200, {"items": search_stock(keyword)})
            except Exception as exc:
                self._json(500, {"error": str(exc)})
            return

        if path == "/api/monitor":
            raw = (qs.get("codes") or ["688605"])[0]
            codes = [x.strip() for x in raw.split(",") if x.strip()]
            if not codes:
                codes = ["688605"]
            items = []
            for code in codes[:12]:
                try:
                    items.append(monitor_one(code))
                except Exception as exc:
                    items.append(
                        {
                            "symbol": code,
                            "code": code,
                            "name": code,
                            "quote": None,
                            "periods": {},
                            "alerts": [],
                            "errors": {"all": str(exc)},
                            "updated_at": int(time.time() * 1000),
                        }
                    )
            self._json(200, {"items": items, "server_time": int(time.time() * 1000)})
            return

        self._json(404, {"error": "not found"})


def main() -> None:
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"KDJ monitor running on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
