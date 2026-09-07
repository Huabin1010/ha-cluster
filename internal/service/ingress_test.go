package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func TestIngressWorkflow(t *testing.T) {
	app, owner := setupApp(t)
	ctx := context.Background()

	node := &models.Node{
		ID:              uuid.New(),
		Name:            "n1",
		FabricIP:        "10.88.0.2",
		AllocatableCPU:  8000,
		AllocatableMem:  16 * 1024 * 1024 * 1024,
		AllocatableDisk: 100 * 1024 * 1024 * 1024,
		Arch:            "x86_64",
		Ready:           true,
	}
	if err := app.Store.UpsertNode(ctx, node); err != nil {
		t.Fatal(err)
	}

	p, err := app.CreateProject(ctx, owner.ID, "proj-ingress", "pi")
	if err != nil {
		t.Fatal(err)
	}

	// 注册普通开发者
	devUser, err := app.Register(ctx, "devuser", "dev@x.com", "password1")
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Store.AddMembership(ctx, models.Membership{
		ProjectID: p.ID,
		UserID:    devUser.ID,
		Role:      models.RoleDeveloper,
	}); err != nil {
		t.Fatal(err)
	}

	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID:  p.ID,
		Name:       "ws-ing",
		Plan:       "nano",
		Arch:       "x86_64",
		Visibility: models.VisPrivate,
		Actor:      *devUser,
	})
	if err != nil {
		t.Fatal(err)
	}

	// 状态必须是 running 或 degraded 才能创建 ingress
	ws.Status = models.WSRunning
	if err := app.Store.UpdateWorkspace(ctx, ws); err != nil {
		t.Fatal(err)
	}

	// 1. 保留词拦截测试
	_, err = app.CreateIngress(ctx, CreateIngressInput{
		WorkspaceID: ws.ID,
		Domain:      "admin.example.com",
		Port:        8080,
		Actor:       *devUser,
	})
	if !errors.Is(err, store.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for reserved subdomain, got %v", err)
	}

	// 2. 普通开发者申请合法域名 -> 状态为 pending_approval
	rDev, err := app.CreateIngress(ctx, CreateIngressInput{
		WorkspaceID: ws.ID,
		Domain:      "app1.example.com",
		Port:        8080,
		Actor:       *devUser,
	})
	if err != nil {
		t.Fatal(err)
	}
	if rDev.Status != models.IngressPendingApproval {
		t.Fatalf("expected status %s, got %s", models.IngressPendingApproval, rDev.Status)
	}
	if rDev.ApplicantUserID != devUser.ID {
		t.Fatalf("expected applicant %s, got %s", devUser.ID, rDev.ApplicantUserID)
	}

	// 3. 普通开发者无权审批
	_, err = app.ApproveIngress(ctx, *devUser, rDev.ID)
	if !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("expected ErrForbidden for developer approval, got %v", err)
	}

	// 4. 项目 Owner 审批通过 -> 状态扭转为 active，且分配宿主机代理端口
	rApproved, err := app.ApproveIngress(ctx, *owner, rDev.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rApproved.Status != models.IngressActive {
		t.Fatalf("expected status active, got %s", rApproved.Status)
	}
	if rApproved.ReviewedBy == nil || *rApproved.ReviewedBy != owner.ID {
		t.Fatalf("expected reviewed by owner, got %v", rApproved.ReviewedBy)
	}
	if rApproved.HostPort <= 0 {
		t.Fatalf("expected HostPort > 0 after approval, got %d", rApproved.HostPort)
	}

	// 5. 项目 Owner 直接创建域名 -> 免审批直通 active，且分配宿主机代理端口
	rOwner, err := app.CreateIngress(ctx, CreateIngressInput{
		WorkspaceID: ws.ID,
		Domain:      "owner-app.example.com",
		Port:        8080,
		Actor:       *owner,
	})
	if err != nil {
		t.Fatal(err)
	}
	if rOwner.Status != models.IngressActive {
		t.Fatalf("expected owner created route to be active, got %s", rOwner.Status)
	}
	if rOwner.HostPort <= 0 {
		t.Fatalf("expected HostPort > 0 for active route, got %d", rOwner.HostPort)
	}

	// 6. 驳回流测试
	rToReject, err := app.CreateIngress(ctx, CreateIngressInput{
		WorkspaceID: ws.ID,
		Domain:      "bad.example.com",
		Port:        8080,
		Actor:       *devUser,
	})
	if err != nil {
		t.Fatal(err)
	}
	rRejected, err := app.RejectIngress(ctx, *owner, rToReject.ID, "不符合命名规范")
	if err != nil {
		t.Fatal(err)
	}
	if rRejected.Status != models.IngressRejected {
		t.Fatalf("expected status rejected, got %s", rRejected.Status)
	}
	if rRejected.RejectReason != "不符合命名规范" {
		t.Fatalf("expected reject reason to be saved, got %s", rRejected.RejectReason)
	}
}
