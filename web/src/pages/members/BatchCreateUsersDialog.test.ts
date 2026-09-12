import { describe, expect, it } from "vitest";
import { parseBatchInput } from "./BatchCreateUsersDialog";

describe("parseBatchInput", () => {
  it("parses empty input", () => {
    const res = parseBatchInput("");
    expect(res.parsed).toHaveLength(0);
    expect(res.invalidCount).toBe(0);
  });

  it("parses space and comma separated lines with optional password", () => {
    const text = `
      alice alice@example.com
      bob,bob@example.com,mypassword123
      # this is comment
      charlie\tcharlie@example.com
    `;
    const res = parseBatchInput(text);
    expect(res.parsed).toHaveLength(3);
    expect(res.invalidCount).toBe(0);

    expect(res.parsed[0]).toMatchObject({
      username: "alice",
      email: "alice@example.com",
      password: undefined,
    });
    expect(res.parsed[1]).toMatchObject({
      username: "bob",
      email: "bob@example.com",
      password: "mypassword123",
    });
    expect(res.parsed[2]).toMatchObject({
      username: "charlie",
      email: "charlie@example.com",
    });
  });

  it("parses display name and optional password", () => {
    const text = `
      guohanli guohanli@qzsyzn.com 郭总
      yexinwei yexinwei@qzsyzn.com 叶鑫伟 secret99
      legacy legacy@example.com ha123456
    `;
    const res = parseBatchInput(text);
    expect(res.invalidCount).toBe(0);
    expect(res.parsed[0]).toMatchObject({
      username: "guohanli",
      display_name: "郭总",
      password: undefined,
    });
    expect(res.parsed[1]).toMatchObject({
      username: "yexinwei",
      display_name: "叶鑫伟",
      password: "secret99",
    });
    expect(res.parsed[2]).toMatchObject({
      username: "legacy",
      display_name: undefined,
      password: "ha123456",
    });
  });

  it("flags invalid email format or too short password", () => {
    const text = `
      user1 invalid-email-no-at
      user2 user2@example.com 张三 123
      incomplete_line
    `;
    const res = parseBatchInput(text);
    expect(res.parsed).toHaveLength(3);
    expect(res.invalidCount).toBe(3);

    expect(res.parsed[0].error).toContain("邮箱格式不正确");
    expect(res.parsed[1].error).toContain("密码长度小于 6 位");
    expect(res.parsed[2].error).toContain("格式不完整");
  });
});
