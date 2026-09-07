import { test, expect } from "../fixtures/auth";
import { api } from "../helpers/api";
import { uniq } from "../helpers/ids";
import { seedProject } from "../fixtures/seed";
import { expectNoHorizontalOverflow } from "../helpers/assert";

test.describe("PW-2 项目列表与创建", () => {
  test("PW2-01 @pw2 @smoke 空态", async ({ freshUser }) => {
    const { page } = await freshUser("empty");
    await page.goto("/projects");
    const empty = page.getByTestId("empty-state");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("还没有项目");
  });

  test("PW2-02 @pw2 @smoke 创建项目", async ({ pageAs }) => {
    const { page } = await pageAs("owner");
    await page.goto("/projects");

    const slug = uniq("prj");
    const name = `Project ${slug}`;

    await page.getByTestId("project-name").fill(name);
    await page.getByTestId("project-slug").fill(slug);
    await page.getByTestId("project-create").click();

    // 创建成功直接跳到详情页
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
    await expect(page.getByTestId("project-id")).toBeVisible();
    await expect(page.locator("h2")).toContainText(name);

    // 返回列表能够看到该行
    await page.goto("/projects");
    const row = page.locator("tr", { hasText: name });
    await expect(row).toBeVisible();
  });

  test("PW2-03 @pw2 slug 非法", async ({ pageAs }) => {
    const { page } = await pageAs("owner");
    await page.goto("/projects");

    await page.getByTestId("project-name").fill("Invalid Slug Test");
    const slugIn = page.getByTestId("project-slug");
    await slugIn.fill("Invalid Slug!");

    // HTML5 pattern pattern="[a-z0-9]+(-[a-z0-9]+)*"
    const isValid = await slugIn.evaluate((el: HTMLInputElement) => el.checkValidity());
    expect(isValid).toBe(false);

    await page.getByTestId("project-create").click();
    // 应当留在列表页，不发生跳转
    expect(page.url()).toContain("/projects");
  });

  test("PW2-04 @pw2 slug 冲突", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const existing = await seedProject(tokens.token, "conflict");

    await page.goto("/projects");
    await page.getByTestId("project-name").fill("Another Project");
    await page.getByTestId("project-slug").fill(existing.slug);
    await page.getByTestId("project-create").click();

    const err = page.getByTestId("project-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("已被占用");
  });

  test("PW2-05 @pw2 @smoke 进入详情", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "goto");

    await page.goto("/projects");
    const row = page.locator("tr", { hasText: p.name });
    await expect(row).toBeVisible();
    await row.locator("td").first().click();

    await expect(page).toHaveURL(new RegExp(`/projects/${p.id}`));
    await expect(page.getByTestId("project-id")).toContainText(p.id);
  });

  test("PW2-11 @pw2 复制项目 id", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "copy");

    await page.goto("/projects");
    const row = page.locator("tr", { hasText: p.name });
    const copyBtn = row.getByTestId("project-copy-id");
    await copyBtn.click();

    await expect(copyBtn).toContainText("已复制");
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe(p.id);
  });

  test("PW2-12 @pw2 列表刷新", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    await page.goto("/projects");

    // 通过 API 异步创建新项目
    const p = await seedProject(tokens.token, "refresh");

    // 刷新页面后新项目行出现
    await page.reload();
    await expect(page.locator("tr", { hasText: p.name })).toBeVisible();
  });

  test("PW2-13 @pw2 长名称截断", async ({ pageAs }) => {
    const { page } = await pageAs("owner");
    await page.goto("/projects");

    const longName = "超长项目名称演示测试-" + uniq("long-name");
    const slug = uniq("slug");

    await page.getByTestId("project-name").fill(longName);
    await page.getByTestId("project-slug").fill(slug);
    await page.getByTestId("project-create").click();

    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
    await expect(page.locator("h2")).toContainText(longName);
    await expectNoHorizontalOverflow(page);
  });
});
