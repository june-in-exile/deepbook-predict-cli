# DeepBook Predict — 講稿

> 講者：June
> 場合：技術受眾簡報（開發者 / 技術團隊）
> 預計時長：約 15–18 分鐘
> 對應投影片：`present.html`（13 頁含 Live Demo 收尾;References 不另講）

---

## Slide 1 · Cover

**畫面停留：約 30 秒**

大家好，我是 June。

今天想跟大家聊一個很多人聽過名字、但其實沒搞懂的東西——**DeepBook Predict**。

如果你只看名字，「Predict」這個詞會直覺讓你想到 Polymarket，想到「猜下次選舉誰會贏」這種應用。但我接下來十幾分鐘要說服你的是：**Predict 不是另一個 Polymarket，它根本不是同一層的東西。**

它是 Sui 上一個全新的金融原語，跟 Spot、Margin 並列。簡單講——它是讓人能「蓋出 Polymarket 以及更多東西」的基礎設施。

> *按右鍵或空白鍵切下一頁*

---

## Slide 2 · Predict ≠ 傳統預測市場

**畫面停留：約 1.5–2 分鐘**

先把最大的誤解破除掉。

Polymarket 是**一個 application**。它有自己的訂單簿、自己的造市商、自己的市場列表。你要用它，你就是 Polymarket 的使用者。

DeepBook Predict 是**一個 primitive**。它不是給使用者用的，是給**開發者**用的。它是 Sui 上的一個共享物件，任何 builder 都可以用它蓋出自己的預測市場、選擇權產品、結構型商品——而且共用同一個流動性池。

來看這張對照表，差別在六個關鍵面向上：

- **本質**：一個是 app，一個是 infra primitive
- **定價**：Polymarket 靠群眾報價；Predict 接的是 **Block Scholes**——一家 FCA 監管的機構級加密衍生品分析平台
- **流動性**：Polymarket 每個市場各自找造市商；Predict 是**共享 vault**——LP 供應 quote、換取 PLP shares
- **冷啟動**：Polymarket 沒人報價就死；Predict 用**共享 vault 直接承接**，新市場一開盤就有對手方
- **部位**：Polymarket 的部位是死代幣，只能持有或賣出；Predict 的部位可以**加槓桿、可以當抵押、可以組合**
  - 舉個具體的例子：小明今天看好 BTC，花 $30 買了一個「BTC 到期 > $80,500」的 binary up 部位。在 Polymarket 上，這 $30 就只能死等到期才知道翻倍或歸零。但在 Predict 上，他可以**把這個 binary 部位丟進 Margin 當抵押、借出 USDC 再去開槓桿 spot long**——一筆操作就把兩件事疊在一起——**下檔被選擇權鎖住**（最多就賠那 $30 權利金，再怎麼跌都不會多賠），**上檔被 spot 槓桿放大**（如果 BTC 真的漲，他靠借來的錢加倍賺）。這種組合在傳統鏈上選擇權做不到，因為 option 部位是死代幣、沒人接受它當抵押
- **產品範圍**：Polymarket 主要做二元事件；Predict 從一開始就是 binary、call/put/spread、槓桿、結構型——全部一起設計

**收尾一句話**：Polymarket 是**一個產品**；DeepBook Predict 是**讓你能蓋出那個產品（以及更多）的基礎設施**。

這個區分很關鍵，因為它決定了「為什麼這東西值得做」。

---

## Slide 3 · 預測市場其實是一種選擇權

**畫面停留：約 30–45 秒**

在繼續往下講之前，先丟一個觀念出來，這個視角是後面幾頁的主軸：

> **預測市場其實是一種選擇權。**

「BTC 到期會不會 > $80,500？」這種押注，在數學上就是 **binary option**——條件成立就拿固定金額，不成立就歸零。Polymarket 賣的 Yes/No，本質跟 cash-or-nothing binary option 完全等價。

換上「選擇權」這個視角去看，**預測市場只是其中最簡單的一種形狀**。下一頁我把四種 payoff 形狀畫出來——你會看到 binary 只是入口，背後還有 call、put、spread 一整個選擇權家族。

---

## Slide 4 · 四種到期 P&L

**畫面停留：約 1.5 分鐘**

在繼續講「為什麼要做這件事」之前，先用一張圖把「Predict 能做出什麼產品」講清楚。

畫面上四張圖，**X 軸是標的價 S（到期當下）、Y 軸是 P&L（到期淨損益，已扣權利金）、K 是履約價、p 是權利金**——重點是 Y 軸是**淨損益**，不是 payoff。

