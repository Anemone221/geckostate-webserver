import Papa from 'papaparse';
import * as XLSX from 'xlsx';

interface Column<T> {
  header:   string;
  accessor: (row: T) => string | number | null;
}

export interface SheetData {
  name: string;
  rows: Record<string, string | number | null>[];
}

interface ExportToolbarProps<T> {
  data:         T[];
  filename:     string;
  columns:      Column<T>[];
  secondSheet?: SheetData;  // optional second section: Excel sheet 2, CSV block, print section
}

export default function ExportToolbar<T>({
  data, filename, columns, secondSheet,
}: ExportToolbarProps<T>) {
  // Convert data to a flat array of objects using the column definitions
  const rows = data.map((row) => {
    const obj: Record<string, string | number | null> = {};
    columns.forEach((col) => { obj[col.header] = col.accessor(row); });
    return obj;
  });

  function exportCsv() {
    let csv = Papa.unparse(rows);
    if (secondSheet && secondSheet.rows.length > 0) {
      csv += `\n\n${secondSheet.name}\n` + Papa.unparse(secondSheet.rows);
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    download(blob, `${filename}.csv`);
  }

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    if (secondSheet && secondSheet.rows.length > 0) {
      const ws2 = XLSX.utils.json_to_sheet(secondSheet.rows);
      XLSX.utils.book_append_sheet(wb, ws2, secondSheet.name);
    }
    XLSX.writeFile(wb, `${filename}.xlsx`);
  }

  return (
    <div className="flex gap-2 mt-3">
      <button
        onClick={exportCsv}
        className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-200 transition-colors"
      >
        Export CSV
      </button>
      <button
        onClick={exportExcel}
        className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-200 transition-colors"
      >
        Export Excel
      </button>
      <button
        onClick={() => { window.print(); }}
        className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-200 transition-colors"
      >
        Print
      </button>
    </div>
  );
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
