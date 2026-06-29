# 鏈勢雷達 GitHub 免費 Telegram 版

呢個係獨立自動化版本，只負責 BTC、ETH、SOL Telegram 掃描，唔包含網站、管理員密碼或本機 `.env`。

## 排程

- 每 5 分鐘：更新 BTC／ETH／SOL 價格、夜更掛單及已入場交易結果
- 每個標的每兩小時最多一次：AI 自主多週期判讀（4H／1H／15m／5m）並參考威科夫掃描
- 香港時間 23:07 起：BTC／ETH／SOL 夜更限價掛單；23:22、23:37、23:52 重試，凌晨 00:07、00:22 補發前一晚
- GitHub 排程可能因平台負載延遲

## 夜更掛單保證邏輯

- 夜更唔係一般即時訊號；AI 必須喺 LONG／SHORT 二選一並輸出 `WAIT_LIMIT`。
- 必須有 Entry、SL、TP1、TP2；AI 回覆 `NO_TRADE` 或空白價位會被判定為失敗並轉用後備模型。
- 如果 AI API／免費模型全部失效，會用同一套多時間框架規則引擎建立「AI異常保底掛單」，避免成晚完全冇覆蓋。
- 只有 BTC、ETH、SOL 三張掛單全部建立後，先會將該晚標記成完成。
- 部分失敗唔會鎖死當晚，下一個保險排程會補齊，而且唔會重複建立已存在嘅幣種掛單。

免費 OpenRouter 每日只有 50 次請求。本版本把自動 AI 用量限制於每日最多 39 次（即時 36＋夜更 3），預留約 11 次畀網站手動分析；AI 自己決定順勢／逆勢、入場或不交易，舊規則只作非權威參考。

## GitHub Secrets

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `OPENROUTER_API_KEY`

程式庫需要允許 GitHub Actions `Read and write permissions`，用作保存去重、掛單、交易結果及勝率狀態。

> 所有訊號只供技術分析參考，並非投資建議。