- **Binary**（二元期權）——最簡單的形狀。S 跨過 K 就拿固定金額 M，否則歸零。**Polymarket 的 Yes/No 在數學上就等價於這個**——所以可以這樣理解：Polymarket 是 Predict 最簡單那一種產品的子集。
- **Call**（看漲選擇權）——S 漲過 **K + p** 才開始賺，**上方無封頂**，下方損失上限就是 p。
- **Put**（看跌選擇權）——Call 的鏡像。S 跌破 **K − p** 才賺，跟現貨組起來就是 collar、做下行保護。
- **Vertical Spread**（價差，這裡用 bull call 當例子）——long K₁、short K₂，**封頂、封底、便宜**。是建構結構型商品的基本積木。

**收尾一句話**：Binary 只是其中**最簡單的一種**；其餘三種**都要靠 DeepBook Predict 作為 infra 才能輕鬆組得出來**。

下一張就是要講：為什麼這個 infra 值得做。

---

## Slide 5 · 為什麼需要它

**畫面停留：約 1.5 分鐘**

那為什麼這基礎設施值得做？看三個數字。

- **Polymarket 在 2026 年 2 月單月做了 $7B 交易量**，7 萬日活——預測市場本身的需求是真實存在的。
- **2025 年永續合約 DEX 做了 $7.9T**——衍生品在鏈上的需求量級超巨大。
- **但鏈上選擇權整個品類的 TVL 只有大約 $1 億——而且是平的**，多年都沒長。

需求那麼旺，為什麼選擇權上不來？不是需求問題，**是架構問題**。鏈上選擇權卡在三個病根上：

1. **流動性鎖在部位層級**——每個市場各自為政，資金不能共用，資本效率超差
2. **冷啟動無解**——新市場沒交易對手就死，引導造市商既貴又慢
3. **部位是死路一條**——不能加槓桿、不能當抵押、不能組合，只是 app 不是 infra

Predict 要解的就是這三件事：**讓流動性共享、讓部位可組合**。

---

## Slide 6 · DeepBook 三大原語

**畫面停留：約 1 分鐘**

退一步看 DeepBook 整個堆疊。

DeepBook 上有三個可組合的原語：

- **Spot**：Sui 上最深的鏈上中央限價訂單簿。所有 app 共用同一個訂單簿——這是 DeepBook 的起家厝。
- **Margin**：在同一個訂單簿上加槓桿。共享抵押品 → 更深的市場、更好的清算價。
- **Predict**：原生於訂單簿的可組合選擇權原語。binary、選擇權、槓桿、結構型商品——這是新加的第三塊。

關鍵點：**三個原語共享同一個流動性堆疊**。

這代表什麼？代表一個 builder 想做的東西，**不會被任何單一原語的能力侷限**。你要做帶槓桿的預測市場？Margin × Predict。你要做以選擇權部位做抵押的 spot 交易？Spot × Predict。設計空間遠大於三個獨立用例的總和——這才是「Only on Sui」這句口號的真正意義。

---

## Slide 7 · 兩種 Position 類型

**畫面停留：約 1.5 分鐘**

那 Predict 具體能做什麼？協議原生支援**兩種**部位類型。

**Binary Position**——方向性的押注：「BTC 到期會 > $80,500 嗎？」一個 strike、一個方向，就決定贏或輸。Key 是 `oracle + 到期 + strike + 方向`。

**Vertical Range**——區間型押注：「BTC 到期會落在 $80k 到 $82k 之間嗎？」兩個 strike，組成一個 range。Key 是 `oracle + 到期 + 低 strike + 高 strike`。

V1 已經出貨的是 **Binary 與 Vertical Range 兩種**——這兩個都是協議原生原語。

為什麼 Range 重要？因為 **Range 是 Predict 從「預測市場」長成「選擇權基礎設施」的關鍵積木**。有了 range，你就有了**價差**（call spread、put spread）的鏈上原料；再往上組就是結構型商品。

換句話說：Binary 看起來像預測市場，**有了 Range，這就是貨真價實的選擇權基礎設施**。

---

## Slide 8 · 核心架構：三條金流 × 一個共享池

**畫面停留：約 2 分鐘**

知道協議在處理什麼之後，看它在鏈上**用哪些物件、怎麼串起來**。

這張圖的讀法是這樣的——**左邊是 Trader、右邊是 LP，兩邊各有一條路徑，最後都匯流到底下的 PoolVault**。

**先看物件:**

