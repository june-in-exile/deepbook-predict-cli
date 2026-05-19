# DeepBook Predict — 講稿

> 場合:技術受眾簡報(開發者 / 技術團隊)
> 預計時長:約 16–19 分鐘
> 對應投影片:`present.html`(14 頁,含 Live Demo 收尾;References 不另講)

---

## Slide 1 · Cover

**畫面停留:約 20 秒**

很多人聽過名字、但沒搞懂的東西——**DeepBook Predict**。

只看名字,「Predict」會直覺讓你想到 Polymarket、想到「猜下次選舉誰會贏」這種應用。但接下來十幾分鐘要說服你的是:**Predict 不是另一個 Polymarket,它根本不是同一層的東西。**

它是 Sui 上一個全新的金融原語,跟 Spot、Margin 並列。簡單講——**它是讓人能蓋出 Polymarket、以及更多東西的基礎設施**。

---

## Slide 2 · What is Prediction Market?

**畫面停留:約 1.5–2 分鐘**

在比較 DeepBook Predict 跟 Polymarket 之前,先把現有預測市場怎麼運作講清楚——「聽過名字」跟「真的搞懂」是兩回事。用 Polymarket 當主軸,因為它是這個品類最大的代表。

走一遍 trader 視角:

- **01 · Deposit USDC**——連錢包、把 USDC 押進去,作為買 share 的本金
- **02 · 買 Yes / No share**——例如「BTC 年底前會不會 > $80,500?」。Yes 跟 No 的價格**永遠加總到 $1**;Yes $0.42 / No $0.58 直接讀出來就是「市場認為事件成立的機率約 42%」
- **03 · 訂單簿撮合**——Polymarket 用訂單簿,背後是專業造市商在**每個市場各自報價**。熱門市場深、長尾市場淺
- **04 · 到期裁決**——resolution oracle(Polymarket 用 UMA optimistic oracle)判事件結果。事件成立,Yes 每股拿 $1、No 歸零;反之亦然

順帶一提:**Kalshi** 是同類產品,只是 CFTC 監管、結算中心化;**Augur** 改用 LMSR / AMM 曲線報價、靠去中心化分叉裁決。**定價跟結算機制各家略有不同,但「每個市場各自為政」這個底層設計幾乎一致。**

收尾:不管哪一家,每個「市場」都是**一個獨立的小 app**——自己的部位代幣、自己的訂單簿、自己的造市商。

---

## Slide 3 · 但這個設計卡在三件事

**畫面停留:約 1.5 分鐘**

看完機制,問一個直接的問題:這個設計到底卡在哪?三件事。

- **痛點 1 · 流動性鎖在單一市場**
  - 每個市場自找造市商,長尾市場日均交易量常常不到 $100
  - Polymarket 開了上千個市場,大部分流動性極淺
  - 新市場的「**冷啟動**」是品類級難題——既貴又慢

- **痛點 2 · 部位是死代幣**
  - Yes share 就是 Yes share,只能「持有」或「賣給下一個人」
  - **不能當抵押、不能加槓桿、不能跟別的 share 組成 spread**
  - 資本被鎖死在這個單一押注上,直到到期才解套

- **痛點 3 · 產品只有 Yes / No**
  - 架構天生只能做二元事件
  - Call / put / spread / range 這些選擇權形狀,沒辦法用 Yes/No share 拼出來
  - **結構型商品在這個架構上做不出來**——得從零搭另一套基礎設施

收尾:這三件事的共同根源是同一個——**它們是 application,不是 chain primitive**。

---

## Slide 4 · 預測市場其實是一種選擇權

**畫面停留:約 20–30 秒**

在繼續往下講之前,先丟一個觀念,這是後面幾頁的主軸:

> **預測市場其實是一種選擇權。**

「BTC 到期會不會 > $80,500?」這種押注,數學上就是 **binary option**——條件成立拿固定金額,不成立歸零。Polymarket 賣的 Yes/No,本質跟 cash-or-nothing binary option 完全等價。

換上「選擇權」這個視角去看,**預測市場只是其中最簡單的一種形狀**。

---

## Slide 5 · 四種到期 P&L

**畫面停留:約 1.5 分鐘**

