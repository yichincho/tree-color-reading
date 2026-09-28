# 三色閱讀 API 設定 v0.2.2

更新日期：2026-09-28

本文件定義三色閱讀的 AI Provider 介面。畫面流程不變：

```text
文章／圖片輸入 → Step One 骨幹 → Step Two 三色脫水
```

## 1. 最新 Provider 決定

### Gemini

- 預設模型：`gemini-flash-latest`（官方 latest alias，自動跟隨目前 Flash 模型）
- 官方 REST API：

```text
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
```

- API Key：放在 `x-goog-api-key` header，不放 URL。
- 輸入：文字、圖片；圖片使用 Gemini REST 的 `inline_data`。
- JSON：`generationConfig.responseMimeType = application/json`。
- Gemini 3.x 使用 API 預設的 sampling 設定；不額外傳送 `temperature`，避免 latest alias 切換後產生無效參數。

### DeepSeek

- 最新 Flash 模型 ID：`deepseek-flash`
- 實際模型版本：DeepSeek-V4.1-Flash。
- 官方 OpenAI-compatible endpoint：

```text
POST https://api.deepseek.com/chat/completions
```

- API Key：`Authorization: Bearer <DEEPSEEK_API_KEY>`。
- 輸入：文字、圖片；圖片放在 `user` message 的 `content` 陣列中。
- 圖片格式：JPEG、PNG、GIF、WebP；本 Prototype 先使用 base64 data URL。
- JSON：`response_format = { "type": "json_object" }`。
- 閱讀分析預設使用 `thinking = { "type": "disabled" }`，避免每句結構解析產生不必要的推理延遲與消耗。

### 版本辨識很重要

目前官方文件的差異是：

| 模型 ID | 目前定位 | 圖片 | 本專案用途 |
|---|---|---:|---|
| `deepseek-flash` | DeepSeek-V4.1-Flash | ✅ | 預設 DeepSeek Provider，文字＋圖片 |
| `deepseek-v4-flash` | 舊相容名稱，已退役 | ✅（轉送） | 不作為新設定值 |
| `deepseek-v4-flash-vision-exp` | 舊 Vision Exp 名稱，已退役 | ✅（轉送） | 不作為新設定值 |
| `deepseek-v4-pro` | DeepSeek-V4-Pro | ❌ | 僅文字／未來可作文字進階分析 |

因此不能只寫「DeepSeek V4 會不會看圖」；正確答案是：**最新 Flash 線支援原生圖片，V4-Pro 不支援圖片。**

## 2. Request 對照

### Gemini

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        { "text": "請分析這篇文章並只回傳 JSON。" },
        {
          "inline_data": {
            "mime_type": "image/png",
            "data": "BASE64_DATA"
          }
        }
      ]
    }
  ],
  "generationConfig": {
    "responseMimeType": "application/json"
  }
}
```

### DeepSeek Flash

```json
{
  "model": "deepseek-flash",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "請分析這篇文章並只回傳 JSON。" },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/png;base64,BASE64_DATA",
            "detail": "auto"
          }
        }
      ]
    }
  ],
  "thinking": { "type": "disabled" },
  "response_format": { "type": "json_object" },
  "temperature": 0.2
}
```

## 3. Provider 介面

Android 正式版維持 Provider abstraction，不讓 UI 直接知道 endpoint：

```kotlin
interface ReadingAnalysisProvider {
    suspend fun analyze(
        text: String,
        image: ImageInput? = null
    ): ArticleAnalysis
}
```

建議實作：

```text
ReadingAnalysisProvider
├─ GeminiReadingProvider
└─ DeepSeekReadingProvider
```

兩者最後都轉成相同的 `ArticleAnalysis`，讓 Step One／Step Two 不需要分 Provider 寫兩套 UI。

## 4. Key 安全規則

### 目前 HTML Prototype

- API Key 只存在目前頁面的 JavaScript 記憶體。
- 不寫入 HTML、URL、console、README 或 GitHub。
- 重新整理後需要重新輸入。
- Prototype 的瀏覽器直連只適合個人測試，不代表正式上線的安全方案。

### Android 正式版

- 使用 Android Keystore 保護 Gemini／DeepSeek Key。
- 不把 Key 放在 `BuildConfig`、APK、GitHub、`local.properties` 的 release 產物或 log。
- 生產環境優先改用 backend proxy；若個人版直連，必須在設定頁明確告知 Key 風險。
- Gemini Key 使用受限 key；DeepSeek Key 不進入 URL。

## 5. 官方依據

- Gemini API：<https://ai.google.dev/api/generate-content>
- Gemini Models：<https://ai.google.dev/gemini-api/docs/models>
- Gemini API Changelog（latest alias 變更）：<https://ai.google.dev/gemini-api/docs/changelog>
- DeepSeek Models & Pricing：<https://api-docs.deepseek.com/quick_start/pricing/>
- DeepSeek Models API：<https://api-docs.deepseek.com/api/list-models/>
- DeepSeek Vision：<https://api-docs.deepseek.com/guides/vision/>
- DeepSeek-V4.1-Flash Release：<https://api-docs.deepseek.com/news/news260910/>
