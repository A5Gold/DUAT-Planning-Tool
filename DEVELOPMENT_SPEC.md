# Manpower Planner：Development Spec

| 欄位 | 內容 |
| --- | --- |
| 文件狀態 | 已核准的 reconstruction development spec |
| 日期 | 2026-08-21 |
| 產品 | Manpower Planner |
| 目標架構 | Electron + React + typed IPC + SQLite event store + optimizer worker |
| 取代文件 | 01 Plan/OHLR-DUAT Development Spec.md 的 v1 baseline（只針對新重建範圍） |

本規格把 PRODUCT.md 及 DESIGN.md 轉成可實作、可測試的工程要求。現有程式及舊 SQLite database 只作參考；database 內容是測試資料，不納入 migration。第一版建立全新 event store，從 source Excel artifacts 重新匯入。

## 1. 工程邊界

### 1.1 必須保留的基礎

- Electron main process 擁有本機資料、匯入、備份及 command orchestration。
- React renderer 使用 Fluent UI 及工作先行的週／Job layout。
- preload 只暴露固定 typed facade。
- SQLite 使用版本化 migration、foreign key、transaction 及 busy timeout。
- Excel 匯入保留 staging preview、source hash、fingerprint 及 import audit。
- 所有 mutation 使用 expected sequence 或 idempotency key，避免並行覆蓋。

### 1.2 必須重建的部分

- 不再以 PlanningService 的固定 AP／CP／一般員工模型作為領域真相。
- 不再以一人一晚一筆 assignment 的 unique constraint 限制 SPC。
- 不再以 QualificationType enum 混合角色、P/T variant 及 SIL／DUAT scope。
- 不再把 Roster 缺資料視為可用。
- 新增 event store、projection、policy registry、optimizer、planned／actual duty 及 exception queue。

## 2. Functional Requirements

### 2.1 Identity and workforce

| ID | 要求 | 驗收 |
| --- | --- | --- |
| FR-001 | Staff No. 是不可變主鍵 | 同一 Staff No. 跨 Excel 可合併；姓名改變不新增身份 |
| FR-002 | 支援 StaffAlias 及人工 reconciliation | 未確認 alias 不能建立正式 allocation 或 duty |
| FR-003 | 支援有效日期的 team／grade membership | 指定工作日期可產生正確 team |
| FR-004 | 支援停用及重新啟用事件 | 停用 Staff 不出現在 confirmed available |

### 2.2 Qualification

| ID | 要求 | 驗收 |
| --- | --- | --- |
| FR-010 | Credential 與 CredentialGrant 分離 | 一張證書可授予多個角色或 scope |
| FR-011 | 保存 valid-from、valid-to、suspended、revoked | 工作日期前後的有效性結果可重現 |
| FR-012 | CP(P)、CP(T) 是 CP 的 qualification variants | Isolation／Earthing 接受任一；Possession 只接受 CP(P)；PA Work 接受任一 |
| FR-013 | 保存 SIL／DUAT 等 scope | scope 不符合時列為 blocking |
| FR-014 | Qualification 未知角色不得丟棄 | NP、HSM、LOM、非標準值進 exception queue |
| FR-015 | 到期警報按工作日期計算 | 提供 30／60／90 日 projection；不使用 NOW 作真相 |

### 2.3 Roster and availability

| ID | 要求 | 驗收 |
| --- | --- | --- |
| FR-020 | 合成 grade default -> team baseline -> staff override | 空白個人格繼承；非空格覆寫 |
| FR-021 | 保存 raw code 及解析 facets | 可回看原始值、解析器版本及 mapping decision |
| FR-022 | 未知 code availability = unknown | unknown 不計入 optimizer supply |
| FR-023 | 支援 Day、Night、AM、PM、leave、sick、training、allowance facets | 複合 code 不被壓成錯誤單一 shift |
| FR-024 | S40 grade default | 星期一至五 Day；星期六及星期日 Rest，除非有 override |
| FR-025 | Roster 匯入錯誤可逐 row 修正 | #REF!、#N/A、1900 日期及範圍漂移不可靜默提交 |

### 2.4 Work demand and policy

