import { Inbox } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";

type Props = {
  text?: string;
  title?: string;
  description?: string;
};

export function Empty({ text, title, description }: Props) {
  const heading = title || text || "暂无数据";
  return (
    <Card className="border-dashed" data-testid="empty-state">
      <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <Inbox className="h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="empty-title m-0 font-semibold">{heading}</p>
        {description && <p className="m-0 text-sm text-muted-foreground">{description}</p>}
      </CardContent>
    </Card>
  );
}