四張圖,**X 軸是標的價 S(到期當下)、Y 軸是 P&L(到期淨損益,已扣權利金)、K 是履約價、p 是權利金**——重點是 Y 軸是**淨損益**,不是 payoff。

- **Binary**(二元期權)——最簡單的形狀。S 跨過 K 就拿固定金額 M,否則歸零。**Polymarket Yes/No 在數學上就等價於這個**——也就是說,Polymarket 是 Predict 最簡單那一種產品的子集
- **Call**(看漲選擇權)——S 漲過 **K + p** 才開始賺,**上方無封頂**,下方損失上限就是 p
- **Put**(看跌選擇權)——Call 的鏡像。S 跌破 **K − p** 才賺,跟現貨組起來就是 collar、做下行保護
- **Vertical Spread**(價差,這裡用 bull call 當例子)——long K₁、short K₂,**封頂、封底、便宜**。是建構結構型商品的基本積木

收尾:Binary 只是其中**最簡單的一種**;其餘三種**都要靠 DeepBook Predict 作為 infra 才能輕鬆組得出來**。

---

## Slide 6 · 鏈上選擇權卡關,是架構問題,不是需求問題

**畫面停留:約 1.5–2 分鐘**

把痛點對焦到數字上。

- **Polymarket 在 2026 年 2 月單月做了 $7B 交易量、7 萬日活**——預測市場本身的需求是真實存在的
- **2025 年永續合約 DEX 做了 $7.9T**——衍生品在鏈上的需求量級超巨大
- **但鏈上選擇權整個品類的 TVL 大約只有 $100M——而且是平的**,多年沒長

更細一點看 TVL 拆解(來源:DeFiLlama,約略值):

- **Aevo** 大概 $90M,是這品類裡 TVL 最大的
- **Derive** ~$30–50M;**Lyra** ~$20–30M——這兩個是 Lyra V2 拆分後流動性分流的結果
- **Dopex** ~$10–20M(SSOV / Atlantics)、**Premia** ~$5–10M(peer-to-pool AMM)、**Hegic** 幾百萬
- **Ribbon Finance** 早期曾經 > $100M,現在已大幅下降

把所有有點規模的鏈上選擇權協議加起來,還是這個量級——這不是「某個產品做不好」,**這是整個品類過不去**。

需求那麼旺、選擇權卻上不來——這 $100M 平坦 TVL,**正是前面 slide 3 那三個架構痛點(流動性鎖死、部位死代幣、形狀只到 binary)在數字上的後果**。

收尾一句:**架構問題,不是需求問題。**

---

## Slide 7 · Predict ≠ Prediction Market

**畫面停留:約 1.5–2 分鐘**

先把最大的誤解破除掉。多數人一聽「Predict」就想到 Prediction Market,但兩者本質不同。

Polymarket 是**一個 application**——自己的訂單簿、自己的造市商、自己的市場列表。你要用它,你就是 Polymarket 的使用者。

DeepBook Predict 是**一個 primitive**——不是給使用者用的,是給**開發者**用的。它是 Sui 上的一個共享物件,任何 builder 都可以用它蓋出自己的預測市場、選擇權產品、結構型商品——而且共用同一個流動性池。

差別在六個關鍵面向上:

- **本質**:一個是 application;另一個是可組合的 infra primitive
- **定價**:Polymarket 靠群眾報價;Predict 接的是 **Block Scholes**——一家 FCA 監管的機構級加密衍生品分析平台,鏈上用 **OracleSVI** 物件承載
- **流動性**:Polymarket 每個市場各自找造市商;Predict 是**共享 vault**——LP 供應 quote、換取 PLP shares
- **冷啟動**:Polymarket 沒人報價就死;Predict 用**共享 vault 直接承接**,新市場開盤就有對手方
- **部位**:Polymarket 的部位是死代幣,只能持有或賣出;Predict 的部位**可以加槓桿、可以當抵押、可以組成價差**
  - 一個具體的例子:看好 BTC,花 $30 買「BTC 到期 > $80,500」的 binary up 部位。在 Polymarket 上,這 $30 只能死等到期。在 Predict 上,可以**把這個 binary 部位丟進 Margin 當抵押、借出 USDC、再去開槓桿 spot long**——一筆操作就把兩件事疊在一起:**下檔被選擇權鎖住**(最多賠那 $30 權利金,再怎麼跌都不會多賠)、**上檔被 spot 槓桿放大**。這在傳統鏈上選擇權做不到,因為 option 部位是死代幣,沒人接受它當抵押