| ID | 要求 | 驗收 |
| --- | --- | --- |
| FR-030 | 建立 TN、Project、Line group、Work、Possession、PA Work、Location | 可由 Job card 編輯並保留 provenance |
| FR-031 | RoleRequirement 動態產生 | UI 不硬編 AP／CP 固定列 |
| FR-032 | Isolation／Earthing AP required、CP required | CP(P) 或 CP(T) 均可 |
| FR-033 | NP 預設 optional | Planner 或 template 啟用後才是 enabled-required |
| FR-034 | Possession CP(P) required | CP(T) 單獨不能滿足 |
| FR-035 | PA Work CP(P) 或 CP(T) | scope 及有效期仍須通過 |
| FR-036 | HSM、LOM、NP special requirements 可由 template 或 Planner 啟用 | 未啟用不阻擋；啟用後按 quantity 驗證 |
| FR-037 | Policy 有版本及 effective date | 舊計劃按原 policy 重播 |
| FR-038 | 每週三晚 2 Job Night 不建模 | 不產生硬阻擋、目標或警告 |

### 2.5 Allocation and SPC

| ID | 要求 | 驗收 |
| --- | --- | --- |
| FR-040 | StaffAllocation 與 RoleAssignment 分離 | 一名 Staff 可有主角色及一個 SPC overlay |
| FR-041 | AP 與 CP 不可同人 | command、solver、DB invariant 三層均拒絕 |
| FR-042 | 一般員工可在 Work 層級配置 | 不強迫放入 Location |
| FR-043 | SPC 無資格 predicate | 任何 confirmed available Staff 可作 SPC |
| FR-044 | SPC 只可同一 Job 兼任一個其他角色 | 跨 Job 或第三個角色為 blocking |
| FR-045 | SPC 必須支援另一名 AP | 不可 self-support；support link 必須存在 |
| FR-046 | 同一人不可跨 Job 重疊派遣 | 跨 Job overlap 為 blocking |
| FR-047 | 已鎖定 allocation 不可被 optimizer 靜默移動 | proposal 必須顯示差異並等待採納 |

### 2.6 Planning, optimizer and lifecycle

| ID | 要求 | 驗收 |
| --- | --- | --- |
| FR-050 | 週視圖從 projection 顯示每日狀態 | 不可對未載入日期使用假資料 |
| FR-051 | 點選日期載入 immutable planning snapshot | 顯示 event sequence、generatedAt 及 stale 狀態 |
| FR-052 | 支援 draft、scenario、lock、reserve、exclude | 所有改變有 command 或 event |
| FR-053 | Optimizer 回傳可行性、差異及每項短缺原因 | 不能只回傳總分 |
| FR-054 | Proposal 可完整採納、部分採納或拒絕 | 部分採納會產生明確 allocation events |
| FR-055 | snapshot 變更使 proposal stale | stale proposal 不能直接 publish |
| FR-056 | required shortage 未解決不能 publish | 有效 Supervisor override 才可例外 |
| FR-057 | planned + actual duty 分開 | actual 可連結 planned、替更、缺席、取消及更正 |
| FR-058 | 關閉計劃後只可追加更正 event | 不得直接 UPDATE 舊 duty |

### 2.7 Import, audit and backup

| ID | 要求 | 驗收 |
| --- | --- | --- |
| FR-060 | 每份來源檔保存 hash 及 worksheet／row provenance | 可從 exception 連回 raw source |
| FR-061 | 未配對姓名、未知 code、混合 TN、非法多角色進 exception queue | 未解決資料不會靜默進正式 projection |
| FR-062 | Import commit 重新檢查 source fingerprint | 源檔變更時 commit 失敗並要求重新 preview |
| FR-063 | Event log 及 projection 可完整 replay | 增量 projection 與全量 replay 相同 |
| FR-064 | 備份含 events、snapshots、source metadata、policy、checksum | 可還原至新資料目錄 |
| FR-065 | 不匯入現有測試 database | 新版本首次啟動為空 event store |

## 3. Domain contracts

### 3.1 Commands

| Command | 必要輸入 | 產生事件 |
| --- | --- | --- |
| CreateStaff / AddStaffAlias | staffNo、displayName、source | StaffCreated、StaffAliasAdded |
| GrantCredential / SuspendCredential / RevokeCredential | credential、grants、effective date | CredentialGranted、CredentialSuspended、CredentialRevoked |
| ObserveRosterCode / MapRosterCode | staff、date、rawCode、mapping decision | RosterCodeObserved、RosterCodeMapped |
| CreateWorkDemand / UpdateRoleRequirement | date、Job、requirement、policy version | WorkDemandCreated、RoleRequirementChanged |
| CreateScenario / LockAllocation / ReserveStaff | plan、scenario、target、reason | ScenarioCreated、AllocationLocked、StaffReserved |
| ProposeAllocation | snapshot id、solver settings | OptimizationRunStarted、ProposalCreated |
| AcceptProposal / AcceptProposalChanges | proposal id、change set | AllocationAccepted、AllocationReleased、AllocationReplaced |
| PublishPlan | plan id、expected sequence、override references | PlanPublished |
| RecordActualDuty / SubstituteDuty / CorrectActualDuty | planned link、actual staff／role、reason | ActualRoleRecorded、DutySubstituted、ActualRoleCorrected |
| ResolveImportException | issue id、decision、actor | ImportExceptionResolved |

