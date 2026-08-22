import { useState } from "react";
import {
  Badge,
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Tab,
  TabList,
} from "@fluentui/react-components";
import { ArrowUpload20Regular, CheckmarkCircle20Filled, DocumentSearch20Regular, FolderOpen20Regular, Warning20Filled } from "@fluentui/react-icons";
import type { ImportKind, ImportPreviewDto, SelectImportFileDto, WorkbenchSnapshotDto } from "../application/ipcContract";
import type { ISODate } from "../domain/planning";

interface ImportWorkbenchProps {
  date: ISODate;
  onNotice: (tone: "success" | "error" | "warning", text: string) => void;
  onSnapshot?: (snapshot: WorkbenchSnapshotDto) => void;
  expectedRevision?: number;
}

function statusLabel(status: ImportPreviewDto["status"]): string {
  if (status === "valid") return "可提交";
  if (status === "has-warnings") return "有警告";
  return "有錯誤";
}

function importKindLabel(kind: ImportKind): string {
  if (kind === "qualification") return "Qualification";
  if (kind === "roster") return "Roster";
  if (kind === "job-role-record") return "Job Role Record";
  return "Formation";
}

function importErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  return message.includes("IPC response validation failed")
    ? "Excel 已讀取，但回傳資料未通過應用程式驗證。請查看預期結構與 Preview issues；若格式正確，請重新啟動桌面程式後再試。"
    : message || fallback;
}

