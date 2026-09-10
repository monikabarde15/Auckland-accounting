import React, { useState } from 'react';
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Download,
  Layers,
  RefreshCw
} from 'lucide-react';
import { ContactGroup, CsvPreviewResult, ImportSummaryResult } from '../../types';
import { api } from '../../services/api';
import {
  Button,
  Badge,
  Modal,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell
} from '../ui';

interface CsvImportWizardProps {
  isOpen: boolean;
  onClose: () => void;
  groups: ContactGroup[];
  onImportComplete: () => void;
}

export const CsvImportWizard: React.FC<CsvImportWizardProps> = ({
  isOpen,
  onClose,
  groups,
  onImportComplete
}) => {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<CsvPreviewResult | null>(null);
  const [targetGroupId, setTargetGroupId] = useState<string>('');
  const [duplicateStrategy, setDuplicateStrategy] = useState<'SKIP' | 'UPDATE'>('SKIP');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [summaryResult, setSummaryResult] = useState<ImportSummaryResult | null>(null);

  if (!isOpen) return null;

  const downloadSampleTemplate = () => {
    const headers = [
      'Name',
      'Company',
      'Phone',
      'Email',
      'Entity Type',
      'IRD Number',
      'Assigned Accountant',
      'Balance',
      'Due Date'
    ];
    const sampleRows = [
      'Sarah Mitchell,Auckland Construction Ltd,+64218924101,sarah@aklconstruction.co.nz,Company,109-842-993,David Chen (CA),4250.00,2026-09-28',
      'Marcus Wong,Henderson Tech Solutions,+64215553829,marcus@hendersontech.co.nz,Company,112-993-481,David Chen (CA),1820.00,2026-09-28',
      'Liam Taylor,Taylor Contracting,+64274928110,liam@taylorcontracting.co.nz,Individual,084-291-884,David Chen (CA),650.00,2026-09-28'
    ];
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...sampleRows].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'Auckland_Accounting_Import_Template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileChange = async (file: File) => {
    setSelectedFile(file);
    setErrorMsg(null);
    setIsProcessing(true);

    try {
      const text = await file.text();
      const res = await api.previewCsvImport(text);
      if (res.success && res.data) {
        setPreviewData(res.data);
        setCurrentStep(2);
      } else {
        setErrorMsg(res.error?.message || 'Failed to preview CSV file');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not read or parse the selected file');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!previewData) return;

    setCurrentStep(3);
    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const res = await api.confirmCsvImport({
        rows: previewData.parsedRows,
        targetGroupId: targetGroupId || undefined,
        duplicateStrategy
      });

      if (res.success && res.data) {
        setSummaryResult(res.data);
        setCurrentStep(4);
        onImportComplete();
      } else {
        setErrorMsg(res.error?.message || 'Import failed');
        setCurrentStep(2);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to execute import commit');
      setCurrentStep(2);
    } finally {
      setIsProcessing(false);
    }
  };

  const resetAndClose = () => {
    setCurrentStep(1);
    setSelectedFile(null);
    setPreviewData(null);
    setSummaryResult(null);
    setErrorMsg(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      size="xl"
      title={`CSV Import Pipeline (Step ${currentStep} of 4)`}
      description={
        currentStep === 1
          ? 'Upload practice client CSV file'
          : currentStep === 2
          ? 'Review validation, duplicate analysis, and DNC suppression'
          : currentStep === 3
          ? 'Committing client records to database'
          : 'Import complete'
      }
      footer={
        <div className="flex items-center justify-between w-full">
          <div>
            {currentStep === 2 && (
              <Button variant="outline" size="sm" onClick={() => setCurrentStep(1)}>
                Back to Upload
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {currentStep < 4 ? (
              <>
                <Button variant="outline" size="sm" onClick={resetAndClose}>
                  Cancel
                </Button>
                {currentStep === 2 && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleConfirmImport}
                    disabled={isProcessing || previewData?.validCount === 0}
                  >
                    Confirm & Execute Import
                  </Button>
                )}
              </>
            ) : (
              <Button variant="primary" size="sm" onClick={resetAndClose}>
                Done
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Step 1: Upload */}
        {currentStep === 1 && (
          <div className="space-y-4">
            <div className="border border-dashed border-slate-300 rounded-lg p-8 text-center bg-slate-50/50 hover:bg-slate-50 transition-colors">
              <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="font-semibold text-slate-800 text-sm">Select CSV File</p>
              <p className="text-slate-500 text-xs mt-0.5 mb-3">
                Expected columns: Name, Company, Phone, Email, Entity Type, IRD Number, Balance, Due Date
              </p>
              <label className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#0f2e4a] hover:bg-[#163e63] text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors">
                <FileText className="w-3.5 h-3.5" />
                <span>Browse File</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileChange(file);
                  }}
                />
              </label>
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div>
                <span className="font-semibold text-slate-800 block">Need the standard format?</span>
                <span className="text-slate-500 text-[11px]">Download pre-formatted Auckland Accounting template.</span>
              </div>
              <Button
                variant="outline"
                size="xs"
                onClick={downloadSampleTemplate}
                leftIcon={<Download className="w-3 h-3" />}
              >
                Template CSV
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Preview & Options */}
        {currentStep === 2 && previewData && (
          <div className="space-y-4">
            {/* Metric counters */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
              <div className="p-2 bg-slate-50 border border-slate-200 rounded">
                <span className="text-[10px] text-slate-400 block font-semibold">Total</span>
                <span className="font-mono font-bold text-slate-900 text-sm">{previewData.totalRows}</span>
              </div>
              <div className="p-2 bg-emerald-50 border border-emerald-200 rounded">
                <span className="text-[10px] text-emerald-700 block font-semibold">Valid</span>
                <span className="font-mono font-bold text-emerald-700 text-sm">{previewData.validCount}</span>
              </div>
              <div className="p-2 bg-amber-50 border border-amber-200 rounded">
                <span className="text-[10px] text-amber-700 block font-semibold">DB Dups</span>
                <span className="font-mono font-bold text-amber-700 text-sm">{previewData.duplicateInDbCount}</span>
              </div>
              <div className="p-2 bg-orange-50 border border-orange-200 rounded">
                <span className="text-[10px] text-orange-700 block font-semibold">File Dups</span>
                <span className="font-mono font-bold text-orange-700 text-sm">{previewData.duplicateInFileCount}</span>
              </div>
              <div className="p-2 bg-red-50 border border-red-200 rounded">
                <span className="text-[10px] text-red-700 block font-semibold">DNC Blocked</span>
                <span className="font-mono font-bold text-red-700 text-sm">{previewData.dncBlockedCount}</span>
              </div>
              <div className="p-2 bg-slate-100 border border-slate-200 rounded">
                <span className="text-[10px] text-slate-500 block font-semibold">Invalid</span>
                <span className="font-mono font-bold text-slate-700 text-sm">{previewData.invalidCount}</span>
              </div>
            </div>

            {/* Options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Assign to Contact Group
                </label>
                <select
                  value={targetGroupId}
                  onChange={(e) => setTargetGroupId(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs"
                >
                  <option value="">Do not assign to a group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Duplicate Resolution Strategy
                </label>
                <div className="flex items-center gap-3 pt-1">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="dupStrategy"
                      value="SKIP"
                      checked={duplicateStrategy === 'SKIP'}
                      onChange={() => setDuplicateStrategy('SKIP')}
                      className="text-[#0f2e4a]"
                    />
                    <span>Skip duplicates</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="dupStrategy"
                      value="UPDATE"
                      checked={duplicateStrategy === 'UPDATE'}
                      onChange={() => setDuplicateStrategy('UPDATE')}
                      className="text-[#0f2e4a]"
                    />
                    <span>Update existing</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Preview table */}
            <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>#</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Name</TableHeaderCell>
                    <TableHeaderCell>Company</TableHeaderCell>
                    <TableHeaderCell>Phone (E.164)</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewData.previewRows.map((r) => (
                    <TableRow key={r.rowIndex}>
                      <TableCell className="font-mono text-slate-400 text-[11px]">{r.rowIndex}</TableCell>
                      <TableCell>
                        <Badge
                          variant={r.status === 'VALID' ? 'success' : r.status === 'DNC_BLOCKED' ? 'danger' : 'warning'}
                          size="sm"
                        >
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-semibold text-slate-900">{r.name}</TableCell>
                      <TableCell className="text-slate-600">{r.companyName || '—'}</TableCell>
                      <TableCell className="font-mono text-slate-700">{r.normalizedPhone}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* Step 3: Processing */}
        {currentStep === 3 && (
          <div className="py-12 text-center space-y-3">
            <RefreshCw className="w-8 h-8 text-[#0f2e4a] animate-spin mx-auto" />
            <h4 className="text-sm font-semibold text-slate-900">Committing Client Records...</h4>
            <p className="text-xs text-slate-500">Normalizing phone numbers and inserting into PostgreSQL database.</p>
          </div>
        )}

        {/* Step 4: Summary */}
        {currentStep === 4 && summaryResult && (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-center space-y-1">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
              <h4 className="text-sm font-semibold text-emerald-950">CSV Import Completed</h4>
              <p className="text-xs text-emerald-700">Client directory has been successfully updated.</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                <span className="text-[10px] text-slate-400 font-semibold block">Imported</span>
                <span className="text-lg font-bold text-slate-900 font-mono">{summaryResult.importedCount}</span>
              </div>
              <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                <span className="text-[10px] text-blue-700 font-semibold block">Updated</span>
                <span className="text-lg font-bold text-blue-700 font-mono">{summaryResult.updatedCount}</span>
              </div>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded">
                <span className="text-[10px] text-amber-700 font-semibold block">Skipped</span>
                <span className="text-lg font-bold text-amber-700 font-mono">{summaryResult.skippedCount}</span>
              </div>
              <div className="p-3 bg-red-50 border border-red-200 rounded">
                <span className="text-[10px] text-red-700 font-semibold block">DNC Blocked</span>
                <span className="text-lg font-bold text-red-700 font-mono">{summaryResult.dncBlockedCount}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
