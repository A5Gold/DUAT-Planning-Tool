# Manpower Planner：產品規格

> 文件定位：2026-08-21 reconstruction current target。它取代舊 v1 baseline 的產品假設，但不改寫 `01 Plan/` 內的歷史文件。

## 1. 產品定位

Manpower Planner 是供 Planner、Supervisor、Operations 及 Auditor 使用的離線優先 Windows 決策工具。它不只是把人名填入夜更表，而是把「工作需求、資格有效性、Roster 可用性、角色分配、保留人力及實際履職」放在同一個可追溯模型中，協助 Planner 在發布前回答：

1. 這一晚有哪些 Job 及角色需求？
2. 哪些人員在工作日期真正可用，而且具備有效及適用資格？
3. 哪些工作組合可行，若人手不足，短缺的確切原因及影響是甚麼？
4. 發布後實際由誰履職，與原定計劃有甚麼差異？

產品採用全新 append-only event store 及可重建 projection。現有程式的 SQLite database 只含測試資料，不作遷移或回填；新版本首次啟動時建立全新的 event store。參考 Excel 原始檔則作為 source artifact 匯入，保留原始值、hash 及對帳歷史。

## 2. 使用者及工作目標

| 使用者 | 主要任務 | 成功結果 |
| --- | --- | --- |
| Planner | 按週檢視工作，選擇一晚，為 Job 配置角色及一般人員 | 能在發布前看清可行性、短缺及保留影響 |
| Supervisor | 審批例外、採納最佳化方案、發布計劃 | 每項例外都有理由、期限及 audit |
| Operations | 核對預定與實際履職、輸入替更及取消 | 歷史 Job Role Record 可重現且可分析 |
| Workforce／Qualification 管理員 | 維護 Staff、別名、資格、證書及有效期 | 到期、撤銷及未知身份不會被靜默忽略 |
| Roster 管理員 | 維護 team baseline、grade default、個人 override 及 code mapping | 未確認 Roster code 不會被當作可用人手 |
| Auditor | 查閱事件、來源檔、決定及更正 | 可由 snapshot 及 event sequence 重建任何計劃 |

## 3. 產品原則

### 工作先行

Planner 的主要工作是配置 Job，而不是先管理抽象容量。首頁先顯示週條及每日 Job；點選日期後，中央區展示 Job cards，右側以容量側欄支援決策。

### 安全規則優先於最佳化

Optimizer 只提出可解釋的候選方案，不會自動發布。任何硬性安全規則失敗都必須在發布前解決，或由具權限的人員建立有期限的明確例外。

### 原始資料不丟失

Excel raw code、合併儲存格語意、非標準日期、未知資格及未配對姓名都要保留。系統可以拒絕使用資料，但不能把它靜默轉成另一個意思。

### Planned 與 Actual 分開

發布時建立 planned duty；工作後以 actual duty、替更、缺席、取消及更正事件核對。預定資料不會被實際結果覆寫。

### 可重現

每個計劃、proposal、override 及報告都記錄資料 snapshot、policy version 及 event sequence。舊計劃可按當時規則重現。

## 4. 核心工作流程

```text
匯入 source artifacts
  -> Staff identity reconciliation
  -> Qualification／Roster 對帳及例外處理
  -> 建立指定日期 planning snapshot
  -> Planner 建立 Job、需求、保留及鎖定分配
  -> Optimizer 產生一個或多個 proposal
  -> Planner 比較、部分採納或手動修訂
  -> 通過發布檢查並發布 planned duty
  -> 當晚確認 actual duty、替更及取消
  -> 產生容量、短缺、保留及利用率分析
```

週視圖永遠從 projection 載入真實資料。點選另一日期會取得新的 query snapshot，不以假資料填補尚未載入的日期。

## 5. 功能範圍

### 5.1 People and Organisation

- Staff No. 是不可變、跨來源的永久主鍵。
- 儲存正式姓名、歷史姓名、alias、grade、title、team membership 及有效日期。
- 支援停用、重新啟用、身份合併候選及人工確認。
- Job Role Record 的姓名只可透過已確認 alias 連結 Staff No.。

### 5.2 Qualification Registry

分開保存以下概念：

- Job Role：`AP`、`CP`、`NP`、`HSM`、`LOM`、`SPC`
- Qualification／credential：例如 `CP(P)`、`CP(T)`、AP、NP、HSM、LOM
- Scope／domain：例如 `SIL`、`DUAT`
- Credential grants：一張證書可授予多個角色或 scope
- Validity：`validFrom`、`validTo`、suspended、revoked、source reference

資格有效性一律按工作日期判斷，不使用登入日期、匯入日期或 `NOW()`。Qualification Excel 的合併儲存格視為同一證書授予多項資格；非標準 expiry 進入 exception queue。

### 5.3 Roster and Availability

每日可用性由以下優先順序合成：

```text
Grade default -> Team baseline -> Staff daily override
```

- 個人日期格空白時繼承 team baseline。
- 非空值是個人 override。
- S40 的星期一至五 Day、星期六及星期日 Rest 由 grade default 表達。
- 保留 raw roster code 及解析 facets：shift、availability、absence、training、allowance。
- 未知或未映射 code 的狀態是 `unknown`，不計入可用供應；只有完成正式 mapping 才能納入規劃。

### 5.4 Work Demand and Role Requirements

工作模型包括 TN、Project、Line group、Work nature、Possession、PA Work、Location、Isolation point、Earthing point 及可版本化的 `RoleRequirement`。角色需求可附加於 Work、Job、Location 或 Isolation／Earthing group。

