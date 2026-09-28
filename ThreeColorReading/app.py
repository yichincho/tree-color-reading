"""三色閱讀 本機網頁版。

只用 Python 標準函式庫：啟動後在 http://127.0.0.1:8765 開啟網頁，
網頁把文章一段一段送到這個本機伺服器，再由伺服器轉送到 Gemini／DeepSeek。
API Key 只隨每次請求傳入，伺服器不寫檔、不記錄。
"""

import argparse
import json
import mimetypes
import re
import socket
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = "0.1.0"
STATIC_DIR = Path(__file__).resolve().parent / "static"
REQUEST_TIMEOUT = 180
MAX_BODY_BYTES = 25 * 1024 * 1024
# Windows 的登錄檔有時會把 .js 設成 text/plain，所以自己指定
CONTENT_TYPES = {".html": "text/html", ".css": "text/css", ".js": "text/javascript"}

PROVIDERS = {
    "gemini": {
        "id": "gemini",
        "label": "Gemini",
        "base_url": "https://generativelanguage.googleapis.com",
        "model": "gemini-flash-latest",
    },
    "deepseek": {
        "id": "deepseek",
        "label": "DeepSeek V4.1-Flash",
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-flash",
    },
}


class ProviderError(Exception):
    """給使用者看的錯誤訊息（不含 API Key）。fatal 表示後面的段落也會失敗，應停止。"""

    def __init__(self, message, fatal=False):
        super().__init__(message)
        self.fatal = fatal


# ---------------------------------------------------------------------------
# Provider request / response（與 api-client.js 相同的格式）
# ---------------------------------------------------------------------------


def get_provider_config(provider):
    config = PROVIDERS.get(provider)
    if not config:
        raise ProviderError(f"不支援的 Provider：{provider}")
    return dict(config)


def parse_data_url(data_url, fallback_mime_type=None):
    if not isinstance(data_url, str) or not data_url.startswith("data:"):
        raise ProviderError("圖片必須是 data URL。")
    match = re.match(r"^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$", data_url, re.S)
    if not match:
        raise ProviderError("圖片資料格式無法辨識。")
    return {"mime_type": match.group(1) or fallback_mime_type or "image/jpeg", "data": match.group(2)}


