import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

describe("Table stickyEnd", () => {
  it("pins the action column to the right with sticky classes", () => {
    render(
      <Table stackOnMobile={false} data-testid="t">
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead stickyEnd data-testid="sticky-head">
              操作
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>alpha</TableCell>
            <TableCell stickyEnd data-testid="sticky-cell">
              加入项目
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    const table = screen.getByTestId("t");
    expect(table.className).toContain("border-separate");
    expect(table.className).toContain("border-spacing-0");

    const head = screen.getByTestId("sticky-head");
    expect(head.className).toContain("sticky");
    expect(head.className).toContain("right-0");

    const cell = screen.getByTestId("sticky-cell");
    expect(cell.className).toContain("sticky");
    expect(cell.className).toContain("right-0");
    expect(cell.className).toContain("bg-surface-1");
  });
});
