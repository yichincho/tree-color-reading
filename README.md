# 三色閱讀 Three-Color Reading

三色閱讀是一個 Android 英文閱讀工具的 UI／API Prototype：先抓文章與句子的骨幹，再透過「⚫ 黑色脫水、🔵 藍色點穴、🔴 紅色回填」看懂長難句。

## 目前版本

`v0.2.0`：在原本 4 個 Android 手機畫面上加入可操作的 Provider 設定與 API request mapping。

- Gemini：`gemini-3.1-flash-lite`
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
└─ .gitignore
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

本 Prototype 不內建任何 API Key。請不要把自己的 Key 寫入 GitHub，也不要把 Key 貼在公開 issue、README 或截圖中。

詳細 request 格式請看 [API_CONFIG.md](API_CONFIG.md)。

## 後續 Android 實作

下一階段可用 Kotlin + Jetpack Compose 實作同一個 `ReadingAnalysisProvider` 介面，並用 Android Keystore 儲存使用者 Key。UI 先沿用 Prototype 的 4 頁流程，再接 Room、JSON schema validation、閱讀紀錄與 APK build。