- **產品範圍**:Polymarket 主要做二元事件;Predict 從一開始就是 binary、call/put/spread、槓桿、結構型——全部一起設計

收尾:Polymarket 是**一個產品**;DeepBook Predict 是**讓你能蓋出那個產品、以及更多東西的基礎設施**。

---

## Slide 8 · 三個可組合原語,交集打開設計空間

**畫面停留:約 1.5 分鐘**

退一步看 DeepBook 整個堆疊。

DeepBook 上有三個可組合的原語:

- **Spot**:Sui 上最深的鏈上中央限價訂單簿。所有 app 共用同一個訂單簿——這是 DeepBook 的起家厝
- **Margin**:在同一個訂單簿上加槓桿。共享抵押品 → 更深的市場、更好的清算價
- **Predict**:原生於訂單簿的可組合選擇權原語。binary、選擇權、槓桿、結構型——這是新加的第三塊

關鍵不是「有這三塊」,**關鍵是它們之間的交集**:

- **Spot × Margin** = 槓桿現貨
- **Spot × Predict** = 現貨對沖(collar 之類)
- **Margin × Predict** = 槓桿選擇權
- **三個一起** = 結構型商品 — 真正可組合的金融原料

收尾:三個原語共享同一個流動性堆疊。一個 builder 想做的東西,**不會被任何單一原語的能力侷限**。設計空間遠大於三個獨立用例的總和——這才是「Only on Sui」這句口號的真正意義。

---

## Slide 9 · 兩種 Position 類型

**畫面停留:約 1.5 分鐘**

Predict 具體支援什麼?**協議原生並列支援兩種**部位類型。

**Binary Position**——方向性押注:「BTC 到期會 > $80,500 嗎?」一個 strike、一個方向,就決定贏或輸。Key 是 `oracle + 到期 + strike + 方向`。到期 ≥ K 拿 1,否則 0。

**Vertical Range**——區間型押注:「BTC 到期會落在 $80k 到 $82k 之間嗎?」兩個 strike,組成一個 range。Key 是 `oracle + 到期 + 低 strike + 高 strike`。到期 K₁ ≤ S ≤ K₂ 拿 1,否則 0。

V1 已經出貨的就是這兩種——都是協議原生原語。

實作層的小細節值得補:**Binary 與 Vertical Range 共用同一個 `RangeKey` 結構**(`range_key.move:16-20`):

```move
public struct RangeKey has copy, drop, store {
    oracle_id: ID,
    lower_strike: u64,
    higher_strike: u64,
}
```

Binary up/down 是用 **sentinel 邊界**編碼出來——`neg_inf = 0`、`pos_inf = u64::MAX`(`constants.move:46-49`):

| 工具 | 表達方式 |
| --- | --- |
| Binary up(`>K`) | `RangeKey { oracle, K, pos_inf }` |
| Binary down(`<K`) | `RangeKey { oracle, neg_inf, K }` |

換句話說:**Binary 是 Range 的特例,不是另一條獨立路徑**。協議只需要一套 RangeKey 的索引、結算與流動性邏輯,就能同時撐起方向性押注與區間押注——這對 LP 共享流動性、對 builder 組合策略,都是關鍵的簡化。

收尾:Binary 看起來像預測市場——但 Range 一出來,故事就不一樣了。下一頁攤開為什麼。

---

## Slide 10 · 從 Range 長出結構型商品

**畫面停留:約 1.5 分鐘**

把上一頁的結論獨立放大:**Range 是 Predict 從「預測市場」長成「選擇權基礎設施」的那一步**——有了 range,你就有了**價差**(call spread、put spread)的鏈上原料;再往上組就是結構型商品。

什麼叫結構型商品?**把不同 strike / 不同到期的選擇權當積木,拼出非線性、客製化的到期 payoff**。對技術受眾,我直接舉 TradFi 三個最典型的例子,用白話講:

