import { PropsWithChildren } from "react";
import { Loading, Skeleton } from "./Loading";

type Props = PropsWithChildren<{
  /** true → skeleton (list) or spinner */
  loading?: boolean;
  /** use spinner instead of skeleton bars */
  spinner?: boolean;
  label?: string;
}>;

/**
 * Shared main-area loading gate for useList / useOne isLoading.
 * Pages: `{loading ? …}` can be replaced with `<PageBody loading={isLoading}>…`.
 */
export function PageBody({ loading, spinner, label, children }: Props) {
  if (loading) {
    return spinner ? <Loading label={label} /> : <Skeleton />;
  }
  return <>{children}</>;
}