- **PredictManager**（per-account · owned）——你的選擇權帳戶，**錢 + 倉位**都在這。Trader 端入口。
- **ExpiryMarket**（per-到期日 · shared）——對應一個到期日的市場物件，持 `lp_cash` 與 strike matrix。
- **Oracle**（external · 定價輸入）——Pyth 喂現價、Block Scholes 喂理論價。
- **`Coin<PLP>`**——LP 份額代幣，**可轉讓**。LP 端入口。
- **PoolVault**（shared · 流動性核心）——**所有市場結算的同一個池**。持 idle DUSDC、PLP treasury cap、fees。

上面還飄著兩個 globals——**ProtocolConfig**（policy / pause / fees）跟 **Registry**（索引 / 父物件）。**每個 PTB 都要帶上這兩個 shared object**。

**再看金流——三條：**

1. **MINT / REDEEM**——Trader 從 Manager 走到 Market，開倉或結算。
2. **ALLOCATE / SHRINK**——Market 跟 Vault 之間的資金搬運，把抵押品鎖住或釋出。這條對使用者是隱形的。
3. **SUPPLY / WITHDRAW**——LP 拿 `Coin<PLP>` **直戳 Vault**，不經過任何 Market。

這頁真正要強調的設計選擇是這個：**LP 不必進到任何特定市場，他直接餵 Vault**。Trader 開的所有市場、跟 LP 供的流動性、結算，**全部在同一個 Vault 匯流**。

收尾：**使用者與 LP 共用同一個 Vault——這是後面「PLP × 選擇權」創新的結構前提**。沒這個共用，後面的故事根本說不通。

---

## Slide 9 · 資料流：一筆 mint 怎麼跑

**畫面停留：約 1.5 分鐘**

知道有哪些物件之後，看它們怎麼串起來。我用一筆 binary mint 的生命週期帶大家走一遍：

- **STEP 1**：從 indexer 拿 active oracle 與 strike 階梯——這是 off-chain
- **STEP 2**：建立或沿用既有 PredictManager
- **STEP 3**：deposit DUSDC 進 Manager
- **STEP 4**：off-chain 計算 mint / redeem 的成本與 payout——預覽
- **STEP 5**：送出 `predict::mint` 交易，binary 或 range 都走這條，鏈上確認

確認後，刷新受影響的鏈上物件跟 indexer 端點。

整個 tap → bet → settle 在 Sui 上 **< 400ms** 完成。快到一個 app 可以**感覺像遊戲**——這對「把預測市場做成消費級體驗」是關鍵。

最後一個設計細節：**這條路徑是刻意對稱的**。Binary 跟 Range 走**同一條** mint / redeem 流程，差別只在 market key。Builder 寫一次邏輯就能同時支援兩種產品。

---

## Slide 10 · 預言機：Block Scholes 接入

**畫面停留：約 1.5 分鐘**

定價這件事，Predict 跟其他預測市場最大的不同就在這。

它不靠群眾報價，而是接入 **Block Scholes**——一家 FCA 監管的機構級加密衍生品分析平台，提供即時 IV surface 跟選擇權定價。

鏈上對應的物件是 **OracleSVI**。每個 oracle 對應一個資產加一個到期。協議用它算每個 strike / 方向的公允價，並推導 ask / bid 跟生命週期狀態。

預言機定下幾個關鍵約束：

- **ask 上限 $0.99**——近乎確定的押注被擋下，隱含機率必須在大約 5% 到 95% 之間
- **min ask $0.01**——過深 OTM 的 strike 不能 mint
- **tick grid**——strike 必須落在 oracle 的格點上（BTC tick = $1）

這幾條約束從 SDK 看起來像「規則」，但它們其實是**風險控管的鏈上體現**——防止 vault 暴露在無法定價的尾端風險上。

更重要的是這個事實本身：**這是把機構級選擇權定價，第一次帶進完全鏈上、次秒結算的環境**。

---

## Slide 11 · 真正的創新：PLP 共享 Vault

**畫面停留：約 2 分鐘**

來到我覺得最關鍵的一頁。

LP 共享池**不新**。選擇權定價**也不新**。創新在**結構**——用一個共享 vault 把兩者接起來。

**傳統鏈上選擇權**：抵押品鎖在每個部位裡。你買了一個 BTC call，那些抵押品就被鎖死了，不能拿去支撐別的市場。結果就是資本效率超差，每個新市場都得重新引導流動性。

**DeepBook Predict**：LP 供應 quote → mint PLP（vault 份額）。**所有市場**的部位都從同一個 vault 結算。一個 LP 進來，他的資本同時支撐 BTC binary、ETH binary、未來的 spread、未來的結構型商品——抵押品保持**活躍**。

