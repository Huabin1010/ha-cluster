package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/auth"
	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

type BatchUserInput struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name,omitempty"`
	Email       string `json:"email"`
	Password    string `json:"password,omitempty"`
}

type BatchCreateUsersInput struct {
	Users           []BatchUserInput `json:"users"`
	DefaultPassword string           `json:"default_password,omitempty"`
	ProjectID       *uuid.UUID       `json:"project_id,omitempty"`
	ProjectRole     string           `json:"project_role,omitempty"`
}

type BatchUserResultItem struct {
	Username       string     `json:"username"`
	Email          string     `json:"email"`
	Success        bool       `json:"success"`
	UserID         *uuid.UUID `json:"user_id,omitempty"`
	AddedToProject bool       `json:"added_to_project,omitempty"`
	Error          string     `json:"error,omitempty"`
}

type BatchCreateUsersResult struct {
	Total        int                   `json:"total"`
	CreatedCount int                   `json:"created_count"`
	FailedCount  int                   `json:"failed_count"`
	Results      []BatchUserResultItem `json:"results"`
}

func (a *App) BatchCreateUsers(ctx context.Context, actor models.User, in BatchCreateUsersInput) (*BatchCreateUsersResult, error) {
	targetRole := in.ProjectRole
	if targetRole == "" {
		targetRole = models.RoleDeveloper
	}

	if in.ProjectID != nil {
		if actor.PlatformRole != models.RolePlatformAdmin {
			callerMem, err := a.RequireMembership(ctx, actor, *in.ProjectID, models.RoleAdmin)
			if err != nil {
				return nil, store.ErrForbidden
			}
			if models.RoleRank(targetRole) >= models.RoleRank(models.RoleAdmin) && models.RoleRank(callerMem.Role) < models.RoleRank(models.RoleOwner) {
				return nil, store.ErrForbidden
			}
		} else {
			if _, err := a.Store.GetProject(ctx, *in.ProjectID); err != nil {
				return nil, err
			}
		}
	} else {
		if actor.PlatformRole != models.RolePlatformAdmin {
			return nil, store.ErrForbidden
		}
	}

	res := &BatchCreateUsersResult{
		Total:   len(in.Users),
		Results: make([]BatchUserResultItem, 0, len(in.Users)),
	}

	for _, u := range in.Users {
		uname := strings.TrimSpace(u.Username)
		email := strings.ToLower(strings.TrimSpace(u.Email))
		pwd := u.Password
		if pwd == "" {
			pwd = in.DefaultPassword
		}

		item := BatchUserResultItem{
			Username: uname,
			Email:    email,
		}

		if uname == "" {
			item.Error = "用户名不能为空"
			res.FailedCount++
			res.Results = append(res.Results, item)
			continue
		}
		if email == "" || !strings.Contains(email, "@") {
			item.Error = "邮箱格式无效"
			res.FailedCount++
			res.Results = append(res.Results, item)
			continue
		}
		if len(pwd) < 6 {
			item.Error = "密码长度至少 6 位"
			res.FailedCount++
			res.Results = append(res.Results, item)
			continue
		}

		hash, err := auth.HashPassword(pwd)
		if err != nil {
			item.Error = "密码加密失败"
			res.FailedCount++
			res.Results = append(res.Results, item)
			continue
		}

		now := time.Now()
		newUser := &models.User{
			ID:           uuid.New(),
			Username:     uname,
			DisplayName:  strings.TrimSpace(u.DisplayName),
			Email:        email,
			PasswordHash: hash,
			PlatformRole: models.RolePlatformUser,
			Status:       models.UserActive,
			TokenVersion: 1,
			CreatedAt:    now,
			UpdatedAt:    now,
		}

		err = a.Store.CreateUser(ctx, newUser)
		if err == nil {
			_ = a.Store.AddAudit(ctx, models.AuditLog{
				ActorUserID:  actor.ID,
				Action:       "user.create",
				ResourceType: "user",
				ResourceID:   newUser.ID.String(),
			})
			item.Success = true
			item.UserID = &newUser.ID

			if in.ProjectID != nil {
				m := models.Membership{
					ProjectID: *in.ProjectID,
					UserID:    newUser.ID,
					Role:      targetRole,
				}
				if addErr := a.Store.AddMembership(ctx, m); addErr == nil {
					item.AddedToProject = true
					_ = a.Store.AddAudit(ctx, models.AuditLog{
						ActorUserID:  actor.ID,
						Action:       "member.add",
						ResourceType: "membership",
						ResourceID:   in.ProjectID.String(),
					})
				}
			}

			res.CreatedCount++
			res.Results = append(res.Results, item)
			continue
		}

		if err == store.ErrConflict {
			if in.ProjectID != nil {
				existing, findErr := a.Store.GetUserByUsername(ctx, uname)
				if findErr != nil {
					existing, findErr = a.Store.GetUserByEmail(ctx, email)
				}
				if findErr == nil && existing != nil {
					_, memErr := a.Store.GetMembership(ctx, *in.ProjectID, existing.ID)
					if memErr == nil {
						item.Error = "该用户已是本项目成员"
						res.FailedCount++
						res.Results = append(res.Results, item)
						continue
					}
					m := models.Membership{
						ProjectID: *in.ProjectID,
						UserID:    existing.ID,
						Role:      targetRole,
					}
					if addErr := a.Store.AddMembership(ctx, m); addErr == nil {
						item.Success = true
						item.UserID = &existing.ID
						item.AddedToProject = true
						_ = a.Store.AddAudit(ctx, models.AuditLog{
							ActorUserID:  actor.ID,
							Action:       "member.add",
							ResourceType: "membership",
							ResourceID:   in.ProjectID.String(),
						})
						res.CreatedCount++
						res.Results = append(res.Results, item)
						continue
					}
				}
			}
			item.Error = "用户名或邮箱已存在"
			res.FailedCount++
			res.Results = append(res.Results, item)
			continue
		}

		item.Error = err.Error()
		res.FailedCount++
		res.Results = append(res.Results, item)
	}

	return res, nil
}
