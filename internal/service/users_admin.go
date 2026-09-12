package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/auth"
	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

type PatchUserInput struct {
	PlatformRole *string `json:"platform_role"`
	DisplayName  *string `json:"display_name"`
}

type ResetPasswordInput struct {
	Password string `json:"password,omitempty"`
}

func (a *App) requirePlatformAdmin(actor models.User) error {
	if actor.PlatformRole != models.RolePlatformAdmin {
		return store.ErrForbidden
	}
	return nil
}

func (a *App) loadManageTarget(ctx context.Context, actor models.User, targetID uuid.UUID) (*models.User, error) {
	if err := a.requirePlatformAdmin(actor); err != nil {
		return nil, err
	}
	u, err := a.Store.GetUserByID(ctx, targetID)
	if err != nil {
		return nil, err
	}
	if u.Status == models.UserDeleted {
		return nil, store.ErrNotFound
	}
	return u, nil
}

func refuseSelf(actor, target models.User, verb string) error {
	if actor.ID == target.ID {
		return fmt.Errorf("不能%s自己的账号", verb)
	}
	return nil
}

func (a *App) remainingActiveAdmins(ctx context.Context, except uuid.UUID) (int, error) {
	users, err := a.Store.ListUsers(ctx)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, u := range users {
		if u.ID == except {
			continue
		}
		if u.PlatformRole == models.RolePlatformAdmin && u.Status == models.UserActive {
			n++
		}
	}
	return n, nil
}

func (a *App) refuseLastAdmin(ctx context.Context, target models.User) error {
	if target.PlatformRole != models.RolePlatformAdmin || target.Status != models.UserActive {
		return nil
	}
	n, err := a.remainingActiveAdmins(ctx, target.ID)
	if err != nil {
		return err
	}
	if n < 1 {
		return fmt.Errorf("至少保留一名活跃的平台管理员")
	}
	return nil
}

func (a *App) SuspendUser(ctx context.Context, actor models.User, target uuid.UUID) error {
	u, err := a.loadManageTarget(ctx, actor, target)
	if err != nil {
		return err
	}
	if err := a.refuseLastAdmin(ctx, *u); err != nil {
		return err
	}
	if err := refuseSelf(actor, *u, "停用"); err != nil {
		return err
	}
	if u.Status == models.UserSuspended {
		return nil
	}
	u.Status = models.UserSuspended
	u.TokenVersion++
	u.UpdatedAt = time.Now()
	if err := a.Store.UpdateUser(ctx, u); err != nil {
		return err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID:  actor.ID,
		Action:       "user.suspend",
		ResourceType: "user",
		ResourceID:   u.ID.String(),
		Meta:         map[string]any{"username": u.Username},
	})
	return nil
}

func (a *App) UnsuspendUser(ctx context.Context, actor models.User, target uuid.UUID) error {
	u, err := a.loadManageTarget(ctx, actor, target)
	if err != nil {
		return err
	}
	if u.Status == models.UserActive {
		return nil
	}
	u.Status = models.UserActive
	u.UpdatedAt = time.Now()
	if err := a.Store.UpdateUser(ctx, u); err != nil {
		return err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID:  actor.ID,
		Action:       "user.unsuspend",
		ResourceType: "user",
		ResourceID:   u.ID.String(),
		Meta:         map[string]any{"username": u.Username},
	})
	return nil
}

func (a *App) ResetUserPassword(ctx context.Context, actor models.User, target uuid.UUID, in ResetPasswordInput) (string, error) {
	u, err := a.loadManageTarget(ctx, actor, target)
	if err != nil {
		return "", err
	}
	if err := refuseSelf(actor, *u, "重置"); err != nil {
		return "", err
	}
	pwd := strings.TrimSpace(in.Password)
	if pwd == "" {
		pwd, err = auth.RandomPassword(12)
		if err != nil {
			return "", err
		}
	}
	if len(pwd) < 6 {
		return "", fmt.Errorf("密码长度至少 6 位")
	}
	hash, err := auth.HashPassword(pwd)
	if err != nil {
		return "", err
	}
	u.PasswordHash = hash
	u.TokenVersion++
	u.UpdatedAt = time.Now()
	if err := a.Store.UpdateUser(ctx, u); err != nil {
		return "", err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID:  actor.ID,
		Action:       "user.password_reset",
		ResourceType: "user",
		ResourceID:   u.ID.String(),
		Meta:         map[string]any{"username": u.Username},
	})
	return pwd, nil
}