這帶來兩件事：

1. **解掉冷啟動**——每個 Sui builder 都能用上原本需要大量時間跟資本才能建起的選擇權基礎設施。你不需要從零招攬造市商，你開個市場、流動性就在那。
2. **提款受限**——當然不是完全自由的。Vault 必須保留足夠 quote 覆蓋未平倉部位的 max payout，提款限制器把關。

收尾一句話：**創新不在發明 LP 池或選擇權定價，而在用一個共享 vault 把兩者接起來，讓選擇權流動性第一次能被重複利用。**

這是我前面說「使用者與 LP 共用同一個 Vault」是結構前提的原因。沒有這個共用，PLP × 選擇權這個故事根本說不通。

---

## Slide 12 · 路線圖 & 現況限制

**畫面停留：約 2 分鐘**

講到這你可能會覺得：聽起來很厲害，那現在可以用了嗎？

老實講，**還很早**。我把路線圖跟現況限制並排放，因為我覺得對技術受眾來說，誠實鋪陳比 over-promise 重要。

**路線圖**：

- **Testnet 已上線**——V1 binary + vertical range 已在 testnet 上跑，Block Scholes 提供預言機。**現在就能整合**。
- **可組合 call / put / spread**——這一步上來之後，結構型商品就變成 UX 問題，而不是基礎設施問題
- **Mainnet**——今年稍晚，第一方 app 會跟原語一起推出

**但現況的限制要說清楚**：

- **僅 Sui Testnet**——package ID、object layout 都還只是整合目標，mainnet 前可能變更
- **產品只有 binary + vertical range**——call、put、spread 等高階組合還沒到
- **quote 只有 DUSDC，沒有公開 faucet**——只有 Mysten 能 mint，這是新手最大的卡點
- **資產覆蓋極窄**——實務上主要是 BTC

收尾：現在的 Predict 是**一個窄但真實的整合面**。**拿來驗證整合，不是拿來上線**。

我相信對技術受眾講這種誠實，反而是加分。

---

## Slide 13 · 完整生命週期跑得通

**畫面停留：約 1.5 分鐘 + Demo**

所以最後一頁要 demo 的就是這件事：**在這些限制下，完整生命週期仍然跑得通。**

沒有 faucet、只有 BTC——

但 deposit → mint → redeem → LP supply → LP withdraw 五個動作，**全部跑得通**。

這就是我接下來要切到終端機去 demo 的東西。畫面上這個 CLI 是我為了驗證整合面寫的：

```
$ npm run setup
  ✓ PredictManager ready
  ✓ Wallet holds DUSDC
  ✓ Manager funded above $10

$ npm run mint-binary -- --strike 80500 --qty 5 --direction up --execute
  success: true  → suiscan.xyz/testnet/tx/…
```

一行指令、一個 PTB、< 400ms 確認、鏈上 settle。

> *切到終端機，跑 live demo*

---

## 收尾語（demo 後）

謝謝大家。

如果你今天只想記住一件事：

> **DeepBook Predict 不是另一個 Polymarket。它是讓 builder 在 Sui 上蓋 Polymarket（以及更多東西）的基礎設施——而且那個「更多」才是重點。**

如果你今天想記住第二件事：

> **PLP 共享 vault 是它跟其他鏈上選擇權真正的差異——把流動性從每個部位裡釋放出來，讓資本能被重複利用。**

我是 June，謝謝。歡迎來問問題。

---

## 講者備忘（不會講出來的）

- 整體節奏：前面（slide 2–5）破除誤解 + 視覺化產品形狀 + 量化問題，**比較激進的 framing**；中段（6–10）是技術細節，**節奏放穩**；後段（11）是創新點 climax；12–13 拉回誠實感跟 demo。
- Slide 3 是橋段，只有一句話，**講完就切下一頁**，不要在這頁停太久——它是給後面 payoff shapes 鋪框架用的。
- 如果時間緊，可砍 slide 9 的細節，直接帶過「五步、< 400ms、binary 跟 range 對稱」。
- 如果觀眾偏 LP / 金融，slide 11 多花 30 秒講提款限制器的設計。
- 如果觀眾偏 builder / SDK，slide 9 多花 30 秒講「對稱路徑」的意義。
- Demo 階段：先確認 manager 有錢、oracle 還沒到期；mint 完展示 suiscan、再 redeem 一次給觀眾看完整 lifecycle。
- 萬一 oracle 中途到期：**就講「這就是現況的真實限制」**——把意外變成 talking point。
