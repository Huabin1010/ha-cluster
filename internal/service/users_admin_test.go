package service

import (
	"context"
	"testing"

	"ha-cluster/internal/auth"
	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func TestManageUserLifecycle(t *testing.T) {
	app, admin := setupApp(t)
	ctx := context.Background()
	victim, err := app.Register(ctx, "victim", "victim@x.com", "password1")
	if err != nil {
		t.Fatal(err)
	}

	if err := app.SuspendUser(ctx, *admin, victim.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := app.Store.GetUserByID(ctx, victim.ID)
	if got.Status != models.UserSuspended || got.TokenVersion < 2 {
		t.Fatalf("%+v", got)
	}
	if _, _, err := app.Login(ctx, "victim", "password1"); err != store.ErrUnauthorized {
		t.Fatalf("suspended user should not login, err=%v", err)
	}

	if err := app.UnsuspendUser(ctx, *admin, victim.ID); err != nil {
		t.Fatal(err)
	}
	got, _ = app.Store.GetUserByID(ctx, victim.ID)
	if got.Status != models.UserActive {
		t.Fatalf("status=%s", got.Status)
	}

	plain, err := app.ResetUserPassword(ctx, *admin, victim.ID, ResetPasswordInput{})
	if err != nil || len(plain) < 8 {
		t.Fatalf("reset: %q err=%v", plain, err)
	}
	if _, _, err := app.Login(ctx, "victim", "password1"); err != store.ErrUnauthorized {
		t.Fatal("old password should fail")
	}
	if _, _, err := app.Login(ctx, "victim", plain); err != nil {
		t.Fatal(err)
	}

	ops := models.RolePlatformOps
	patched, err := app.PatchUser(ctx, *admin, victim.ID, PatchUserInput{PlatformRole: &ops})
	if err != nil || patched.PlatformRole != models.RolePlatformOps {
		t.Fatalf("patch: %+v err=%v", patched, err)
	}

	if err := app.DeleteUser(ctx, *admin, victim.ID); err != nil {
		t.Fatal(err)
	}
	got, _ = app.Store.GetUserByID(ctx, victim.ID)
	if got.Status != models.UserDeleted {
		t.Fatalf("status=%s", got.Status)
	}
	users, _ := app.Store.ListUsers(ctx)
	for _, u := range users {
		if u.ID == victim.ID {
			t.Fatal("deleted user should not appear in list")
		}
	}
	if _, _, err := app.Login(ctx, "victim", plain); err != store.ErrUnauthorized {
		t.Fatal("deleted user should not login")
	}
}

func TestManageUserGuards(t *testing.T) {
	app, admin := setupApp(t)
	ctx := context.Background()
	dev, err := app.Register(ctx, "devx", "devx@x.com", "password1")
	if err != nil {
		t.Fatal(err)
	}

	if err := app.SuspendUser(ctx, *dev, admin.ID); err != store.ErrForbidden {
		t.Fatalf("non-admin suspend: %v", err)
	}
	if err := app.SuspendUser(ctx, *admin, admin.ID); err == nil {
		t.Fatal("should not suspend self")
	}
	if _, err := app.ResetUserPassword(ctx, *admin, admin.ID, ResetPasswordInput{}); err == nil {
		t.Fatal("should not reset self")
	}
	if err := app.DeleteUser(ctx, *admin, admin.ID); err == nil {
		t.Fatal("should not delete self")
	}
	userRole := models.RolePlatformUser
	if _, err := app.PatchUser(ctx, *admin, admin.ID, PatchUserInput{PlatformRole: &userRole}); err == nil {
		t.Fatal("should not demote self")
	}

	p, err := app.CreateProject(ctx, dev.ID, "owned", "owned")
	if err != nil {
		t.Fatal(err)
	}
	if err := app.DeleteUser(ctx, *admin, dev.ID); err == nil {
		t.Fatal("should not delete project owner")
	}
	_ = p

	if err := app.DeleteUser(ctx, *admin, admin.ID); err == nil {
		t.Fatal("last admin must remain")
	}
}

func TestResetUserPasswordCustom(t *testing.T) {
	app, admin := setupApp(t)
	ctx := context.Background()
	u, err := app.Register(ctx, "pwduser", "pwduser@x.com", "password1")
	if err != nil {
		t.Fatal(err)
	}
	plain, err := app.ResetUserPassword(ctx, *admin, u.ID, ResetPasswordInput{Password: "newpass9"})
	if err != nil || plain != "newpass9" {
		t.Fatalf("plain=%q err=%v", plain, err)
	}
	got, _ := app.Store.GetUserByID(ctx, u.ID)
	if !auth.VerifyPassword("newpass9", got.PasswordHash) {
		t.Fatal("hash mismatch")
	}
}