- **本金保護型(Principal-Protected Note)**——「保證不賠本金,還有機會吃漲幅」。把 $100 投進去,到期至少還你 $100;標的漲了,額外給一段漲幅報酬。組法直觀:用 $95 買到期還 $100 的零息債券(本金鎖住),剩 $5 拿去買 call spread(吃漲幅)。**唯一付出的是「這 $100 放定存的利息」這點機會成本**——對保守客戶是殺手級賣點

- **區間累息(Range Accrual)**——「標的乖乖待在區間裡,我每天領利息」。設一個價區(例如 BTC $80k–$90k),只要當天收盤價落在區內,就累積一筆利息;脫離區間那天就不算。**不漲不跌也有錢賺**,適合盤整市。底料就是 range——這正是 Predict V1 已經出貨的那塊

- **Autocallable(自動贖回 / Snowball)**——「碰到觸發價就提前還本金 + 高息」。設一個觸發價(例如 BTC $100k),只要觀察日收盤 ≥ $100k,合約立刻自動贖回、給一筆事先談好的高息(年化常見 15–20%)。**亞洲私人銀行賣最兇的就是這種**——碰得到就贏一波,碰不到再等下個觀察日

這三類在傳統金融是私人銀行賣給高淨值客戶的主力產品線,**全球規模兆級美元**。鏈上至今做不出來,卡的不是需求,**而是缺 spread 這層底料——也就是 range**。

收尾:Predict V1 出貨的 range,就是這條路線的第一塊磚。

---

## Slide 11 · 核心架構:三條金流 × 一個共享池

**畫面停留:約 6 分鐘(含 stages 4–6 的預言機與 PLP 創新)**

知道協議在處理什麼之後,看它在鏈上**用哪些物件、怎麼串起來**。

讀法:**左邊是 Trader、右邊是 LP,兩邊各有一條路徑,最後都匯流到底下的 PoolVault**。

**先看最上頭那一排——兩個 globals,一併叫 Predict:**

- **ProtocolConfig**(shared · 協議主物件)——協議的**總機**。所有對外的 mint / redeem / supply / withdraw 都從這裡進門,**policy、pause、fees** 這些「協議參數」也掛在它身上。官方在 docs 裡直接稱它為 `Predict` 物件
- **Registry**(shared · 索引與父物件)——協議的**目錄與管理層**。管理員從這裡建立 oracle、白名單 quote 資產;所有市場與 oracle 物件都以它為**父容器**對外查找

白話講:**ProtocolConfig 管「現在能不能交易、怎麼收費」**;**Registry 管「有哪些資產、哪些 oracle 可以用」**。**每個 PTB 都得把這兩個 shared object 一起帶進來**——少了任一個,合約根本拼不出當下的市場狀態。

**再看中間那三個工作物件,以及底下那個池:**

- **PredictManager**(per-account · owned)——你的選擇權帳戶,**錢 + 倉位**都在這。Trader 端入口
- **ExpiryMarket**(per-到期日 · shared)——對應一個到期日的市場物件,持 `lp_cash` 與 strike matrix
- **Oracle**(external · 定價輸入)——Pyth 喂現價、Block Scholes 喂理論價
- **`Coin<PLP>`**——LP 份額代幣,**可轉讓**。LP 端入口
- **PoolVault**(shared · 流動性核心)——**所有市場結算的同一個池**。持 idle DUSDC、PLP treasury cap、fees

**再看金流——三條:**

1. **MINT / REDEEM**——Trader 從 Manager 走到 Market,開倉或結算
2. **GROW / SHRINK / COMPACT**——Market 跟 Vault 之間的資金搬運,把抵押品鎖住或釋出。這條對使用者是隱形的
3. **SUPPLY / WITHDRAW**——LP 拿 `Coin<PLP>` **直戳 Vault**,不經過任何 Market

這頁真正要強調的設計選擇是這個:**LP 不必進到任何特定市場,他直接餵 Vault**。Trader 開的所有市場、跟 LP 供的流動性、結算,**全部在同一個 Vault 匯流**。

**架構圖下方補一條 user flow——一筆 binary mint 的生命週期就五步:**

`01 取得市場資料` → `02 建立 / 取得 Manager` → `03 存入 DUSDC` → `04 off-chain 預覽` → `05 送出 predict::mint`

