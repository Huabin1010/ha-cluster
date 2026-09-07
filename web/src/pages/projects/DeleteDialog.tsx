import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";

type Props = {
  open: boolean;
  name?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function ProjectDeleteDialog({ open, name, onOpenChange, onConfirm }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除项目</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogBody>
          <AlertDialogDescription>
            确定删除项目{name ? `「${name}」` : ""}？项目内未销毁的服务器会被一并销毁并释放配额，此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="confirm-cancel">取消</AlertDialogCancel>
          <AlertDialogAction data-testid="confirm-ok" onClick={onConfirm}>
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