所有 command 回傳：

~~~text
IpcResult<T>
  = { ok: true, value: T, sequence: number }
  | { ok: false, error: DomainError }
~~~

DomainError 至少分為 INVALID_REQUEST、NOT_FOUND、CONCURRENCY_CONFLICT、QUALIFICATION_INVALID、ROSTER_UNKNOWN、ASSIGNMENT_CONFLICT、REQUIREMENT_SHORTAGE、STALE_PROPOSAL、PERMISSION_DENIED、IMPORT_SOURCE_CHANGED、SYSTEM_FAILURE。

### 3.2 Queries

- GetWeekOverview(week)
- GetPlanningDay(date, scenario)
- GetRoleCapacity(date, scope)
- GetStaffImpact(staffId, date, proposedTarget)
- GetQualificationExpiry(window)
- GetRosterExceptions(dateRange)
- GetProposal(runId)
- GetDutyReconciliation(dateRange)
- GetAuditTimeline(aggregateId)
- GetImportBatch(batchId)

Query response 必須包括 projection version、source event sequence 及 generatedAt。

## 4. Event schema and projection requirements

### 4.1 Event envelope

欄位：eventId、aggregateType、aggregateId、sequence、eventType、schemaVersion、effectiveAt、recordedAt、actor、source、sourceReference、correlationId、causationId、idempotencyKey、previousHash、hash、payload。

要求：

- 同一 aggregate sequence 單調遞增。
- hash 覆蓋 canonical envelope 及前一 hash。
- event type schema version 變更只能新增 projector compatibility 或補償 event。
- event payload 不含未驗證的 renderer 任意 object；先經 DTO schema。

### 4.2 必要 projections

| Projection | 用途 |
| --- | --- |
| StaffCurrent | Staff、alias、team、grade、active interval |
| CredentialValidityByDate | 指定日期有效資格及 scope |
| EffectiveRosterByDate | baseline、override、raw code、availability |
| WorkDemandBoard | Job cards、Location、requirements |
| PlanBoard | scenario、lock、reserve、status、publish state |
| RoleCapacityMatrix | available、qualified、assigned、reserved、spare、shortage |
| ProposalHistory | optimizer input、結果、差異、stale |
| DutyReconciliation | planned／actual／substitution／absence |
| ImportExceptionQueue | 未解決 source issues |
| AuditTimeline | aggregate event chronology |

每個 projection 必須有 projector version 及 last applied sequence；支援從零重建及從 snapshot 繼續。

## 5. Optimizer contract

### 5.1 Port

~~~text
OptimizationPort.run(input: PlanningSnapshot, options: OptimizationOptions)
  -> AsyncIterable<OptimizationProgress>
  -> OptimizationResult
~~~

OptimizationResult 必須包含：

- status：feasible、draft_with_shortage、infeasible、stale_snapshot、cancelled、timeout
- allocations、unassigned requirements、conflict explanations
- objective breakdown，而非單一黑盒分數
- snapshot sequence、policy versions、solver version、run id
- runtime、seed、options、input checksum

### 5.2 約束及目標

硬性：

1. work-date qualification valid and scope match。
2. Roster availability = confirmed available。
3. required role quantity。
4. AP／CP different staff。
5. SPC same Job、最多一個 overlay、supports another AP、no self-support。
6. no overlapping cross-Job allocation。
7. Possession CP(P)；PA Work CP(P) or CP(T)。
8. enabled NP／HSM／LOM requirements。
9. active Line group／Possession conflict policy。
10. unknown Roster 不可作 supply。

軟性：

1. 優先保護 safety-critical roles 及 explicit reserves。
2. 最少變更非鎖定 allocation。
3. 均衡 team／staff utilisation。
4. 減少跨隊調動及 SPC overlay。
5. 在不違反上述條件下最大化可安排 Job。

### 5.3 取消、逾時及 stale

- UI 可取消 optimizer；worker 必須回傳 cancelled run，不寫 allocation event。
- 超過設定時間回傳 best-known proposal 及 timeout 標誌；不能假裝 optimal。
- Snapshot event sequence 不再是最新時，proposal 標記 stale。
- Solver crash 只產生 failed run audit，不改變現有計劃。

## 6. Import specification

### 6.1 Source artifact

