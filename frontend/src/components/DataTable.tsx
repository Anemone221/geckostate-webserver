import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';

interface DataTableProps<T> {
  columns:      ColumnDef<T>[];
  data:         T[];
  isLoading?:   boolean;
  /** Show a search box that filters across all columns */
  searchable?:  boolean;
  /** Number of rows per page (default 50) */
  pageSize?:    number;
  /** Called with the hovered row's data, or null when the cursor leaves the table */
  onRowHover?:  (row: T | null) => void;
}

export default function DataTable<T>({
  columns,
  data,
  isLoading = false,
  searchable = false,
  pageSize = 50,
  onRowHover,
}: DataTableProps<T>) {
  const [sorting,     setSorting]     = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const table = useReactTable({
    data,
    columns,
    state:                  { sorting, globalFilter },
    onSortingChange:        setSorting,
    onGlobalFilterChange:   setGlobalFilter,
    getCoreRowModel:        getCoreRowModel(),
    getSortedRowModel:      getSortedRowModel(),
    getFilteredRowModel:    getFilteredRowModel(),
    getPaginationRowModel:  getPaginationRowModel(),
    initialState:           { pagination: { pageSize } },
  });

  return (
    <div className="space-y-3">
      {/* Search input */}
      {searchable && (
        <input
          type="text"
          placeholder="Search..."
          value={globalFilter}
          onChange={(e) => { setGlobalFilter(e.target.value); }}
          className="w-64 px-3 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded border border-gray-700">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-800 text-gray-400 uppercase text-xs tracking-wide">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className={[
                      'px-3 py-2 whitespace-nowrap select-none',
                      header.column.getCanSort() ? 'cursor-pointer hover:text-white' : '',
                    ].join(' ')}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() === 'asc'  && ' ▲'}
                    {header.column.getIsSorted() === 'desc' && ' ▼'}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody>
            {isLoading ? (
              // Skeleton placeholder rows while data loads
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-t border-gray-700 animate-pulse">
                  {columns.map((_, j) => (
                    <td key={j} className="px-3 py-2">
                      <div className="h-3 bg-gray-700 rounded w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-gray-500"
                >
                  No data to display.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, i) => (
                <tr
                  key={row.id}
                  className={[
                    'border-t border-gray-700 hover:bg-gray-800/60 transition-colors',
                    i % 2 === 1 ? 'bg-gray-800/20' : '',
                  ].join(' ')}
                  onMouseEnter={() => onRowHover?.(row.original)}
                  onMouseLeave={() => onRowHover?.(null)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 whitespace-nowrap">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {table.getPageCount() > 1 && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <button
            onClick={() => { table.previousPage(); }}
            disabled={!table.getCanPreviousPage()}
            className="px-2 py-1 rounded bg-gray-700 disabled:opacity-40 hover:bg-gray-600"
          >
            ←
          </button>
          <span>
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <button
            onClick={() => { table.nextPage(); }}
            disabled={!table.getCanNextPage()}
            className="px-2 py-1 rounded bg-gray-700 disabled:opacity-40 hover:bg-gray-600"
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
