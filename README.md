# 鏈勢雷達 GitHub 免費 Telegram 版

呢個係獨立自動化版本，只負責 BTC、ETH、SOL Telegram 掃描，唔包含網站、管理員密碼或本機 `.env`。

## 排程

- 每 5 分鐘：BTC／ETH／SOL 多時間框架及威科夫掃描
- 香港時間約 23:05：三個標的夜更機會掛單
- GitHub 排程可能因平台負載延遲

## GitHub Secrets

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `OPENROUTER_API_KEY`

程式庫需要允許 GitHub Actions `Read and write permissions`，用作保存去重、掛單、交易結果及勝率狀態。

> 所有訊號只供技術分析參考，並非投資建議。