SourceArtifact 欄位：artifactId、path、filename、sha256、fileSize、importedAt、readerVersion、worksheetMetadata、rawStorageRef。原始檔以 read-only reference 保存，commit 不修改 workbook。

### 6.2 Qualification.xlsx

- 以 CQA 更新日期選擇最新 worksheet，同時保存其他 worksheets metadata。
- Staff No. 是 identity key；姓名只作 display／alias。
- 合併 cell 的日期要展開到相關 CP(P)／CP(T) grant。
- --／blank 產生 no-grant fact，不是遺失 row。
- 非標準 expiry（例如帶備註日期或文字）為 warning 或 blocking issue，不能猜日期。
- scope、role、variant 分開保存；NP／HSM／LOM 不得轉成 OTHER 後丟棄。

### 6.3 2026 Roster.xlsx

- 解析 OHLR DUAT staff／team、Roster Legends 及月份表。
- 空白 staff cell 繼承 team baseline；非空 cell 是 override。
- S40 使用 grade default：weekday Day、weekend Rest。
- 保存所有 raw code；未知 code 解析為 unknown。
- 公式錯誤、1900 日期、月份範圍不一致進 blocking issue。
- 只有 confirmed available 才可被 optimizer 使用。

### 6.4 Job Role Record.xlsx

- Data Input 每個角色槽位轉成一個 candidate row，保存原欄位及 cell provenance。
- Counta 不作統計 ground truth；由原始槽位重算。
- 未來日期標記 legacy_planned_candidate；歷史日期才可進 actual candidate，但仍需人工確認。
- 姓名由 alias queue 對帳；無 Staff No. 的 row 不可靜默建立 Staff。
- AP+CP、非 SPC 多角色、跨 Job 重疊及混合 TN／Line 進 legacy exception。

### 6.5 Team Formation.xlsx

- Job arrangement、Planner Constraint、Job List、Possession Booking Logic 作為 policy source。
- 不把規則表當作 Staff formation roster。
- 每條 policy 保存 source sheet、cell range、effective date、active flag 及 owner。
- 尚未啟用的 policy 只可在管理頁檢視，不影響 solver。

## 7. UI and IPC specification

### 7.1 工作先行畫面

- 頂部：週控制列、資料同步／snapshot 狀態、publish state。
- 週條：Sunday 至 Saturday；每一格顯示 Job 數、shortage／unknown／published badge。
- 中央：Job cards，內含 dynamic requirements、Locations、Isolation／Earthing、Work crew。
- 右側：S1-S5 分組人員；顯示 Staff No.、Roster raw code、availability、qualifications、assigned Jobs。
- 容量：側欄摘要及 impact drawer；不取代 Job-first 主工作區。
- 拖放及鍵盤 command menu 呼叫相同 application command。
- 日期載入中、空白、錯誤及 stale 都要有明確畫面狀態。

### 7.2 可及性及密度

- Fluent UI controls、keyboard focus、aria labels、文字 status。
- 不只以紅／橙／綠區分；每個 badge 有文字。
- 拖放提供選擇式 fallback。
- 動畫強度低，支援 prefers-reduced-motion。
- 工作區可橫向滾動，右側人員欄在 desktop 及 929px 寬度仍可用。

### 7.3 IPC safety

- channel map 固定且 typed。
- main handler 先驗證 DTO，再載入 aggregate。
- renderer 不可傳入任意 SQL、event payload 或 normalized row。
- mutation 回傳新 sequence 及 refreshed projection。
- error mapping 不把 domain shortage 轉成 generic system error。

## 8. Security, backup and recovery

- 初次啟動建立 local actor；角色為 Planner、Supervisor、Operations、Qualification/Roster Admin、Auditor。
- 每個高風險 command 檢查 permission；Supervisor override 必須有 reason、expiry、policy reference。
- event、source artifact、backup 以 checksum 驗證；敏感資料不傳外部服務。
- backup before restore、before schema upgrade；restore 到新資料夾後再由使用者切換。
- event append、projection update、import commit 具 transaction atomicity。
- 應用程式中斷後可由 event sequence 及 replay 恢復。

## 9. Test specification

### 9.1 Domain and invariant

- AP／CP 互斥。
- SPC 同 Job 單一 overlay、support AP、不可 self-support、不可跨 Job。
- CP(P/T) acceptance、Possession CP(P)、PA Work CP(P/T)。
- NP optional／enabled-required。
- Isolation／Earthing 動態 group quantity。
- unknown Roster 不供應。
- lock、reserve、exclude、manual override 及 stale proposal。

### 9.2 Event and projection

