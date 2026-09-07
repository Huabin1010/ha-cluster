import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Combobox } from "./combobox";

describe("Combobox component", () => {
  const options = [
    { value: "p1", label: "E2E rm-mtq2m98n-9-yiak" },
    { value: "p2", label: "E2E ws-empty-mtq2r7k2-1-lt4f" },
    { value: "p3", label: "Alpha Project" },
  ];

  it("renders trigger with placeholder when no value is selected", () => {
    render(
      <Combobox
        value=""
        onValueChange={() => {}}
        options={options}
        placeholder="选择项目…"
        testId="test-combobox"
      />,
    );

    const trigger = screen.getByTestId("test-combobox");
    expect(trigger).toBeDefined();
    expect(trigger.textContent).toContain("选择项目…");
  });

  it("renders selected option label on trigger", () => {
    render(
      <Combobox
        value="p1"
        onValueChange={() => {}}
        options={options}
        placeholder="选择项目…"
        testId="test-combobox"
      />,
    );

    const trigger = screen.getByTestId("test-combobox");
    expect(trigger.textContent).toContain("E2E rm-mtq2m98n-9-yiak");
  });

  it("opens popover, filters options by search input, and selects an option", () => {
    const onValueChange = vi.fn();
    render(
      <Combobox
        value=""
        onValueChange={onValueChange}
        options={options}
        placeholder="选择项目…"
        searchPlaceholder="按名称过滤…"
        testId="test-combobox"
      />,
    );

    const trigger = screen.getByTestId("test-combobox");
    fireEvent.click(trigger);

    // Search input should be present
    const searchInput = screen.getByPlaceholderText("按名称过滤…");
    expect(searchInput).toBeDefined();

    // Before filtering: all options exist
    expect(screen.getByText("E2E rm-mtq2m98n-9-yiak")).toBeDefined();
    expect(screen.getByText("Alpha Project")).toBeDefined();

    // Type "Alpha" to filter
    fireEvent.change(searchInput, { target: { value: "alpha" } });
    expect(screen.getByText("Alpha Project")).toBeDefined();
    expect(screen.queryByText("E2E rm-mtq2m98n-9-yiak")).toBeNull();

    // Click filtered option
    fireEvent.click(screen.getByText("Alpha Project"));
    expect(onValueChange).toHaveBeenCalledWith("p3");
  });

  it("shows emptyText when no options match filter", () => {
    render(
      <Combobox
        value=""
        onValueChange={() => {}}
        options={options}
        placeholder="选择项目…"
        searchPlaceholder="按名称过滤…"
        emptyText="无匹配项目"
        testId="test-combobox"
      />,
    );

    fireEvent.click(screen.getByTestId("test-combobox"));
    const searchInput = screen.getByPlaceholderText("按名称过滤…");
    fireEvent.change(searchInput, { target: { value: "non-existent-keyword" } });

    expect(screen.getByText("无匹配项目")).toBeDefined();
  });
});