兩個小細節:

- **binary 與 range 走同一條 mint / redeem 流程**,差別只在 market key——builder 寫一次邏輯就同時支援兩種產品
- 鏈上 tap → bet → settle **< 400ms** 完成。快到 app 可以感覺像遊戲——對「把預測市場做成消費級體驗」是關鍵

**結構前提**:**使用者與 LP 共用同一個 Vault**——這是接下來「預言機接入」與「PLP × 選擇權創新」兩段故事的共同前提。沒這個共用,後面的故事根本說不通。

---

### Stage 5 — 預言機:Block Scholes 接入(畫面左下出現)

定價這件事,Predict 跟其他預測市場最大的不同就在這。

它不靠群眾報價,而是接入 **Block Scholes**——一家 FCA(英國金融行為監理局)監管的機構級加密衍生品分析平台,提供即時隱含波動率曲面跟選擇權定價。

隱含波動率曲面把不同 strike 跟到期的隱含波動率畫成一張立體曲面,等於市場對「未來波動」的完整定價地圖,所有選擇權公允價都從這張曲面推出來。

鏈上對應物件是 **OracleSVI**。每個 oracle 對應一個資產加一個到期。協議用它算每個 strike / 方向的公允價,並推導 ask / bid 跟生命週期狀態。

預言機也定下幾個關鍵約束——**ask 上限 $0.99**(隱含機率 5–95%)、**min ask $0.01**(過深 OTM 擋下)、**tick grid**(strike 必須落在 oracle 格點上,BTC tick = $1)。這幾條從 SDK 看像「規則」,實則是**風險控管的鏈上體現**,防止 vault 暴露在無法定價的尾端風險上。

更重要的是這件事本身:**這是把機構級選擇權定價,第一次帶進完全鏈上、次秒結算的環境**。

---

### Stage 6 — 真正的創新:PLP 共享 Vault(畫面右側出現)

來到我覺得最關鍵的一段。

LP 共享池**不新**。選擇權定價**也不新**。創新在**結構**——用一個共享 vault 把兩者接起來。

**傳統鏈上選擇權**:LP / maker 寫一個部位就要鎖一筆抵押品 cover max payout,這筆錢綁死在那個市場直到結算——不能同時 cover 別的 strike、別的資產、別的到期。結果是資本效率超差,每個新市場都得重新引導流動性。

**DeepBook Predict**:LP 供應 quote → mint PLP(vault 份額)。**所有市場**的部位都從同一個 vault 結算。一個 LP 進來,他的資本同時支撐 BTC binary、ETH binary、未來的 spread、未來的結構型商品——抵押品保持**活躍**。

這帶來兩件事:

1. **解掉冷啟動**——每個 Sui builder 都能用上原本需要大量時間跟資本才能建起的選擇權基礎設施。不用從零招攬造市商,開個市場、流動性就在那
2. **提款受限**——當然不是完全自由的。Vault 必須保留足夠 quote 覆蓋未平倉部位的 max payout,提款限制器把關

**這頁的 punchline**:**創新不在發明 LP 池或選擇權定價,而在用一個共享 vault 把兩者接起來,讓選擇權流動性第一次能被重複利用。**

這就是前面說「使用者與 LP 共用同一個 Vault 是結構前提」的原因。沒有這個共用,PLP × 選擇權這個故事根本說不通。

---

## Slide 12 · 路線圖 & 現況限制

**畫面停留:約 2 分鐘**

聽起來很厲害,那現在可以用了嗎?**還很早**。把路線圖跟現況限制並排放,因為對技術受眾來說,誠實鋪陳比 over-promise 重要。

**路線圖**:

- **Testnet 已上線**——V1 binary + vertical range 已在 testnet 上跑,Block Scholes 提供預言機。**現在就能整合**
- **可組合 call / put / spread**——這一步上來之後,結構型商品就變成 UX 問題,而不是基礎設施問題
- **Mainnet**——今年稍晚,第一方 app 會跟原語一起推出

**但現況限制要說清楚**:

- **僅 Sui Testnet**——package ID、object layout 都還只是整合目標,mainnet 前可能變更
- **產品只有 binary + vertical range**——call、put、spread 等高階組合還沒到
- **quote 只有 DUSDC,沒有公開 faucet**——只有 Mysten 能 mint,這是新手最大的卡點
- **資產覆蓋極窄**——實務上主要是 BTC