def build_provider_request(provider, api_key, model, text, image=None, image_detail="auto"):
    if not api_key or not str(api_key).strip():
        raise ProviderError("請先輸入 API Key。")
    if not text or not str(text).strip():
        raise ProviderError("請先輸入文章或句子。")

    config = get_provider_config(provider)
    selected_model = model or config["model"]
    api_key = str(api_key).strip()
    image_data = None
    if image and image.get("dataUrl"):
        image_data = parse_data_url(image["dataUrl"], image.get("mimeType"))
        image_data["data_url"] = image["dataUrl"]

    if provider == "gemini":
        parts = [{"text": str(text)}]
        if image_data:
            parts.append({"inline_data": {"mime_type": image_data["mime_type"], "data": image_data["data"]}})
        return {
            "url": f"{config['base_url']}/v1beta/models/{urllib.parse.quote(selected_model, safe='')}:generateContent",
            "headers": {"Content-Type": "application/json", "x-goog-api-key": api_key},
            "body": {
                "contents": [{"role": "user", "parts": parts}],
                "generationConfig": {"responseMimeType": "application/json"},
            },
        }

    content = [{"type": "text", "text": str(text)}]
    if image_data:
        content.append({"type": "image_url", "image_url": {"url": image_data["data_url"], "detail": image_detail}})
    return {
        "url": f"{config['base_url']}/chat/completions",
        "headers": {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        "body": {
            "model": selected_model,
            "messages": [{"role": "user", "content": content}],
            "thinking": {"type": "disabled"},
            "response_format": {"type": "json_object"},
            "temperature": 0.2,
        },
    }


def extract_response_text(provider, payload):
    payload = payload or {}
    if provider == "gemini":
        candidates = payload.get("candidates") or [{}]
        parts = (candidates[0].get("content") or {}).get("parts") or []
        return "".join(part.get("text", "") for part in parts).strip()
    if provider == "deepseek":
        choices = payload.get("choices") or [{}]
        content = (choices[0].get("message") or {}).get("content")
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            return "".join(part.get("text", "") for part in content).strip()
    return ""


def clean_json_text(text):
    text = str(text or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def is_invalid_key_error(status, detail):
    # Gemini 對無效的 Key 回 HTTP 400（API_KEY_INVALID），不是 401
    return status == 400 and "api key" in str(detail).lower()


def parse_provider_error(status, payload, api_key):
    payload = payload if isinstance(payload, dict) else {}
    error = payload.get("error")
    detail = (error.get("message") if isinstance(error, dict) else None) or payload.get("message") or ""
    detail = str(detail)
    if api_key:
        detail = detail.replace(str(api_key).strip(), "[已隱藏]")
    suffix = f" {detail}" if detail else ""
    if status in (401, 403) or is_invalid_key_error(status, detail):
        return f"API Key 無效或沒有權限。{suffix}"
    if status == 429:
        return f"API 額度或請求頻率已達限制。{suffix}"
    if status >= 500:
        return f"AI 服務暫時異常（HTTP {status}）。{suffix}"
    return f"AI API 請求失敗（HTTP {status}）。{suffix}"


SWITCH_MODEL_HINT = "可到「API 設定」按「讀取模型清單」改選其他模型。"


def request_json(url, headers, api_key, body=None, opener=None):
    """送出 HTTP 請求並回傳 JSON；錯誤轉成 ProviderError（不含 Key）。"""
    http_request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers=headers,
        method="POST" if body is not None else "GET",
    )
    open_url = opener or urllib.request.urlopen
    try:
        with open_url(http_request, timeout=REQUEST_TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read().decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            payload = {}
        message = parse_provider_error(error.code, payload, api_key)
        # 這些錯誤換下一段也會一樣失敗，所以停止整次分析
        fatal = error.code in (401, 403, 404, 429, 503) or is_invalid_key_error(error.code, json.dumps(payload))
        if error.code in (404, 503):
            message = f"{message} {SWITCH_MODEL_HINT}"
        raise ProviderError(message, fatal=fatal) from None
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError):
        raise ProviderError("無法連線到 AI API，請檢查網路或稍後重試。") from None
    except ValueError:
        raise ProviderError("AI API 回應無法解析。") from None


def call_provider(provider, api_key, model, text, image=None, opener=None):
    """送出分析請求並回傳解析後的 JSON 物件。"""
    request = build_provider_request(provider, api_key, model, text, image)
    payload = request_json(request["url"], request["headers"], api_key, request["body"], opener)

    raw_text = clean_json_text(extract_response_text(provider, payload))
    if not raw_text:
        raise ProviderError("AI 回應沒有可讀內容。")
    try:
        return json.loads(raw_text)
    except ValueError:
        raise ProviderError("AI 回應不是有效 JSON，請重試或切換 Provider。") from None


# 會回傳語音、圖片或向量的模型不能做文字 JSON 分析，不列出
NON_TEXT_MODEL = re.compile(r"tts|image|audio|embedding|live|veo|imagen", re.I)


def list_models(provider, api_key, opener=None):
    """列出這個 Key 可以用的模型：[{id, label, description}]。"""
    if not api_key or not str(api_key).strip():
        raise ProviderError("請先輸入 API Key。")
    config = get_provider_config(provider)
    api_key = str(api_key).strip()
    models = []
    if provider == "gemini":
        page_token = ""
        for _ in range(10):
            query = urllib.parse.urlencode({"pageSize": 1000, **({"pageToken": page_token} if page_token else {})})
            payload = request_json(f"{config['base_url']}/v1beta/models?{query}",
                                   {"x-goog-api-key": api_key}, api_key, opener=opener)
            for model in payload.get("models") or []:
                if "generateContent" not in (model.get("supportedGenerationMethods") or []):
                    continue
                model_id = re.sub(r"^models/", "", str(model.get("name", "")))
                if model_id and not NON_TEXT_MODEL.search(model_id):
                    models.append({
                        "id": model_id,
                        "label": _text(model.get("displayName")) or model_id,
                        "description": _text(model.get("description")),
                    })
            page_token = payload.get("nextPageToken") or ""
            if not page_token:
                break
    else:
        payload = request_json(f"{config['base_url']}/models",
                               {"Authorization": f"Bearer {api_key}"}, api_key, opener=opener)
        for model in payload.get("data") or []:
            if model.get("id"):
                models.append({"id": str(model["id"]), "label": str(model["id"]), "description": ""})
    if not models:
        raise ProviderError("這個 Key 沒有可用的模型。")
    default = config["model"]
    models.sort(key=lambda item: (item["id"] != default, "latest" not in item["id"], item["id"]))
    return models


# ---------------------------------------------------------------------------
# 三色脫水閱讀法：分段、提示詞、結果整理
# ---------------------------------------------------------------------------


def split_paragraphs(text):
    """先依空行分段；整篇沒有空行時，改用每一行當一段。"""
    text = str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return []
    blocks = [re.sub(r"\s*\n\s*", " ", block).strip() for block in re.split(r"\n\s*\n", text)]
    blocks = [block for block in blocks if block]
    if len(blocks) == 1:
        lines = [line.strip() for line in text.split("\n") if line.strip()]
        if len(lines) > 1:
            return lines
    return blocks


def build_overview_prompt(paragraphs):
    numbered = "\n\n".join(f"[P{index}] {paragraph}" for index, paragraph in enumerate(paragraphs, 1))
    return (
        "你是英文閱讀教練，使用「三色脫水閱讀法」：先抓文章骨幹，再逐句拆解。\n"
        "Step One：請先讀完整篇文章，找出文章骨幹。\n"
        f"文章共 {len(paragraphs)} 段，每段前面有 [P1]、[P2] 這樣的編號。\n"
        "只回傳 JSON，格式如下：\n"
        '{"article_title":"繁體中文標題","thesis":"用一句繁體中文說出全文核心主張",'
        '"paragraphs":[{"index":1,"summary":"這段的骨幹，一句簡短英文","summary_zh":"同一句的繁體中文",'
        '"logic_role":"background | problem | claim | evidence | example | contrast | cause | effect | conclusion 擇一"}]}\n'
        f"paragraphs 必須剛好 {len(paragraphs)} 筆，順序與編號一致。\n\n"
        f"{numbered}"
    )


def build_paragraph_prompt(paragraph, index, total, thesis=""):
    context = f"全文核心主張：{thesis}\n" if thesis else ""
    return (
        "你是英文閱讀教練，使用「三色脫水閱讀法」分析英文長難句。\n"
        "⚫ 黑色脫水：先把修飾語淡化，只留下句子主幹。\n"
        "🔵 藍色點穴：點出主詞 subject、主要動詞 main_verb、受詞 object 或補語 complement。\n"
        "🔴 紅色回填：把每個修飾語掛回它真正修飾的對象 target。\n\n"
        f"{context}"
        f"以下是第 {index} / {total} 段。請把這段逐句拆開，每一句都要分析，不可省略。\n"
        "規則：original、subject、main_verb、object、complement、modifiers[].text 都必須是原句中逐字出現的片段；"
        "沒有的欄位給空字串。\n"
        "只回傳 JSON，格式如下：\n"
        '{"summary":"這段的骨幹，一句簡短英文","summary_zh":"繁體中文",'
        '"logic_role":"background | problem | claim | evidence | example | contrast | cause | effect | conclusion 擇一",'
        '"sentences":[{"original":"原句","subject":"","main_verb":"","object":"","complement":"",'
        '"modifiers":[{"text":"修飾語原文","target":"被修飾的字詞","type":"relative_clause | reduced_relative_clause | '
        'participial_modifier | prepositional_phrase | appositive | adverbial_clause | infinitive_phrase | other",'
        '"explanation":"繁體中文：補充說明了什麼"}],'
        '"skeleton_zh":"主幹的繁體中文","translation":"整句繁體中文翻譯"}]}\n\n'
        f"段落：\n{paragraph}"
    )


OCR_PROMPT = (
    "請把圖片中的英文文章逐字抄寫出來，保留原本的段落；段落之間空一行。"
    '不要翻譯、不要摘要。只回傳 JSON：{"text":"抄寫的文章"}'
)


def _text(value):
    return value.strip() if isinstance(value, str) else ""


def normalize_overview(payload, paragraphs):
    payload = payload if isinstance(payload, dict) else {}
    items = payload.get("paragraphs") if isinstance(payload.get("paragraphs"), list) else []
    normalized = []
    for index, paragraph in enumerate(paragraphs):
        item = items[index] if index < len(items) and isinstance(items[index], dict) else {}
        normalized.append({
            "index": index + 1,
            "text": paragraph,
            "summary": _text(item.get("summary")),
            "summary_zh": _text(item.get("summary_zh")),
            "logic_role": _text(item.get("logic_role")),
        })
    return {
        "article_title": _text(payload.get("article_title")) or _text(payload.get("title")) or "文章分析",
        "thesis": _text(payload.get("thesis")) or _text(payload.get("core_claim")),
        "paragraphs": normalized,
    }


def normalize_sentence(sentence):
    sentence = sentence if isinstance(sentence, dict) else {}
    skeleton = sentence.get("skeleton") if isinstance(sentence.get("skeleton"), dict) else {}
    modifiers = []
    for modifier in sentence.get("modifiers") or []:
        if isinstance(modifier, dict) and _text(modifier.get("text")):
            modifiers.append({
                "text": _text(modifier.get("text")),
                "target": _text(modifier.get("target")),
                "type": _text(modifier.get("type")),
                "explanation": _text(modifier.get("explanation")),
            })
    return {
        "original": _text(sentence.get("original")),
        "subject": _text(sentence.get("subject")) or _text(skeleton.get("subject")),
        "main_verb": _text(sentence.get("main_verb")) or _text(skeleton.get("main_verb")),
        "object": _text(sentence.get("object")) or _text(skeleton.get("object")),
        "complement": _text(sentence.get("complement")) or _text(skeleton.get("complement")),
        "modifiers": modifiers,
        "skeleton_zh": _text(sentence.get("skeleton_zh")),
        "translation": _text(sentence.get("translation")),
    }


def normalize_paragraph(payload, paragraph):
    payload = payload if isinstance(payload, dict) else {}
    sentences = [normalize_sentence(item) for item in payload.get("sentences") or []]
    sentences = [item for item in sentences if item["original"]]
    if not sentences:
        sentences = [normalize_sentence({"original": paragraph})]
    return {
        "summary": _text(payload.get("summary")),
        "summary_zh": _text(payload.get("summary_zh")),
        "logic_role": _text(payload.get("logic_role")),
        "sentences": sentences,
    }


# ---------------------------------------------------------------------------
# API handlers
# ---------------------------------------------------------------------------


def _credentials(data):
    provider = data.get("provider") or "gemini"
    get_provider_config(provider)
    return provider, data.get("apiKey") or "", _text(data.get("model"))


def handle_overview(data, caller=None):
    caller = caller or call_provider
    provider, api_key, model = _credentials(data)
    paragraphs = split_paragraphs(data.get("text"))
    if not paragraphs:
        raise ProviderError("請先輸入文章或句子。")
    payload = caller(provider, api_key, model, build_overview_prompt(paragraphs))
    return normalize_overview(payload, paragraphs)


def handle_paragraph(data, caller=None):
    caller = caller or call_provider
    provider, api_key, model = _credentials(data)
    paragraph = _text(data.get("paragraph"))
    if not paragraph:
        raise ProviderError("段落是空的。")
    index = int(data.get("index") or 1)
    total = int(data.get("total") or 1)
    prompt = build_paragraph_prompt(paragraph, index, total, _text(data.get("thesis")))
    return normalize_paragraph(caller(provider, api_key, model, prompt), paragraph)


def handle_ocr(data, caller=None):
    caller = caller or call_provider
    provider, api_key, model = _credentials(data)
    image = data.get("image")
    if not isinstance(image, dict) or not image.get("dataUrl"):
        raise ProviderError("請先選擇圖片。")
    payload = caller(provider, api_key, model, OCR_PROMPT, image)
    text = _text(payload.get("text")) if isinstance(payload, dict) else ""
    if not text:
        raise ProviderError("圖片中沒有讀到英文文字。")
    return {"text": text}


def handle_test(data, caller=None):
    caller = caller or call_provider
    provider, api_key, model = _credentials(data)
    caller(provider, api_key, model, 'Return only this JSON object: {"ok":true}.')
    return {"ok": True, "label": PROVIDERS[provider]["label"]}


def handle_models(data, caller=None):
    provider, api_key, _ = _credentials(data)
    return {"models": (caller or list_models)(provider, api_key)}


ROUTES = {
    "/api/models": handle_models,
    "/api/overview": handle_overview,
    "/api/paragraph": handle_paragraph,
    "/api/ocr": handle_ocr,
    "/api/test": handle_test,
}


class Handler(BaseHTTPRequestHandler):
    server_version = f"ThreeColorReading/{VERSION}"

    def log_message(self, format, *args):  # 不把請求內容印到終端機
        pass

    def _send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/providers":
            return self._send_json(200, {"providers": PROVIDERS, "version": VERSION})
        if path == "/":
            path = "/index.html"
        file_path = (STATIC_DIR / path.lstrip("/")).resolve()
        if STATIC_DIR not in file_path.parents or not file_path.is_file():
            return self._send_json(404, {"error": "找不到檔案。"})
        body = file_path.read_bytes()
        content_type = (CONTENT_TYPES.get(file_path.suffix)
                        or mimetypes.guess_type(file_path.name)[0] or "application/octet-stream")
        if content_type.startswith("text/") or content_type.endswith("javascript"):
            content_type += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        route = ROUTES.get(self.path.split("?", 1)[0])
        if not route:
            return self._send_json(404, {"error": "找不到 API。"})
        # 只接受本機網頁送來的請求，避免其他網站借用這個伺服器
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        if origin and origin not in (f"http://{host}",):
            return self._send_json(403, {"error": "只接受本機網頁的請求。"})
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY_BYTES:
            return self._send_json(413, {"error": "資料太大，請縮小圖片。"})
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            if not isinstance(data, dict):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            return self._send_json(400, {"error": "請求格式錯誤。"})
        try:
            return self._send_json(200, route(data))
        except ProviderError as error:
            return self._send_json(502, {"error": str(error), "fatal": error.fatal})
        except Exception:  # noqa: BLE001 - 不把內部錯誤（可能含 Key）回傳給網頁
            return self._send_json(500, {"error": "伺服器發生未預期的錯誤。"})


def create_server(port):
    for candidate in range(port, port + 20):
        try:
            return ThreadingHTTPServer(("127.0.0.1", candidate), Handler)
        except OSError:
            continue
    raise SystemExit(f"找不到可用的連接埠（{port}–{port + 19}）。")


def main(argv=None):
    parser = argparse.ArgumentParser(description="三色閱讀 本機網頁版")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="不要自動開啟瀏覽器")
    args = parser.parse_args(argv)

    server = create_server(args.port)
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    print(f"三色閱讀 本機網頁版 v{VERSION}")
    print(f"請在瀏覽器開啟：{url}")
    print("關閉這個視窗或按 Ctrl+C 即可停止。")
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
