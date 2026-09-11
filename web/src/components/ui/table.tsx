"use client";

import {
  useRef,
  useMemo,
  createContext,
  useContext,
  forwardRef,
  type ReactNode,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";
import { fontWeights } from "@/lib/font-weight";
import { SizeProvider, useSize, type SizeVariant } from "@/lib/size-context";
import { useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";

// ── Context ──────────────────────────────────────────────

interface TableContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void;
  activeIndex: number | null;
  stackOnMobile: boolean;
}

const TableContext = createContext<TableContextValue | null>(null);

// ── Table ────────────────────────────────────────────────

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  children: ReactNode;
  /** Pins the table's rows to one step of the size ladder (default 36px,
   *  compact 28px — see /docs/sizes). Omitted, it follows the surrounding
   *  SizeProvider. */
  size?: SizeVariant;
  /** 窄屏把行堆成卡片，避免宽表被裁切或横向撑破视口。 */
  stackOnMobile?: boolean;
}

const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ children, size, stackOnMobile = true, className, ...props }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const sizeClasses = useSize(size);

    const hover = useFluidHover(containerRef);
    const {
      activeIndex,
      handlers,
      registerItem,
    } = hover;


    const contextValue = useMemo(
      () => ({ registerItem, activeIndex, stackOnMobile }),
      [registerItem, activeIndex, stackOnMobile]
    );

    const table = (
      <TableContext.Provider value={contextValue}>
        <div
          ref={containerRef}
          className={cn("relative", stackOnMobile && "max-md:overflow-x-hidden")}
          onMouseEnter={handlers.onMouseEnter}
          onMouseMove={handlers.onMouseMove}
          onMouseLeave={handlers.onMouseLeave}
          onClick={handlers.onClick}
        >
          {/* Hover background */}
          <FluidHoverHighlight hover={hover} />

          <table
            ref={ref}
            className={cn(
              // separate + spacing-0：右侧固定列才能在横滑时真正钉住
              "w-full border-separate border-spacing-0",
              sizeClasses.text,
              stackOnMobile && "max-md:!min-w-0 max-md:block",
              className
            )}
            {...props}
          >
            {children}
          </table>
        </div>
      </TableContext.Provider>
    );

    // A size prop pins every cell to one ladder step (cells read the context).
    return size ? <SizeProvider size={size}>{table}</SizeProvider> : table;
  }
);

Table.displayName = "Table";

// ── TableHeader ──────────────────────────────────────────

const TableHeader = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => {
  const stackOnMobile = useContext(TableContext)?.stackOnMobile;
  return (
  <thead
    ref={ref}
    className={cn(stackOnMobile && "max-md:hidden", className)}
    {...props}
  />
  );
});

TableHeader.displayName = "TableHeader";

// ── TableBody ────────────────────────────────────────────

const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => {
  const stackOnMobile = useContext(TableContext)?.stackOnMobile;
  return (
    <tbody
      ref={ref}
      className={cn(stackOnMobile && "max-md:block", className)}
      {...props}
    />
  );
});

TableBody.displayName = "TableBody";

// ── TableRow ─────────────────────────────────────────────

interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  index?: number;
}

const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ index, className, style, ...props }, ref) => {
    const internalRef = useRef<HTMLTableRowElement>(null);
    const ctx = useContext(TableContext);

    useRegisterFluidHoverItem(ctx?.registerItem, index, internalRef);

    const isBodyRow = index !== undefined;
    const activeIdx = ctx?.activeIndex ?? null;
    const hideBorder = activeIdx !== null && (
      (isBodyRow && (index === activeIdx || index === activeIdx - 1)) ||
      (!isBodyRow && activeIdx === 0)
    );

    return (
      <tr
        ref={(node) => {
          (internalRef as React.MutableRefObject<HTMLTableRowElement | null>).current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) (ref as React.MutableRefObject<HTMLTableRowElement | null>).current = node;
        }}
        data-fluid-hover-index={index}
        className={cn(
          "group/row transition-[border-color] duration-80",
          hideBorder
            ? "[&>th]:border-transparent [&>td]:border-transparent"
            : "[&>th]:border-b [&>td]:border-b [&>th]:border-accent/40 [&>td]:border-accent/40",
          isBodyRow && activeIdx === index && "is-active",
          ctx?.stackOnMobile &&
            "max-md:mb-3 max-md:flex max-md:flex-col max-md:gap-1.5 max-md:rounded-xl max-md:border max-md:border-border/80 max-md:bg-surface-1 max-md:p-3.5 max-md:last:mb-0 max-md:hover:bg-hover/60",
          className
        )}
        style={{
          ...style,
          fontVariationSettings: isBodyRow
            ? fontWeights.normal
            : fontWeights.semibold,
        }}
        {...props}
      />
    );
  }
);

TableRow.displayName = "TableRow";

// ── Sticky end (操作列钉在右侧) ──────────────────────────

const stickyEndShadow =
  "shadow-[-8px_0_16px_-12px_rgba(15,23,42,0.22)] dark:shadow-[-8px_0_16px_-12px_rgba(0,0,0,0.55)]";

// ── TableHead ────────────────────────────────────────────

interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** 横滑时把本列钉在表格右侧（用于操作列）。 */
  stickyEnd?: boolean;
}

const TableHead = forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, stickyEnd, ...props }, ref) => {
    const sizeClasses = useSize();
    const stackOnMobile = useContext(TableContext)?.stackOnMobile;
    return (
      <th
        ref={ref}
        className={cn(
          "relative z-10 text-left text-foreground",
          // py + line box lands the row on the ladder (36px / 28px).
          sizeClasses.variant === "compact" ? "px-2.5 py-[5px]" : "px-3 py-2",
          stickyEnd && [
            "sticky right-0 z-30 bg-surface-2",
            stickyEndShadow,
            "border-l border-border/70",
            stackOnMobile && "max-md:static max-md:z-auto max-md:shadow-none max-md:border-l-0",
          ],
          className
        )}
        {...props}
      />
    );
  }
);

TableHead.displayName = "TableHead";

// ── TableCell ────────────────────────────────────────────

interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  /** 横滑时把本列钉在表格右侧（用于操作列）。 */
  stickyEnd?: boolean;
}

const TableCell = forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, stickyEnd, ...props }, ref) => {
    const sizeClasses = useSize();
    const stackOnMobile = useContext(TableContext)?.stackOnMobile;
    return (
      <td
        ref={ref}
        className={cn(
          "relative z-10 text-muted-foreground transition-colors duration-80 group-[.is-active]/row:text-foreground",
          sizeClasses.variant === "compact" ? "px-2.5 py-[5px]" : "px-3 py-2",
          stickyEnd && [
            "sticky right-0 z-20 bg-surface-1",
            stickyEndShadow,
            "border-l border-border/60",
            "group-[.is-active]/row:bg-hover",
            stackOnMobile &&
              "max-md:static max-md:z-auto max-md:shadow-none max-md:border-l-0 max-md:bg-transparent",
          ],
          stackOnMobile &&
            "max-md:w-auto! max-md:max-w-none max-md:px-0 max-md:py-1 max-md:text-left max-md:whitespace-normal max-md:[&_.justify-end]:justify-start max-md:[&_.whitespace-nowrap]:whitespace-normal",
          className
        )}
        {...props}
      />
    );
  }
);

TableCell.displayName = "TableCell";

// ── Exports ──────────────────────────────────────────────

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
