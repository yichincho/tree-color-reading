# 三色閱讀 Three-Color Reading

三色閱讀是一個 Android 英文閱讀工具的 UI／API Prototype：先抓文章與句子的骨幹，再透過「⚫ 黑色脫水、🔵 藍色點穴、🔴 紅色回填」看懂長難句。

## 目前版本

`v0.2.2`：修正 Gemini latest alias 的 Gemini 3.x request 設定，並加入與三色閱讀主題一致的 Android launcher icon。

- Gemini：`gemini-flash-latest`（官方 alias，自動跟隨目前 Gemini Flash 模型）
- DeepSeek：`deepseek-flash`（DeepSeek-V4.1-Flash）
- Gemini／DeepSeek Flash 都支援文字＋圖片
- API Key 不寫入原始碼；Prototype 只存目前頁面記憶體
- DeepSeek V4-Pro 在 Provider 文件中標記為文字限定

## 目錄

```text
three-color-reading/
├─ three_color_reading_ui_prototype.html  # 4 畫面互動 Prototype
├─ api-client.js                           # Gemini／DeepSeek request builder
├─ API_CONFIG.md                           # endpoint、model、圖片格式與安全規則
├─ test/
│  ├─ api-client.test.js
│  └─ prototype-structure.test.js
├─ package.json
├─ .gitignore
└─ android/                                # WebView Android 測試包
```

## 開啟 Prototype

因為 HTML 需要載入同資料夾的 `api-client.js`，建議在專案資料夾啟動本地靜態伺服器：

```bash
cd three-color-reading
python3 -m http.server 4173
```

再開啟：

```text
http://127.0.0.1:4173/three_color_reading_ui_prototype.html
```

也可以直接雙擊 HTML；但某些瀏覽器對本地檔案的 JavaScript 載入或 Clipboard 權限較嚴格。

## 執行測試

```bash
npm test
npm run check
```

## API 設定

點 Prototype 上方的「API 設定／測試連線」：

1. 選 Gemini 或 DeepSeek V4.1-Flash。
2. 輸入自己的 API Key。
3. 確認模型 ID 與 Endpoint。
4. 按「套用設定」或「測試連線」。
5. 首頁貼入文章；需要圖片時按「加入圖片」。

Gemini 的 `gemini-flash-latest` 是 alias，不綁定單一 3.1 版本；Google 更新 alias 後，下一次請求會跟隨目前的 Flash 模型。

本 Prototype 不內建任何 API Key。請不要把自己的 Key 寫入 GitHub，也不要把 Key 貼在公開 issue、README 或截圖中。

詳細 request 格式請看 [API_CONFIG.md](API_CONFIG.md)。

## 後續 Android 實作

下一階段可用 Kotlin + Jetpack Compose 實作同一個 `ReadingAnalysisProvider` 介面，並用 Android Keystore 儲存使用者 Key。UI 先沿用 Prototype 的 4 頁流程，再接 Room、JSON schema validation、閱讀紀錄與 APK build。

## Android 測試 APK

Android 測試包由 GitHub Actions 建置，輸出檔名為 `three-color-reading-v0.2.2-debug.apk`。下載後可在小米 MIX 2 開啟安裝；若 Android 顯示來源限制，請暫時允許瀏覽器或檔案管理器安裝未知來源應用程式。
