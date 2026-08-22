# Manpower Planner：重建設計

| 欄位 | 內容 |
| --- | --- |
| 文件狀態 | 已核准的重建設計 |
| 日期 | 2026-08-21 |
| 方案 | 全新事件紀錄 + 最佳化引擎（方案 C） |
| UI 方向 | 工作先行的週視圖 + Job cards + 資源側欄 |
| 適用範圍 | 取代現有測試 vertical slice 的領域模型、資料層及 Planner workflow |

本文件是現有 01 Plan/OHLR-DUAT Product Spec.md、01 Plan/OHLR-DUAT Development Spec.md 及 .scratch/phase-2-persistence/design.md 的重建設計。舊文件描述的是 SQLite／PlanningService 的 v1 baseline；本文件在角色、資格、Roster、planned／actual、事件帳本及 optimizer 方面取代其假設，但保留 Electron shell、React、Fluent UI、typed IPC、Excel staging、revision／audit 等可重用基礎。

## 1. 設計目標及非目標

### 1.1 目標

- 讓 Planner 以 Job 為中心安排一整週，再深入某一晚的角色及人員。
- 以 Staff No. 統一 Qualification、Roster、planned、actual 及歷史匯入身份。
- 保存原始 Excel 值及每次資料決定，避免公式漂移或模糊配對造成不可追溯結果。
- 以 immutable snapshot 驅動可解釋 optimizer，讓 Planner 比較多個可行方案。
- 將 Job Role、Qualification、Allocation、Planned Duty、Actual Duty 分開建模。
- 讓 projection 可以從事件全量重建，並可按資料版本重現舊計劃。

### 1.2 非目標

- 不把 optimizer 變成無人監督的安全決策者。
- 不遷移現有 SQLite database，因為它只含測試內容。
- 不直接把舊 Excel 的錯誤多角色或 Counta 統計變成正式規則。
- 不在第一版加入雲端同步、正式 MTR 平台整合、薪酬或自動疲勞法規判斷。

## 2. 設計原則

### 事件是寫入真相

所有改變都由 command 產生 append-only event。projection、solver input 及畫面 state 都是可丟棄的讀模型。修正以補償事件表達，不覆寫舊事件。

### 先保留證據，再決定能否使用

來源資料先以 source artifact、raw value 及 provenance 保存，然後才做身份、資格或 Roster mapping。未知資料可以阻擋使用，但不能在匯入時消失。

### 先驗證可行性，再最佳化偏好

solver 先套用硬性安全及資料完整性約束，再以保留、最少變更、均衡利用率等軟性目標排序。不可行時必須指出最小可理解的衝突集。

### 人類保留發布權

proposal 只是候選方案；採納、部分採納、override 及 publish 都是明確 command，且需要相應權限。

## 3. 系統邊界及元件

~~~mermaid
flowchart LR
  UI[React 工作先行 Planner] --> IPC[Typed IPC facade]
  IPC --> CMD[Main command gateway]
  IPC --> QRY[Main query gateway]
  CMD --> AGG[Aggregate validators]
  AGG --> ES[(SQLite append-only event store)]
  ES --> PROJ[Projection workers]
  PROJ --> READ[(Read models / snapshots)]
  QRY --> READ
  ES --> SNAP[Immutable planning snapshot]
  SNAP --> OPT[Optimizer worker]
  OPT --> PROP[Explainable proposal]
  PROP --> UI
  SRC[Excel source artifacts] --> STAGE[Import staging + reconciliation]
  STAGE --> CMD
~~~

### 3.1 Renderer

Renderer 只持有 query state、表單草稿及互動狀態。它只能呼叫固定的 typed IPC facade，不能取得 ipcRenderer、SQLite connection 或 Excel reader。拖放、鍵盤選擇及表單提交最後都轉成同一組 application commands。

### 3.2 Main process

Main process 擁有 event store、aggregate validation、projection coordination、source artifact registry、backup／restore 及權限檢查。每個 command 在同一 transaction 中檢查 expected sequence、追加事件及更新必要的同步 projection。

### 3.3 Optimizer worker

Optimizer 在隔離 worker 中執行，不阻塞 UI 或 command gateway。它只讀取 immutable snapshot，不直接追加事件。第一版透過 OptimizationPort 隔離 CP-SAT／MILP solver；若 native／WASM solver 不可用，deterministic fallback 必須使用相同硬性規則，不能為了產生結果而繞過驗證。

### 3.4 SQLite

