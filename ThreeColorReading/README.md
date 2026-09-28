# 三色閱讀 本機網頁版

在自己電腦的瀏覽器使用三色閱讀：貼上英文文章和自己的 API Key，就會**一段一段**分析。邏輯和 Android 版相同：

```text
文章（或圖片）→ Step One 文章骨幹 → Step Two 每一段逐句三色脫水
```

- ⚫ **脫水**：修飾語變灰，只讀藍色主幹（誰 → 做什麼 → 什麼）
- 🔵 **骨幹**：只留主詞、動詞、受詞／補語
- 🔴 **回填**：修飾語變紅，並說明它修飾哪個字、補充了什麼，最後附整句中譯

支援 Gemini（`gemini-flash-latest`）和 DeepSeek V4.1-Flash（`deepseek-flash`），請求格式和 Android 版的 `api-client.js` 一樣。

## 需要什麼

只需要 Python 3.9 以上，**不用安裝任何套件**（只用標準函式庫）。

## 放到電腦上

把整個 `ThreeColorReading` 資料夾放到：

```text
C:\Users\yc\PycharmProjects\pythonProject\ThreeColorReading
```

資料夾內容：

```text
ThreeColorReading/
├─ app.py            # 本機伺服器：提供網頁、把請求轉送到 Gemini／DeepSeek
├─ start.bat         # Windows 雙擊啟動
├─ static/
│  ├─ index.html
│  ├─ style.css
│  └─ app.js         # 分段流程與三色標示
└─ tests/test_app.py
```

## 啟動

任選一種：

- **雙擊 `start.bat`**：會開一個黑色視窗並自動打開瀏覽器。
- **PyCharm**：對 `app.py` 按右鍵 → Run 'app'。
- **命令列**：

  ```bat
  cd C:\Users\yc\PycharmProjects\pythonProject\ThreeColorReading
  python app.py
  ```

瀏覽器會打開 <http://127.0.0.1:8765/>。8765 被占用時會自動換下一個埠，請看視窗上印出的網址。要停止就關掉視窗或按 `Ctrl+C`。

## 使用

1. 第一次開啟會出現「API 設定」：選 Gemini 或 DeepSeek，貼上 API Key，按「套用」。套用後會自動讀取這個 Key 可用的模型清單，之後也可以按「讀取模型清單」重新整理。可以先按「測試連線」確認 Key 可以用。
   - 模型下拉選單只列出能做文字分析的模型（Gemini 會排除語音、圖片、向量等模型）。清單以外的模型可以直接輸入模型 ID。
   - 「開始分析」旁邊也有模型選單。遇到模型找不到（404）或過載（503）時，分析會停下來；直接換一個模型，再按「重試這一段」或重新開始。
2. 貼上英文文章，**段落之間空一行**。整篇都沒有空行時，每一行會當成一段。
3. 按「開始分析」（或 `Ctrl+Enter`）。
   - 先做 Step One：讀完全文，列出標題、核心主張和每段骨幹。
   - 再做 Step Two：一段一段送出分析，每段完成就先顯示，不用等全部做完。
4. 上方可以切換 ⚫ 脫水／🔵 骨幹／🔴 回填。點 Step One 的段落可以跳到該段。
5. 某一段失敗時，那一段會出現「重試這一段」。按「取消」會停止，已完成的段落會保留。
6. 文章在圖片裡的話：按「選擇圖片」→「從圖片擷取文字」，確認文字後再按「開始分析」。

## API Key 安全

- Key 只隨每次請求送到你自己電腦上的 `app.py`（只監聽 `127.0.0.1`，別台電腦連不到），再由它轉送到 Gemini／DeepSeek。伺服器不寫檔，也不印出請求內容。
- 預設只存在這個瀏覽器分頁，關掉分頁就清除。勾選「在這台電腦的瀏覽器記住 Key」才會存在瀏覽器的 localStorage。共用電腦請不要勾選。
- 不要把 Key 寫進程式碼，也不要提交到 GitHub。

## 測試

```bat
python -m unittest discover -s tests
```
