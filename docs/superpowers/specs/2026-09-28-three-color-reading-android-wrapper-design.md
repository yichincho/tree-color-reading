# 三色閱讀 Android 測試包設計

## 目標

將目前已驗證的 HTML Prototype 包裝成可安裝的 Android debug APK，讓使用者在小米 MIX 2 上直接測試四個主要畫面、Gemini／DeepSeek API 設定，以及文字＋圖片分析流程。

## 範圍

- 保留現有 Step One「骨幹」與 Step Two「三色脫水閱讀法」畫面與互動流程。
- Gemini 預設使用官方 `gemini-flash-latest` alias，不指定 `gemini-3.1`；每次請求由 Google alias 指向目前的 Flash 模型。
- DeepSeek 維持 `deepseek-flash`（V4.1-Flash）與圖片輸入。
- 新增最小 Android WebView 專案，將 HTML、CSS、JavaScript 放入 APK assets。
- 透過 GitHub Actions 使用 Java 17、Gradle 8.9、Android SDK 35 建置 debug APK。
- APK 只包含空白設定狀態；API Key 僅在執行期間的記憶體中使用，不進入 GitHub、APK 或 build log。

## 非目標

- 這一版不重寫成 Jetpack Compose。
- 不建立後端 proxy，也不代替使用者保存 API Key。
- 不建立正式簽署版 release APK；目前是可安裝測試的 debug APK。

## 架構

Android `MainActivity` 啟動安全的 WebView，透過 AndroidX `WebViewAssetLoader` 從 `app/src/main/assets/` 以 HTTPS asset origin 載入現有 Prototype。WebView 啟用 JavaScript、DOM storage 與網路權限，但不開啟 file URL 的跨來源通行；API request 仍由既有 `api-client.js` 發送到 Gemini／DeepSeek HTTPS endpoint。

## 固定值

- Application ID：`tw.yc.threecolorreading`
- versionName：`0.2.1`
- minSdk：26（涵蓋小米 MIX 2 常見的 Android 9 測試環境）
- target／compile SDK：35
- 測試 APK：debug variant，檔名 `three-color-reading-v0.2.1-debug.apk`

## 驗收條件

1. `npm test` 與 `npm run check` 通過。
2. Gemini request 不再出現 `gemini-3.1-flash-lite`，預設 request model 為 `gemini-flash-latest`。
3. Android 專案可由 GitHub Actions 成功產生 APK。
4. APK 安裝後可顯示四個主要畫面，且 API 設定視窗可操作。
5. GitHub `main` 包含 Android 原始碼、workflow 與測試；APK 可下載供手動測試。