SQLite 是本機 event store 及 projection store，不是舊 v1 snapshot schema 的延伸。event table、aggregate sequence、hash chain、snapshot metadata、projection tables 及 optimizer run artifact 分開保存。首次啟動建立全新資料目錄及 schema；舊 database 不讀、不回填、不刪除使用者來源檔。

## 4. Event Store 設計

### 4.1 Event envelope

每一筆事件至少有以下欄位：

~~~json
{
  "eventId": "evt_01J...",
  "aggregateType": "Plan",
  "aggregateId": "plan_2026-08-21",
  "sequence": 42,
  "eventType": "AllocationAccepted",
  "schemaVersion": 1,
  "effectiveAt": "2026-08-21T00:00:00+08:00",
  "recordedAt": "2026-08-20T18:42:17+08:00",
  "actor": { "id": "planner-local", "role": "Planner" },
  "source": "planner-ui",
  "sourceReference": "scenario:A",
  "correlationId": "cmd_01J...",
  "causationId": "evt_01J...",
  "idempotencyKey": "drop:staff-321508:job-C9021:cp:1",
  "previousHash": "sha256:...",
  "hash": "sha256:...",
  "payload": {}
}
~~~

effectiveAt 是業務日期，recordedAt 是系統接收時間。資格有效性、Roster 及 planned／actual 報告使用 effectiveAt，而 audit timeline 使用兩者。

### 4.2 Aggregate streams

| Stream | 代表內容 |
| --- | --- |
| Staff | 建立 Staff、姓名 alias、grade、team membership、停用 |
| Credential | 證書、角色 grants、scope、續期、暫停、撤銷 |
| Roster | grade default、team baseline、staff override、raw code mapping |
| WorkDemand | TN、Project、Line、Work、Possession、PA Work、Locations、requirements |
| Plan | 日期、scenario、reserve、lock、policy version、狀態 |
| Allocation | proposed、accepted、replaced、released、SPC support link |
| Duty | planned、confirmed、actual、substituted、absent、cancelled、corrected |
| ImportReconciliation | source artifact、alias decision、unknown code、exception resolution |
| OptimizationRun | snapshot、solver、weights、proposal、結果及 stale 狀態 |

### 4.3 事件處理

~~~text
command
  -> DTO/schema validation
  -> permission check
  -> expected aggregate sequence check
  -> domain invariant check
  -> append event + hash in one transaction
  -> update projections / outbox
  -> return new sequence and read snapshot
~~~

重送同一 idempotencyKey 必須返回原結果，不可產生重複分配。sequence 不符時返回 CONCURRENCY_CONFLICT，renderer 重新載入 snapshot 並要求 Planner 比較變更。

## 5. 領域模型

### 5.1 Staff、Credential、Role

~~~text
Staff (identity)
  ├─ StaffAlias[*]
  ├─ TeamMembership[*] (effective interval)
  ├─ GradeAssignment[*]
  └─ Credential[*]
       └─ CredentialGrant[*] -> Role + Scope + QualificationVariant
~~~

Job Role 與資格分開：CP 是執行角色，CP(P)／CP(T) 是可用的資格 variant；SIL／DUAT 是 scope。SPC 沒有獨立資格限制，但仍是一個受 allocation policy 控制的角色 overlay。

### 5.2 Roster resolution

Roster projection 以 (staffId, workDate) 產生一個 EffectiveDuty：

1. 先取 grade default。
2. 有 team baseline 時覆蓋 grade default。
3. 個人日期格非空時再覆蓋 team baseline。
4. 保留 rawCode、來源層級、解析器版本及 mapping decision。
5. 未知 code 的 availability 是 unknown，供應數量為零。

複合 code 不壓成單一 shift。解析結果可同時有 Day、Night、AM、PM、training、leave、allowance 等 facets；只有 policy 明確判定能在目標時段工作的結果才是 confirmed available。

### 5.3 Work demand

WorkDemand 由 Job、Work、Location、Line group、Possession／PA Work 及 IsolationEarthingGroup 組成。RoleRequirement 使用下列欄位：

| 欄位 | 說明 |
| --- | --- |
| scope | Work、Job、Location 或 Isolation／Earthing group |
| role | AP、CP、NP、HSM、LOM 等；SPC 是 overlay |
| quantity | 所需人數 |
| requiredness | required、optional、enabled-required |
| qualificationPredicate | 例如 CP(P) OR CP(T) + scope match |
| enabledBy | template、planner、policy |
| policyVersion | 產生此需求的規則版本 |

### 5.4 Allocation 與 Duty

StaffAllocation 表示一名 Staff 在一個 Job 的佔用；RoleAssignment 表示其在某個 requirement 上履行的角色。兩者分離後，SPC 可用 supportsAssignmentId 連結至同一 Job 的 AP，而不需要把一人塞入一個固定角色欄位。

