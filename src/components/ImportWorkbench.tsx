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

export function ImportWorkbench({ date, onNotice, onSnapshot, expectedRevision = 0 }: ImportWorkbenchProps) {
  const [kind, setKind] = useState<ImportKind>("formation");
  const [filePath, setFilePath] = useState("");
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [acceptedRows, setAcceptedRows] = useState<Set<number>>(new Set());

  const api = window.ohlr?.imports;
  const canPreview = Boolean(filePath.trim() && api);
  const chooseFile = async () => {
    if (!api) {
      onNotice("warning", "目前以瀏覽器預覽模式執行；請在 Electron app 使用檔案選擇器。");
      return;
    }
    const result = await api.selectFile({ kind });
    if (!result.ok) {
      onNotice("error", result.error.message);
      return;
    }
    const selected: SelectImportFileDto = result.data;
    if (!selected.canceled && selected.filePath) setFilePath(selected.filePath);
  };

  const runPreview = async () => {
    if (!api || !filePath.trim()) return;
    setLoading(true);
    try {
      const result = await api.preview({ kind, source: { filePath: filePath.trim() } });
      if (!result.ok) {
        onNotice("error", result.error.message);
        setPreview(null);
        return;
      }
      setPreview(result.data.preview);
      setAcceptedRows(new Set(result.data.preview.rows.filter((row) => row.issues.every((issue) => issue.severity !== "error")).map((row) => row.rowNumber)));
      onNotice(result.data.preview.errorCount ? "warning" : "success", `已完成 ${kind === "formation" ? "Formation" : "Qualification"} preview：${result.data.preview.rowCount} rows。`);
    } finally {
      setLoading(false);
    }
  };

  const commit = async () => {
    if (!api || !preview) return;
    setCommitting(true);
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
          <p>先預覽、修正 blocking rows，再明確提交 Formation 或 Qualification snapshot。</p>
        </div>
        <Badge appearance="tint" color={preview?.status === "has-errors" ? "danger" : "informative"}>inspect → normalize → validate → commit</Badge>
      </div>

      <div className="import-controls">
        <TabList selectedValue={kind} onTabSelect={(_, data) => { setKind(data.value as ImportKind); setPreview(null); }}>
          <Tab value="formation">Formation</Tab>
          <Tab value="qualification">Qualification</Tab>
        </TabList>
        <Field label="Excel 檔案路徑" className="import-file-field">
          <Input value={filePath} onChange={(_, data) => setFilePath(data.value)} placeholder="選擇 .xlsx 檔案" contentBefore={<FolderOpen20Regular />} />
        </Field>
        <Button appearance="secondary" icon={<FolderOpen20Regular />} onClick={chooseFile}>選擇檔案</Button>
        <Button appearance="primary" icon={<DocumentSearch20Regular />} onClick={runPreview} disabled={!canPreview || loading}>{loading ? <Spinner size="tiny" /> : "產生 Preview"}</Button>
      </div>

      {!api && <MessageBar intent="info"><MessageBarBody>瀏覽器 review mode 沒有 Electron IPC；啟動 desktop app 後可讀取本機 Excel。</MessageBarBody></MessageBar>}

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
                {preview.rows.map((row) => {
                  const blocked = row.issues.some((issue) => issue.severity === "error");
                  return (
                    <tr key={row.rowNumber} className={blocked ? "row-blocked" : row.status === "warning" ? "row-warning" : ""}>
                      <td><input type="checkbox" checked={acceptedRows.has(row.rowNumber)} disabled={blocked} onChange={(event) => setAcceptedRows((current) => { const next = new Set(current); if (event.target.checked) next.add(row.rowNumber); else next.delete(row.rowNumber); return next; })} aria-label={`Include row ${row.rowNumber}`} /></td>
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
            <span>{acceptedRows.size} rows 將提交；來源 hash 會在 commit 前重新驗證。</span>
            <Button className="temporary-save-button" appearance="primary" icon={<ArrowUpload20Regular />} disabled={preview.status === "has-errors" || !acceptedRows.size || committing} onClick={commit}>{committing ? <Spinner size="tiny" /> : "Commit to SQLite"}</Button>
          </div>
        </div>
      )}
    </section>
  );
}