func (a *App) PatchUser(ctx context.Context, actor models.User, target uuid.UUID, in PatchUserInput) (*models.User, error) {
	u, err := a.loadManageTarget(ctx, actor, target)
	if err != nil {
		return nil, err
	}
	if in.PlatformRole == nil && in.DisplayName == nil {
		return nil, store.ErrInvalidInput
	}

	changed := false
	if in.DisplayName != nil {
		name := strings.TrimSpace(*in.DisplayName)
		if name != u.DisplayName {
			u.DisplayName = name
			changed = true
		}
	}

	if in.PlatformRole != nil {
		role := strings.TrimSpace(*in.PlatformRole)
		switch role {
		case models.RolePlatformAdmin, models.RolePlatformOps, models.RolePlatformUser:
		default:
			return nil, store.ErrInvalidInput
		}
		if role != u.PlatformRole {
			if u.PlatformRole == models.RolePlatformAdmin && role != models.RolePlatformAdmin {
				if err := a.refuseLastAdmin(ctx, *u); err != nil {
					return nil, err
				}
			}
			if err := refuseSelf(actor, *u, "变更"); err != nil {
				return nil, err
			}
			from := u.PlatformRole
			u.PlatformRole = role
			u.TokenVersion++
			changed = true
			_ = a.Store.AddAudit(ctx, models.AuditLog{
				ActorUserID:  actor.ID,
				Action:       "user.role_change",
				ResourceType: "user",
				ResourceID:   u.ID.String(),
				Meta: map[string]any{
					"username": u.Username,
					"from":     from,
					"to":       role,
				},
			})
		}
	}

	if !changed {
		return u, nil
	}
	u.UpdatedAt = time.Now()
	if err := a.Store.UpdateUser(ctx, u); err != nil {
		return nil, err
	}
	return u, nil
}

func (a *App) DeleteUser(ctx context.Context, actor models.User, target uuid.UUID) error {
	u, err := a.loadManageTarget(ctx, actor, target)
	if err != nil {
		return err
	}
	if err := a.refuseLastAdmin(ctx, *u); err != nil {
		return err
	}
	if err := refuseSelf(actor, *u, "删除"); err != nil {
		return err
	}
	projects, err := a.Store.ListProjectsForUser(ctx, u.ID)
	if err != nil {
		return err
	}
	for _, p := range projects {
		if p.OwnerID == u.ID {
			return fmt.Errorf("该用户仍是项目「%s」的负责人，请先转让所有权", p.Name)
		}
	}
	for _, p := range projects {
		if err := a.Store.RemoveMembership(ctx, p.ID, u.ID); err != nil && err != store.ErrNotFound {
			return err
		}
	}
	keys, err := a.Store.ListSSHKeys(ctx, u.ID)
	if err != nil {
		return err
	}
	for _, k := range keys {
		if err := a.Store.DeleteSSHKey(ctx, u.ID, k.ID); err != nil && err != store.ErrNotFound {
			return err
		}
	}
	u.Status = models.UserDeleted
	u.TokenVersion++
	u.UpdatedAt = time.Now()
	if err := a.Store.UpdateUser(ctx, u); err != nil {
		return err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID:  actor.ID,
		Action:       "user.delete",
		ResourceType: "user",
		ResourceID:   u.ID.String(),
		Meta:         map[string]any{"username": u.Username},
	})
	return nil
}