初始 invariant：

- 同一人不可同時擔任 AP 及 CP。
- 同一人不可跨 Job 重疊派遣。
- 只有 SPC 可以有第二個角色，而且最多一個；兩個角色必須位於同一 Job。
- SPC 必須支援另一名 AP，不可 supportsAssignmentId = self。
- SPC 不需要 AP／CP／其他獨立資格，但必須在目標時段是 confirmed available。
- actual duty 必須連結一個 planned duty；若無 planned 連結，必須由 Supervisor 建立例外事件。

## 6. Policy Registry

規則不是散落在 UI 或 solver 的 if 陳述式，而是有版本的 policy：

- qualification acceptance policy
- role requirement derivation policy
- roster availability policy
- line group／Possession conflict policy
- team／grade scheduling policy
- reserve and utilisation policy
- approval／override policy

已確認的初始 policy：

~~~text
IsolationEarthing.CP = CP(P) OR CP(T)
IsolationEarthing.NP = optional by default; enabled-required when planner/template enables
Possession.CP = CP(P)
PAWork.CP = CP(P) OR CP(T)
SPC = no qualification predicate; same-job one-overlay; supports AP
UnknownRoster = unavailable
WeeklyTwoJobTarget = disabled
~~~

Team Formation Excel 內的星期日、Possession line-group、特殊工作及 capacity 條件先以可編輯 policy 匯入；未啟用的 policy 不能暗中影響 solver。規則變更建立新版本，不修改舊計劃所引用的版本。

## 7. Optimizer 設計

### 7.1 輸入

Optimizer input 是 immutable PlanningSnapshot：

- snapshot event sequence 及 generatedAt
- active Job／RoleRequirements
- confirmed availability 及 unknown／unavailable exclusions
- credentials valid on work date
- locked allocations、reserved Staff、excluded Staff
- active policy versions
- objective weights 及 solver settings

### 7.2 約束層級

**硬性約束**：資格及 scope、Roster confirmed available、required role quantity、AP／CP 互斥、SPC support link、同 Job overlay 上限、跨 Job 時間衝突、Possession／PA Work acceptance、啟用後 NP required、互斥 Line group。

**軟性目標**：最少安全關鍵短缺、保留 key roles、最少變更鎖定以外的既有分配、均衡隊伍利用率、減少跨隊調動、最大化可安排 Job。每個目標都有顯示名稱及權重；不能只回傳一個無意義的總分。

### 7.3 結果及解釋

每個 proposal 保存：

- run id、solver version、policy versions、snapshot sequence
- status、objective breakdown、runtime、cancelled／timeout
- added／removed／moved assignments
- 每個 shortage 的 requirement、候選排除原因及最小衝突集
- reserve／utilisation 變化
- stale 判斷及需要重新試算的原因

draft_with_shortage 可供 Planner 研究，但 PlanPublished command 必須拒絕尚未解決的 required shortage，除非有有效 override。

## 8. UX 設計

### 8.1 視覺及互動方向

保留 Fluent UI 及 hybrid v4 的密集 operational language：DESIGN_VARIANCE 3、MOTION_INTENSITY 2、VISUAL_DENSITY 8。不使用 landing-page 卡片、裝飾性動畫或只為視覺效果的圖表。

### 8.2 工作先行佈局

~~~text
週控制列／同步狀態
        ↓
日  一  二  三  四  五  六（可點選）
        ↓
Job 1 | Job 2 | Job 3 ... | 當晚人員及容量側欄
~~~

- 中央 Job cards 內含 Locations、Isolation／Earthing points、動態角色槽位及 Work-level crew。
- 右側按 S1-S5 及支援／主工作隊分組，顯示 Staff No.、Roster raw code、資格及已派狀態。
- 拖放與鍵盤 command menu 走同一驗證路徑。
- 容量摘要留在側欄及 impact drawer，不搶走 Job 配置焦點。
- 每日 projection 必須是真實資料；日期未載入時顯示 loading／empty，而不是偽造數字。

### 8.3 操作狀態

~~~text
draft -> optimizing -> proposal-ready -> approved -> published
published -> in-progress -> reconciliating -> closed
~~~

stale 可在 proposal-ready 任何時候出現；必須重新試算或 Supervisor 明確重新批准。發布後的修正追加 event，不靜默改變既有 assignment。

### 8.4 可及性及錯誤

