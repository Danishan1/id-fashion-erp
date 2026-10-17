"""
In-house system <-> Fashion ERP CRM bridge, in Python with the standard library only.
Guide: docs/crm/integrations/07-OTHER-SYSTEMS.md

Use it as a template when your own application (a customer portal, a mobile app,
a call-centre tool, another gateway) is the "provider" for a CRM channel of type Other.

    python3 inhouse_bridge.py

Environment:
    PORT                 default 8085
    CRM_WEBHOOK_URL      CRM Settings -> Channels -> (your channel) webhook URL
    CRM_SIGNING_SECRET   that channel's signing secret
    INHOUSE_SEND_URL     your system's "send a message to a customer" API (POST JSON)
    INHOUSE_API_KEY      sent to INHOUSE_SEND_URL as a Bearer token
    INHOUSE_INBOUND_KEY  shared key your system sends to /inbound (X-Api-Key header)

Routes:
    POST /inbound       your system -> CRM   {"id", "customerId", "name"?, "email"?, "phone"?, "text", "conversationRef"?}
    POST /status        your system -> CRM   {"messageId", "status": "sent|delivered|read|failed", "error"?}
    POST /crm/outbound  CRM -> your system   (signed by the CRM; replies from the Inbox)
"""

import hashlib
import hmac
import json
import os
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8085"))
CRM_URL = os.environ["CRM_WEBHOOK_URL"]
SECRET = os.environ["CRM_SIGNING_SECRET"].encode()
SEND_URL = os.environ.get("INHOUSE_SEND_URL", "")
API_KEY = os.environ.get("INHOUSE_API_KEY", "")
INBOUND_KEY = os.environ.get("INHOUSE_INBOUND_KEY", "")
TOLERANCE = 300  # seconds, same as the CRM


# -- Signing (identical to the CRM's rule) -------------------------------------------------

def sign(ts: str, raw: bytes) -> str:
    return "sha256=" + hmac.new(SECRET, ts.encode() + b"." + raw, hashlib.sha256).hexdigest()


def verify_crm(headers, raw: bytes):
    ts = headers.get("X-CRM-Timestamp", "")
    sig = headers.get("X-CRM-Signature", "")
    if not ts.isdigit() or abs(time.time() - int(ts)) > TOLERANCE:
        return "stale or missing timestamp"
    if not hmac.compare_digest(sign(ts, raw), sig):
        return "bad signature"
    return None


# -- Sending to the CRM, with retries ---------------------------------------------------------

def send_to_crm(events, attempts=5):
    raw = json.dumps({"events": events}, separators=(",", ":")).encode()
    for attempt in range(1, attempts + 1):
        ts = str(int(time.time()))  # sign at send time, every attempt
        req = urllib.request.Request(CRM_URL, data=raw, method="POST", headers={
            "Content-Type": "application/json", "X-CRM-Timestamp": ts, "X-CRM-Signature": sign(ts, raw)})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())["data"]
        except urllib.error.HTTPError as e:
            if e.code != 429 and e.code < 500:
                # 400 / 401 / 404 / 413: retrying won't help - fix the request.
                raise RuntimeError(f"CRM rejected the request: {e.code} {e.read()[:300]!r}")
            wait = int(e.headers.get("Retry-After") or 2 ** attempt)
        except (urllib.error.URLError, TimeoutError):
            wait = 2 ** attempt
        if attempt == attempts:
            raise RuntimeError("CRM unreachable - queue the events and try again later")
        time.sleep(min(wait, 60))


# -- Delivering CRM replies to your system ----------------------------------------------------

_done = {}  # idempotency key -> answer (use your database / Redis in production)
_lock = threading.Lock()


class ProviderError(Exception):
    def __init__(self, http_status, reason):
        super().__init__(reason)
        self.http_status = http_status


def deliver(p):
    """Send one CRM reply through your own system. Return your system's message id."""
    if not SEND_URL:
        raise ProviderError(422, "INHOUSE_SEND_URL is not configured")
    body = json.dumps({
        "customerId": p["to"]["value"],             # the from.id you sent for this customer
        "conversationRef": p.get("threadId"),
        "text": p.get("text") or "",
        "attachments": p.get("attachments") or [],  # [{fileName, mimeType, contentBase64}]
        "crmMessageId": p["id"],
    }).encode()
    req = urllib.request.Request(SEND_URL, data=body, method="POST", headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"})
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            return {"messageId": json.loads(r.read())["messageId"], "status": "sent"}
    except urllib.error.HTTPError as e:
        # Your system's 4xx = permanent (CRM shows Failed); 429 / 5xx = temporary.
        raise ProviderError(502 if e.code == 429 or e.code >= 500 else 422, f"in-house system answered {e.code}")
    except (urllib.error.URLError, TimeoutError) as e:
        raise ProviderError(502, f"in-house system unreachable: {e}")


# -- HTTP server -------------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def _json(self, status, obj):
        raw = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            if self.path == "/crm/outbound":
                return self.outbound(raw)
            if self.path in ("/inbound", "/status"):
                if not INBOUND_KEY or not hmac.compare_digest(self.headers.get("X-Api-Key", ""), INBOUND_KEY):
                    return self._json(401, {"error": "bad api key"})
                return self.inbound(json.loads(raw)) if self.path == "/inbound" else self.status(json.loads(raw))
            self._json(404, {"error": "not found"})
        except (ValueError, KeyError) as e:
            self._json(400, {"error": f"bad request: {e}"})
        except RuntimeError as e:
            self._json(502, {"error": str(e)})

    def inbound(self, m):
        frm = {"id": str(m["customerId"])}
        for k in ("name", "email", "phone"):
            if m.get(k):
                frm[k] = m[k]
        event = {"type": "message", "id": str(m["id"]), "from": frm, "text": m["text"]}
        if m.get("conversationRef"):
            event["threadId"] = str(m["conversationRef"])
        data = send_to_crm([event])
        self._json(200, {"ok": True, "result": data["results"][0]})

    def status(self, s):
        event = {"type": "status", "messageId": s["messageId"], "status": s["status"]}
        if s.get("error"):
            event["error"] = s["error"]
        data = send_to_crm([event])
        self._json(200, {"ok": True, "result": data["results"][0]})

    def outbound(self, raw):
        problem = verify_crm(self.headers, raw)
        if problem:
            return self._json(401, {"error": problem})
        p = json.loads(raw)
        key = self.headers.get("X-CRM-Idempotency-Key") or p["id"]
        with _lock:
            if key in _done:  # the CRM retried a send we already made: same answer, no second message
                return self._json(200, _done[key])
        try:
            answer = deliver(p)
        except ProviderError as e:
            print(f"[outbound {key}] {e}")
            return self._json(e.http_status, {"error": str(e)})
        with _lock:
            _done[key] = answer
        self._json(200, answer)

    def log_message(self, fmt, *args):  # keep logs short; never log secrets or bodies
        print(f"{self.command} {self.path} -> {args[1] if len(args) > 1 else ''}")


if __name__ == "__main__":
    print(f"in-house bridge listening on :{PORT}")
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