收尾:現在的 Predict 是**一個窄但真實的整合面**。**拿來驗證整合,不是拿來上線**。對技術受眾講這種誠實,反而是加分。

---

## Slide 13 · Live Demo

**畫面停留:Demo 約 2–3 分鐘**

接下來切到終端機去 demo。

要證明的就一件事:**在這些限制下,完整生命週期仍然跑得通**。

沒有 faucet、只有 BTC——但 **deposit → mint → redeem → LP supply → LP withdraw** 五個動作,全部跑得通。一行指令、一個 PTB、< 400ms 確認、鏈上 settle。

> *切到終端機,跑 live demo*

---

## 收尾語(demo 後)

如果今天只想記住一件事:

> **DeepBook Predict 不是另一個 Polymarket。它是讓 builder 在 Sui 上蓋 Polymarket、以及更多東西的基礎設施——而那個「更多」才是重點。**

如果想記住第二件事:

> **PLP 共享 vault 是它跟其他鏈上選擇權真正的差異——把流動性從每個部位裡釋放出來,讓資本能被重複利用。**

歡迎提問。

---

## 講者備忘(不會講出來的)

- 整體節奏:前段(slide 2–7)鋪陳「現有預測市場 → 痛點 → 視角換成選擇權 → 量化 → 破除誤解」,**比較感性的 framing**;中段(8–10)是技術細節 + 商業想像力(Position 類型 → Range → 結構型商品),**節奏放穩**;slide 11 是 climax(架構 + 預言機 + PLP 創新一氣呵成);12–13 拉回誠實感跟 demo。
- Slide 2 是「為觀眾建立 Polymarket 心智模型」,不要陷在 Kalshi / Augur 的細節辯論——這兩個只是輕點,證明「整個品類都長這樣」,**講完就過**。
- Slide 3 三痛點要**有節奏地一個一個攤開**——每個痛點先點原因再說後果。
- Slide 4 是橋段,只有一句話,**講完就切下一頁**——它是給後面 payoff shapes 鋪框架用的。
- Slide 6 跟 Slide 3 是**呼應結構**——Slide 3 給質性痛點、Slide 6 給量化證據。可以回頭指 slide 3(「還記得剛剛那三個痛點嗎?$100M 平坦 TVL 就是它們的後果」)。TVL 拆解表只是補強「不是某個產品做不好」這個論點,**不要逐家唸**——挑 Aevo($90M 還是龍頭就這麼小)、Ribbon(曾經 > $100M 現在大幅下降)兩個點即可。
- Slide 7 是進入技術細節前的最後一次澄清——重點在「app vs primitive」這個區分,對照表只是輔助,**不要陷在六個 row 一個一個唸**。
- Slide 8 從「三大原語」改成「三個交集」——重點不是各自有什麼,**重點是兩兩交集 + 三者共集**打開的設計空間。Venn diagram 的中心(結構型商品)是 punchline。
- Slide 10 三個結構型商品**不要逐字唸定義**——挑一個觀眾最有感的講透(技術受眾通常吃「本金保護型」的零息債券 + call spread 組法),其他兩個一句話帶過即可。重點是「TradFi 兆級美元市場 + 鏈上做不出來 + 卡在缺 spread」這條因果鏈。
- Slide 11 是這場簡報的核心舞台——六個 stage 一條龍:1–3 三條金流、4 user flow、5 預言機、6 PLP 創新。如果時間緊,stage 4 可直接帶過「五步、< 400ms、binary 跟 range 對稱」,主力放 stages 5/6。
- 如果觀眾偏 LP / 金融,slide 11 stage 6 多花 30 秒講提款限制器的設計。
- 如果觀眾偏 builder / SDK,slide 11 stage 4 多花 30 秒講「binary 與 range 對稱路徑」的意義。
- Demo 階段:先確認 manager 有錢、oracle 還沒到期;mint 完展示 suiscan、再 redeem 一次給觀眾看完整 lifecycle。
- 萬一 oracle 中途到期:**就講「這就是現況的真實限制」**——把意外變成 talking point。
