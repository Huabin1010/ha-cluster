export type MemberCandidate = {
  id: string;
  username: string;
  display_name?: string;
};

export function memberCandidateLabel(u: MemberCandidate): string {
  const name = u.display_name?.trim() ?? "";
  if (name && name.toLowerCase() !== u.username.toLowerCase()) {
    return `${name}（${u.username}）`;
  }
  return u.username;
}