- blocking、warning、info、pass 均有文字及圖示，不能只靠顏色。
- 每個錯誤顯示 Job／Location、人員、規則、資料證據、修正建議及 override 要求。
- 支援鍵盤選擇人員、搜尋、替代拖放及 focus recovery。
- 適用 prefers-reduced-motion；動畫只用於拖放回饋、proposal 狀態及載入轉換。

## 9. Import／Reconciliation 設計

~~~text
source file -> hash -> worksheet inspection -> raw staging rows
           -> normalization -> identity／code mapping
           -> validation issues -> human decisions
           -> accepted facts/events -> projections
~~~

### Qualification

- 以更新日期選取最新有效 worksheet，但保留所有來源 worksheet metadata。
- 合併的 CP(P)／CP(T) 日期還原成一張 credential 的多個 grant。
- --、blank、非標準文字 expiry、逾期及 scope ambiguity 各有明確 issue code。
- NP、HSM、LOM 等非 AP／CP 資格不可再映射成 OTHER 後丟棄。

### Roster

- 先讀 OHLR DUAT staff／team 結構，再讀月份表的 baseline／override。
- 保存 T01、D+N、HR+N0、ALAM、OTD 等 raw code。
- code mapping 未完成時 availability = unknown，供應 = 0。
- #REF!、#N/A、1900 日期及月份範圍漂移為 blocking import issues。

### Job Role Record

- 原表橫向角色欄轉成一列一個 role assignment candidate。
- TN、Line、Work Nature、姓名及原欄位位置全部保留。
- 未來日期不自動等於 actual；先進 legacy_planned_candidate。
- AP+CP、非 SPC 多角色及跨 Job 重複只作 legacy exception，不能反向放寬新 policy。

## 10. 新資料庫與重建

現有測試 database 不需保留。安裝新版本時：

1. 建立新的資料目錄及 event schema。
2. 建立第一個 local actor／permission profile。
3. 由 Excel source artifacts 重新匯入 Staff、Qualification、Roster 及歷史 Job Role Record。
4. 執行 projection rebuild，輸出 unresolved exception report。
5. Planner 解決必需的身份、Roster 及 policy issues 後才可發布。

不做舊 schema backfill，也不提供把測試計劃直接轉成新計劃的 migration path。若日後有正式資料庫，須另立受批准的 migration project，而不是沿用此假設。

## 11. 備份、權限及可觀測性

- Planner 可建立 draft、編排及執行 optimizer。
- Supervisor 可採納、override 及 publish。
- Operations 可輸入 actual、替更及更正申請。
- Qualification/Roster Admin 可維護 source mapping 及 policy inputs。
- Auditor 只讀事件、projection、source artifact 及報告。

每次 command、solver run、import、projection rebuild、backup、restore 都有 run／correlation id、actor、duration、input sequence 及錯誤細節。備份必須包含 event log、projection snapshot、source metadata、policy registry 及 checksum；restore 先在新目錄驗證，不能原地覆蓋。

## 12. 主要設計決策紀錄

| 決策 | 選擇 | 理由 |
| --- | --- | --- |
| 重建方式 | 全新 event store + optimizer | 舊模型混合角色、資格、排工及實績，無法靠 enum 修補 |
| 舊 SQLite | 不遷移 | 目前只有測試內容，保留只會增加錯誤語意 |
| 寫入模型 | append-only events | 可追溯、可補償、可重建 projection |
| SPC | 無資格限制；同 Job 一個 overlay；支援 AP | 符合已確認規則，同時避免跨 Job 重複派遣 |
| CP for Isolation/Earthing | CP(P) 或 CP(T) | 已確認的業務決策 |
| NP | 預設 optional，啟用後 required | 讓 Planner／模板決定特殊工作需求 |
| Unknown Roster | 不計入供應 | 避免把未理解的 code 當成安全可用 |
| UI 主流程 | 工作先行 | Planner 先選日期及 Job，再由容量側欄協助配置 |
| 每週 2 Job target | 不啟用 | 使用者明確要求不納入新規則 |

## 13. 交付風險及緩解

| 風險 | 緩解 |
| --- | --- |
| Roster code 語意未完成 | raw code + mapping queue；未知不供應 |
| 姓名與 Staff No. 不一致 | alias confidence + 人工確認；未確認不投影 |
| Solver 過度最佳化 | hard／soft policy 分離、proposal 不自動發布、golden tests |
| 事件及 projection 漂移 | schema version、replay test、snapshot checksum |
| 規則仍會改變 | policy registry、effective date、舊計劃鎖定版本 |
| Planner 不信任黑盒結果 | proposal diff、每項排除原因、資料版本及可取消／重跑 |