`RoleRequirement` 至少包含 role、quantity、required／optional、scope、qualification predicate、啟用來源及 policy version。角色列由需求動態產生，不使用 AP(1)…AP(7) 等固定欄位。

### 5.5 Planning and Scenarios

- 支援週視圖、日期選擇、Job cards、scenario、鎖定分配及 reserve。
- 每個 scenario 是一組針對同一 snapshot 的 planning intent；採納前不影響已發布計劃。
- 若來源事件在 proposal 產生後改變，proposal 標記為 `stale`，必須重新試算或明確重新批准。
- 允許 Planner 先手動拖放，再要求 Optimizer 修補剩餘需求。

### 5.6 Optimizer

Optimizer 使用 immutable snapshot、編譯後 policy 及 constraint solver 產生候選方案。輸出包括方案差異、短缺原因、規則證據、objective 分數及 solver run id。候選結果可為：

- `feasible`
- `draft_with_shortage`
- `infeasible`
- `stale_snapshot`

Optimizer 永遠不能自行發布；Planner 或 Supervisor 必須採納並通過發布檢查。

### 5.7 Planned and Actual Duty

Job Role Record 採「預定 + 實際」雙層模式：

- planned：發布時建立，記錄預定 Job、Staff、Role、Location 及資料版本。
- actual：工作後確認實際履職、替更、缺席、取消及更正，並連結原 planned record。

歷史 Excel 中的未來日期先標示為 `legacy_planned_candidate`，不會自動當作 actual。

### 5.8 Capacity Analytics

分析 projection 按日期、Job、Role、Staff、Team 及 scope 提供：

- available
- qualified
- assigned
- reserved
- spare
- shortage
- planned utilisation
- actual utilisation
- substitution／absence rate
- 30/60/90 日資格流失造成的未來瓶頸

利用率的分母、保留政策及 overtime 是否計入，必須由 policy version 明確記錄；報告不可使用未標註的隱含口徑。

### 5.9 Import, Reconciliation and Audit

每份 Excel 先建立 source artifact（hash、檔名、工作表、讀取時間），再進入 staging。未配對 Staff、未知 Roster code、混合 TN、未知 Line、非標準日期及不合法多角色進入 exception queue。只有已解決或明確標記為 legacy 的 row 才可投影到正式資料。

### 5.10 Backup and Export

- 備份包含 event log、projection snapshot、source artifact metadata 及 checksum。
- Restore 於新資料目錄執行，先驗證 hash，再重建 projection。
- 匯出 planned／actual、容量及 audit 時要附 snapshot、policy version 及產生時間。

## 6. 已確認的業務規則

| 規則 | 產品行為 |
| --- | --- |
| Isolation／Earthing | AP 必填；CP 必填；CP(P) 或 CP(T) 均可；NP 預設 optional |
| NP | 由 Planner 或工作模板啟用後才變成發布前 required |
| Possession | CP(P) 必填 |
| PA Work | CP(P) 或 CP(T) |
| Special Case | HSM、LOM、NP 由模板或 Planner 啟用 |
| AP／CP 互斥 | 同一人不能同時履行 AP 及 CP |
| SPC | 無資格限制，但必須當晚可出勤；只可在同一 Job 兼任一個其他角色；必須連結另一名 AP，不可自我覆核 |
| Roster unknown | 不計入可用人力 |
| 主鍵 | Staff No. |
| Job Role Record | planned + actual |
| 每週三晚 2 Job Night | 不納入規則、目標或警告 |

Possession line-group 互斥、星期規則及其他 Team Formation 條件以 policy registry 管理；未被明確啟用的 policy 不會被硬編碼到 solver。

## 7. 非目標

- 不把最佳化結果自動當成發布計劃。
- 不從模糊姓名配對後靜默建立 Staff。
- 不把未知 Roster code 自動猜成夜更或可用。
- 不把歷史 Excel 的錯誤兼任組合直接轉成新規則。
- 不遷移現有測試 database。
- 不以每週三晚 `2 Job Night` 作硬上限或最佳化目標。
- 第一版不追求全自動排工；Planner 仍負責安全判斷及例外批准。

## 8. 成功指標

第一版切換前必須能夠：

1. 以 Staff No. 對帳四份參考 Excel，並列出所有 unresolved mapping。
2. 重現 team roster inheritance、S40 grade default 及未知 code 不可用。
3. 為動態 AP、CP、NP、HSM、LOM、SPC requirements 產生可解釋的驗證結果。
4. 在固定 snapshot 上重複得到相同 optimizer proposal 或相同不可行原因。
5. 保存 planned + actual Job Role Record，辨識替更、缺席及取消。
6. 提供按晚、Job、Role、Team、Staff 的 capacity、shortage、reserve、utilisation。
7. 完成 backup、restore、projection rebuild，且不修改來源 artifact。
8. 任何 unresolved exception 都不會被靜默接受。

## 9. 詞彙表

| 詞語 | 定義 |
| --- | --- |
| Job Role | 當晚在工作中履行的角色，例如 AP、CP、NP、HSM、LOM、SPC |
| Qualification | 證書或授權所授予的角色、P/T 類別及工作 scope |
| Allocation | 把 Staff 指派到 Job／Location／Work 的關係 |
| Planned Duty | 發布時預定由誰履行哪個角色 |
| Actual Duty | 工作後確認實際履行、替更或缺席 |
| Roster baseline | Team 或 grade 的基礎更表 |
| Roster override | Staff 在某日期明確填入的更表值 |
| Snapshot | 某一 event sequence 下可重現的規劃輸入 |
| Proposal | Optimizer 針對 snapshot 產生、尚未發布的候選方案 |
| Exception queue | 需要人工對帳、映射或批准的來源資料清單 |
