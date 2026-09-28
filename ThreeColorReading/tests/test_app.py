import io
import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app  # noqa: E402


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def fake_opener(payload, captured):
    def opener(request, timeout):
        captured.append(request)
        return FakeResponse(json.dumps(payload).encode("utf-8"))
    return opener


class SplitParagraphsTest(unittest.TestCase):
    def test_splits_on_blank_lines_and_joins_wrapped_lines(self):
        text = "First line\nstill first.\n\n\nSecond paragraph.\r\n\r\nThird."
        self.assertEqual(app.split_paragraphs(text), ["First line still first.", "Second paragraph.", "Third."])

    def test_falls_back_to_lines_when_no_blank_lines(self):
        self.assertEqual(app.split_paragraphs("One.\nTwo.\nThree."), ["One.", "Two.", "Three."])

    def test_empty_text(self):
        self.assertEqual(app.split_paragraphs("   \n "), [])


class ProviderRequestTest(unittest.TestCase):
    def test_gemini_text_only_has_single_part_and_header_key(self):
        request = app.build_provider_request("gemini", " secret ", "", "Hello")
        self.assertTrue(request["url"].endswith("/models/gemini-flash-latest:generateContent"))
        self.assertNotIn("secret", request["url"])
        self.assertEqual(request["headers"]["x-goog-api-key"], "secret")
        self.assertEqual(request["body"]["contents"][0]["parts"], [{"text": "Hello"}])
        self.assertEqual(request["body"]["generationConfig"], {"responseMimeType": "application/json"})

    def test_deepseek_with_image(self):
        image = {"dataUrl": "data:image/png;base64,QUJDRA==", "mimeType": "image/png"}
        request = app.build_provider_request("deepseek", "k", "", "Read", image)
        self.assertEqual(request["url"], "https://api.deepseek.com/chat/completions")
        self.assertEqual(request["headers"]["Authorization"], "Bearer k")
        self.assertEqual(request["body"]["model"], "deepseek-flash")
        self.assertEqual(request["body"]["messages"][0]["content"][1]["image_url"]["url"], image["dataUrl"])
        self.assertEqual(request["body"]["thinking"], {"type": "disabled"})

    def test_requires_key(self):
        with self.assertRaises(app.ProviderError):
            app.build_provider_request("gemini", "", "", "Hello")

    def test_call_provider_parses_fenced_json(self):
        captured = []
        payload = {"candidates": [{"content": {"parts": [{"text": '```json\n{"ok": true}\n```'}]}}]}
        result = app.call_provider("gemini", "k", "", "hi", opener=fake_opener(payload, captured))
        self.assertEqual(result, {"ok": True})
        self.assertEqual(captured[0].get_header("X-goog-api-key"), "k")

    def test_call_provider_hides_key_and_marks_auth_errors_fatal(self):
        def opener(request, timeout):
            body = io.BytesIO(json.dumps({"error": {"message": "bad key secret-123"}}).encode("utf-8"))
            raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, body)

        with self.assertRaises(app.ProviderError) as context:
            app.call_provider("deepseek", "secret-123", "", "hi", opener=opener)
        self.assertTrue(context.exception.fatal)
        self.assertNotIn("secret-123", str(context.exception))
        self.assertIn("[已隱藏]", str(context.exception))


    def test_gemini_invalid_key_400_is_fatal_key_error(self):
        def opener(request, timeout):
            payload = {"error": {"code": 400, "message": "API key not valid. Please pass a valid API key.",
                                 "status": "INVALID_ARGUMENT"}}
            raise urllib.error.HTTPError(request.full_url, 400, "Bad Request", {},
                                         io.BytesIO(json.dumps(payload).encode("utf-8")))

        with self.assertRaises(app.ProviderError) as context:
            app.call_provider("gemini", "bad", "", "hi", opener=opener)
        self.assertTrue(context.exception.fatal)
        self.assertTrue(str(context.exception).startswith("API Key 無效"))


class AnalysisHandlersTest(unittest.TestCase):
    def test_overview_sends_numbered_paragraphs_and_fills_missing_items(self):
        prompts = []

        def caller(provider, api_key, model, prompt, image=None):
            prompts.append(prompt)
            return {"article_title": "標題", "thesis": "主張", "paragraphs": [{"summary": "S1", "logic_role": "claim"}]}

        result = app.handle_overview({"provider": "gemini", "apiKey": "k", "text": "A.\n\nB."}, caller)
        self.assertIn("[P1] A.", prompts[0])
        self.assertIn("[P2] B.", prompts[0])
        self.assertEqual([p["text"] for p in result["paragraphs"]], ["A.", "B."])
        self.assertEqual(result["paragraphs"][0]["summary"], "S1")
        self.assertEqual(result["paragraphs"][1]["summary"], "")

    def test_paragraph_normalizes_nested_skeleton_and_drops_empty_modifiers(self):
        def caller(provider, api_key, model, prompt, image=None):
            self.assertIn("第 2 / 3 段", prompt)
            self.assertIn("全文核心主張：T", prompt)
            return {
                "sentences": [{
                    "original": "The committee submitted its report.",
                    "skeleton": {"subject": "The committee", "main_verb": "submitted", "object": "its report"},
                    "modifiers": [{"text": ""}, {"text": "its", "target": "report"}],
                }],
            }

        result = app.handle_paragraph(
            {"provider": "deepseek", "apiKey": "k", "paragraph": "P", "index": 2, "total": 3, "thesis": "T"}, caller)
        sentence = result["sentences"][0]
        self.assertEqual(sentence["subject"], "The committee")
        self.assertEqual(sentence["main_verb"], "submitted")
        self.assertEqual(len(sentence["modifiers"]), 1)

    def test_paragraph_falls_back_to_original_text(self):
        result = app.handle_paragraph({"apiKey": "k", "paragraph": "Only text."}, lambda *args, **kwargs: {})
        self.assertEqual(result["sentences"][0]["original"], "Only text.")

    def test_ocr_requires_image(self):
        with self.assertRaises(app.ProviderError):
            app.handle_ocr({"apiKey": "k"}, lambda *args, **kwargs: {"text": "x"})


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = app.create_server(18765)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_serves_index_and_static_files(self):
        with urllib.request.urlopen(f"{self.base}/") as response:
            self.assertIn("三色閱讀", response.read().decode("utf-8"))
        with urllib.request.urlopen(f"{self.base}/app.js") as response:
            self.assertIn("javascript", response.headers["Content-Type"])

    def test_blocks_path_traversal(self):
        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(f"{self.base}/../app.py")
        self.assertEqual(context.exception.code, 404)

    def test_rejects_cross_origin_post(self):
        request = urllib.request.Request(
            f"{self.base}/api/test", data=b"{}", method="POST",
            headers={"Content-Type": "application/json", "Origin": "https://evil.example"})
        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(request)
        self.assertEqual(context.exception.code, 403)

    def test_returns_readable_error_without_key(self):
        request = urllib.request.Request(
            f"{self.base}/api/overview", data=json.dumps({"provider": "gemini", "text": "Hi"}).encode(),
            method="POST", headers={"Content-Type": "application/json"})
        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(request)
        self.assertEqual(context.exception.code, 502)
        self.assertEqual(json.loads(context.exception.read())["error"], "請先輸入 API Key。")


if __name__ == "__main__":
    unittest.main()
