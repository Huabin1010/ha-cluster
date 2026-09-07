package service

import (
	"context"
	"testing"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store/memory"
	"ha-cluster/internal/workspace"
)

func TestBatchCreateUsers(t *testing.T) {
	ctx := context.Background()
	st := memory.New()
	app := New(st, workspace.NewMemoryRuntime(), []byte("secret-key-32b-at-least-32-bytes!"))

	// Create a platform admin user
	admin, err := app.Register(ctx, "rootadmin", "root@cluster.local", "adminpassword1")
	if err != nil {
		t.Fatalf("register admin failed: %v", err)
	}
	admin.PlatformRole = models.RolePlatformAdmin
	if err := st.UpdateUser(ctx, admin); err != nil {
		t.Fatalf("update admin platform role failed: %v", err)
	}

	// Create normal user
	normalUser, err := app.Register(ctx, "normaluser", "normal@cluster.local", "normalpass1")
	if err != nil {
		t.Fatalf("register normal user failed: %v", err)
	}

	// Admin creates a project
	proj, err := app.CreateProject(ctx, admin.ID, "Batch Demo", "batch-demo")
	if err != nil {
		t.Fatalf("create project failed: %v", err)
	}

	t.Run("Platform admin batch creates users without project", func(t *testing.T) {
		res, err := app.BatchCreateUsers(ctx, *admin, BatchCreateUsersInput{
			Users: []BatchUserInput{
				{Username: "user1", Email: "user1@x.com"},
				{Username: "user2", Email: "user2@x.com", Password: "custompass2"},
				{Username: "", Email: "invalid"},
			},
			DefaultPassword: "defaultpass123",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.Total != 3 || res.CreatedCount != 2 || res.FailedCount != 1 {
			t.Fatalf("expected 2 created, 1 failed, got %+v", res)
		}
	})

	t.Run("Normal user without admin membership cannot batch create", func(t *testing.T) {
		_, err := app.BatchCreateUsers(ctx, *normalUser, BatchCreateUsersInput{
			Users: []BatchUserInput{
				{Username: "u3", Email: "u3@x.com"},
			},
			DefaultPassword: "defaultpass123",
		})
		if err == nil {
			t.Fatal("expected error for normal user, got nil")
		}
	})

	t.Run("Batch create and add to project", func(t *testing.T) {
		res, err := app.BatchCreateUsers(ctx, *admin, BatchCreateUsersInput{
			ProjectID:       &proj.ID,
			ProjectRole:     models.RoleDeveloper,
			DefaultPassword: "defaultpass123",
			Users: []BatchUserInput{
				{Username: "proj_user1", Email: "proj1@x.com"},
				{Username: "proj_user2", Email: "proj2@x.com"},
			},
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.CreatedCount != 2 {
			t.Fatalf("expected 2 created, got %+v", res)
		}
		for _, r := range res.Results {
			if !r.AddedToProject {
				t.Fatalf("expected AddedToProject to be true: %+v", r)
			}
		}
	})
}