- schema validation、canonical hash、sequence conflict、idempotency。
- event replay 與 incremental projector 結果完全相同。
- projection crash/restart、snapshot restore、schema version compatibility。
- correction event 不修改舊 actual／planned。

### 9.3 Import fixtures

使用四份參考 Excel 的縮小 fixtures 及原始 row snapshots，覆蓋：

- 合併 qualification cell。
- 非標準 expiry、#REF!、#N/A、1900 日期。
- team baseline／blank inheritance／staff override。
- unknown Roster code。
- staff alias、unresolved identity。
- Counta 漂移及固定欄位漏計。
- legacy planned candidate 及多角色 exception。

### 9.4 Optimizer golden and property tests

- 固定 snapshot、policy、seed 產生可重現結果。
- 每個 unassigned requirement 有至少一個可讀排除原因。
- 隨機資料不會產生違反 hard constraint 的 proposal。
- cancel、timeout、solver failure、stale 及 best-known proposal 行為一致。
- Proposal accept／partial accept 事件可由 replay 重建。

### 9.5 UI and release tests

Playwright／Electron E2E 覆蓋：

1. 建立新 event store。
2. 匯入 preview、處理 exception、commit。
3. 週條點選日期及 Job-first allocation。
4. 拖放與鍵盤人員配置。
5. optimizer proposal、差異、partial accept、publish blocking。
6. planned／actual、替更、缺席及更正。
7. backup、restore、projection rebuild。
8. Windows portable package 在可寫資料夾首次啟動及重啟。

## 10. Performance and reliability targets

- warm day projection load：95th percentile 小於 1 秒。
- 100 名 Staff、20 個 Job 的正常 optimizer：95th percentile 小於 10 秒；超時顯示進度且可取消。
- command append 及 synchronous projection：95th percentile 小於 250 ms（不含 optimizer）。
- replay 及 restore 產生清楚進度，不阻塞 renderer。
- 所有長時間工作都有 run id、進度、取消及失敗 audit。
- 應用程式無網絡時仍可編排、試算、備份及報告。

## 11. Implementation phases and tickets

### Phase 0：event foundation

1. Event schema、hash chain、sequence、idempotency。
2. SQLite event／snapshot／projection migrations。
3. typed command/query gateway、permission 及 audit。
4. replay、backup、restore skeleton。

### Phase 1：identity、qualification、Roster

1. Staff／alias／membership aggregates。
2. Credential／grant／validity projection。
3. Roster parser、inheritance resolver、unknown mapping queue。
4. Excel staging 及 source artifact registry。

### Phase 2：work demand 及 policy

1. Job、Work、Location、Line group、Possession、PA Work。
2. RoleRequirement derivation。
3. policy registry、version 及 effective date。
4. validation issue projection。

### Phase 3：Planner 及 allocation

1. 週視圖、日期 query、Job cards。
2. dynamic role slots、resource sidebar、drag／keyboard commands。
3. lock、reserve、exclude、scenario。
4. planned publish state machine。

### Phase 4：optimizer

1. PlanningSnapshot compiler。
2. OptimizationPort、worker lifecycle、progress、cancel。
3. hard constraint compiler、objective breakdown、explanation。
4. proposal diff、accept／partial accept、stale handling。

### Phase 5：operations 及 analytics

1. planned／actual、substitution、absence、correction。
2. capacity、shortage、reserve、utilisation projection。
3. expiry what-if、reports、export。
4. import history、audit search。

### Phase 6：切換驗收

1. 使用參考 Excel 完成一個完整週期。
2. Planner／Supervisor 逐項核對 proposal、publish、actual。
3. 完成 backup／restore／replay rehearsal。
4. 舊測試資料不進新 store；新版本以空 store 及已核准 source artifacts 開始。

## 12. Definition of Done

- 所有 FR-001 至 FR-065 有自動測試或可追溯的 E2E 驗收。
- 新 event store 可在乾淨 Windows 資料夾建立及重啟。
- 四份參考 Excel 可 preview，所有 unresolved issues 可列出、處理、重試。
- Planner 可由週條點選日期，於 Job cards 配置人員及角色。
- optimizer proposal 可重現、可解釋、可取消、可部分採納，且不會自動 publish。
- required shortage、unknown Roster、資格失效、AP／CP 衝突及 SPC 違規都能阻擋發布。
- planned／actual／substitution／absence 可由 event replay 重建。
- projection rebuild 與增量結果一致。
- backup／restore 通過 checksum、權限及資料完整性測試。
- portable build 在無網絡、無管理員權限的可寫資料夾正常工作。
- 文件、policy version、測試 fixture 及 audit output 隨版本發佈。