export function ImportWorkbench({ date, onNotice, onSnapshot, expectedRevision = 0 }: ImportWorkbenchProps) {
  const [kind, setKind] = useState<ImportKind>("roster");
  const [filePaths, setFilePaths] = useState<Partial<Record<ImportKind, string>>>({});
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [acceptedRows, setAcceptedRows] = useState<Set<number>>(new Set());
  const [dragging, setDragging] = useState(false);

  const api = window.ohlr?.imports;
  const filePath = filePaths[kind] ?? "";
  const canPreview = Boolean(filePath.trim() && api);
  const isCellExpandedImport = kind === "roster" || kind === "job-role-record";
  const acceptedRowCount = preview?.rows.filter((row) => row.issues.every((issue) => issue.severity !== "error") && (isCellExpandedImport || acceptedRows.has(row.rowNumber))).length ?? 0;
  const setFilePath = (value: string) => {
    setFilePaths((current) => ({ ...current, [kind]: value }));
    setPreview(null);
  };
  const chooseFile = async () => {
    if (!api) {
      onNotice("warning", "目前以瀏覽器預覽模式執行；請在 Electron app 使用檔案選擇器。");
      return;
    }
    try {
      const result = await api.selectFile({ kind });
      if (!result.ok) {
        onNotice("error", result.error.message);
        return;
      }
      const selected: SelectImportFileDto = result.data;
      if (!selected.canceled && selected.filePath) {
        setFilePath(selected.filePath);
        setPreview(null);
      }
    } catch (error) {
      onNotice("error", importErrorMessage(error, "檔案選擇器無法開啟，請改用拖放或重試。"));
    }
  };

  const acceptDroppedFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      onNotice("error", "只接受 .xlsx Excel workbook。請重新選擇檔案。");
      return;
    }
    const electronPath = api?.getPathForFile(file) || (file as File & { path?: string }).path;
    if (electronPath) {
      setFilePath(electronPath);
      setPreview(null);
      onNotice("success", `已選擇 ${file.name}，可以產生 Preview。`);
      return;
    }
    onNotice("warning", "無法取得此檔案的本機路徑。請使用上方「選擇檔案」按鈕。");
  };

  const onDropFile = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    acceptDroppedFile(event.dataTransfer.files[0]);
  };

  const runPreview = async () => {
    if (!api || !filePath.trim()) return;
    setLoading(true);
    try {
      try {
        const result = await api.preview({ kind, source: { filePath: filePath.trim() } });
        if (!result.ok) {
          onNotice("error", result.error.message);
          setPreview(null);
          return;
        }
        setPreview(result.data.preview);
        setAcceptedRows(new Set(result.data.preview.rows.filter((row) => row.issues.every((issue) => issue.severity !== "error")).map((row) => row.rowNumber)));
        onNotice(result.data.preview.errorCount ? "warning" : "success", `已完成 ${importKindLabel(kind)} preview：${result.data.preview.rowCount} rows。`);
      } catch (error) {
        setPreview(null);
        onNotice("error", importErrorMessage(error, "無法產生 Preview，請檢查 Excel 格式後重試。"));
      }
    } finally {
      setLoading(false);
    }
  };

  const commit = async () => {
    if (!api || !preview) return;
    setCommitting(true);
    try {
      try {
        const result = await api.commit({
          date,
          scenario: { kind: "main" },
          expectedRevision,
          importId: preview.importId,
          acceptedRowNumbers: [...acceptedRows],
        });
        if (!result.ok) {
          onNotice("error", result.error.message);
          return;
        }
        onNotice("success", `Import batch ${result.data.batch.id} 已提交至本機 SQLite。`);
        onSnapshot?.(result.data.snapshot);
        setPreview(null);
      } catch (error) {
        onNotice("error", importErrorMessage(error, "無法提交匯入，請重新產生 Preview。"));
      }
    } finally {
      setCommitting(false);
    }
  };

  return (
    <section className="import-workbench" aria-label="資料匯入">
      <div className="import-heading">
        <div>
          <span className="section-kicker">DATA / IMPORT</span>
          <h2>資料匯入 staging</h2>
          <p>
            {kind === "formation"
              ? "Formation：建立 Staff No.、姓名、Team 及來源宣告的 AP／CP。"
              : kind === "qualification"
                ? "Qualification：更新指定工作日期可用的資格、有效期及例外資料。"
              : kind === "roster"
                ? "Roster：按月份展開每日更表；未知 code 會保留原值並且不可供排工。"
                : "Job Role Record：保存歷史 planned candidate、角色、工作日期及未解決姓名對帳。"}
            {" 先預覽、修正 blocking rows，再明確提交。"}
          </p>
        </div>
        <Badge appearance="tint" color={preview?.status === "has-errors" ? "danger" : "informative"}>inspect → normalize → validate → commit</Badge>
      </div>

      <div className="import-controls">
        <TabList selectedValue={kind} onTabSelect={(_, data) => { setKind(data.value as ImportKind); setPreview(null); setDragging(false); }}>
          <Tab value="qualification">Qualification</Tab>
          <Tab value="roster">Roster</Tab>
          <Tab value="job-role-record">Job Role Record</Tab>
        </TabList>
        <Field label="Excel 檔案路徑" className="import-file-field">
          <Input value={filePath} onChange={(_, data) => setFilePath(data.value)} placeholder="選擇 .xlsx 檔案" contentBefore={<FolderOpen20Regular />} />
        </Field>
        <Button appearance="secondary" icon={<FolderOpen20Regular />} onClick={chooseFile}>選擇檔案</Button>
        <Button appearance="primary" icon={<DocumentSearch20Regular />} onClick={runPreview} disabled={!canPreview || loading}>{loading ? <Spinner size="tiny" /> : "產生 Preview"}</Button>
      </div>

      <div
        className={`import-dropzone ${dragging ? "is-dragging" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
        onDrop={onDropFile}
        role="region"
        aria-label="Excel 拖放區"
      >
        <ArrowUpload20Regular />
        <span><strong>{filePath ? `已選擇：${filePath}` : "拖放 Excel 檔案到這裡"}</strong><small>也可使用上方「選擇檔案」按鈕；拖放不會開啟額外的檔案選擇器。</small></span>
      </div>

      {!api && <MessageBar intent="info"><MessageBarBody>瀏覽器 review mode 沒有 Electron IPC；啟動 desktop app 後可讀取本機 Excel。</MessageBarBody></MessageBar>}

      <details className="import-structure">
        <summary>上傳前查看預期 Excel 結構</summary>
        <p>系統會保留原始值並以工作表標題/欄位驗證格式；不符合時會列入 blocking issue，不會靜默猜測。</p>
        {kind === "qualification" && <ul><li>必須有 Staff No.、姓名/Team 及資格欄（AP、CP(P)、CP(T) 等）。</li><li>有效期按工作日期判定；空白、--、非標準日期會顯示 issue。</li></ul>}
        {kind === "roster" && <ul><li>必須有 Staff No. 與日期欄；每日 raw roster code 會保留。</li><li>AL (AM) / AL (PM) 代表 AL 半日；未知 code 會是 unknown，不能供排工。</li><li>Staff No. 不在 Formation 會顯示 UNKNOWN_STAFF_NUMBER，需先補入 Formation 或取消該列。</li></ul>}
        {kind === "job-role-record" && <ul><li>必須有工作日期、TN、Line、Work Nature、角色及原始姓名。</li><li>未確認姓名會保留為 unresolved，不會自動建立人員。</li></ul>}
      </details>

      {preview && (
        <div className="import-preview" data-testid="import-preview">
          <div className="import-summary">
            <div><span>Worksheet</span><strong>{preview.selectedWorksheet}</strong></div>
            <div><span>Rows</span><strong>{preview.rowCount}</strong></div>
            <div><span>可提交</span><strong>{preview.validRowCount}</strong></div>
            <div className="warning"><span>Warnings</span><strong>{preview.warningCount}</strong></div>
            <div className="error"><span>Errors</span><strong>{preview.errorCount}</strong></div>
            <Badge appearance="tint" color={preview.status === "valid" ? "success" : preview.status === "has-warnings" ? "warning" : "danger"}>{statusLabel(preview.status)}</Badge>
          </div>

          {preview.issues.length > 0 && (
            <div className="import-issues" role="status">
              {preview.issues.slice(0, 6).map((issue, index) => (
                <div className={issue.severity === "error" ? "import-issue error" : "import-issue warning"} key={`${issue.code}-${index}`}>
                  {issue.severity === "error" ? <Warning20Filled /> : <Warning20Filled />}
                  <span><strong>{issue.code}</strong>{issue.message}</span>
                </div>
              ))}
              {preview.issues.length > 6 && <span className="issue-more">另有 {preview.issues.length - 6} 項 issue，請逐 row 檢視。</span>}
            </div>
          )}

          <div className="import-table-wrap">
            <table className="import-table">
              <thead><tr><th>Include</th><th>Row</th><th>Staff number</th><th>Status</th><th>Issues</th></tr></thead>
              <tbody>
                {preview.rows.map((row, rowIndex) => {
                  const blocked = row.issues.some((issue) => issue.severity === "error");
                  return (
                    <tr key={`${preview.importId}:${row.rowNumber}:${rowIndex}`} className={blocked ? "row-blocked" : row.status === "warning" ? "row-warning" : ""}>
                      <td><input type="checkbox" checked={!blocked && (isCellExpandedImport || acceptedRows.has(row.rowNumber))} disabled={blocked || isCellExpandedImport} onChange={(event) => setAcceptedRows((current) => { const next = new Set(current); if (event.target.checked) next.add(row.rowNumber); else next.delete(row.rowNumber); return next; })} aria-label={`Include row ${row.rowNumber}`} /></td>
                      <td>{row.rowNumber}</td>
                      <td>{row.staffNumber ?? "未解析"}</td>
                      <td>{row.status}</td>
                      <td>{row.issues.length ? row.issues.map((issue) => `${issue.code}: ${issue.message}`).join("；") : <span className="ok-text"><CheckmarkCircle20Filled /> OK</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="import-actions">
            <span>{acceptedRowCount} rows 將提交；來源 hash 會在 commit 前重新驗證。{isCellExpandedImport ? " 此類 Excel 會提交全部可用的展開資料。" : ""}</span>
            <Button className="temporary-save-button" appearance="primary" icon={<ArrowUpload20Regular />} disabled={!acceptedRowCount || committing} onClick={commit}>{committing ? <Spinner size="tiny" /> : "Commit to SQLite"}</Button>
          </div>
          {preview.kind === "roster" && preview.issues.some((issue) => issue.code === "UNKNOWN_STAFF_NUMBER") && (
            <MessageBar intent="warning" className="import-roster-guidance"><MessageBarBody>Roster 含有 UNKNOWN_STAFF_NUMBER：這些列不會被勾選或計入可用供應。你可先提交其餘有效列，再於 Formation 建立或確認該 Staff No. 後重新匯入。</MessageBarBody></MessageBar>
          )}
        </div>
      )}
    </section>
  );
}
