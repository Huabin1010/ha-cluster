package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/auth"
	"ha-cluster/internal/ledger"
	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
	"ha-cluster/internal/workspace"
)

var projectSlugRE = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func validProjectSlug(slug string) bool {
	return projectSlugRE.MatchString(slug)
}

type App struct {
	Store   store.Store
	Ledger  *ledger.Service
	Runtime workspace.Runtime
	JWT     []byte
	AccessTTL time.Duration
}

func New(st store.Store, rt workspace.Runtime, jwtSecret []byte) *App {
	if rt == nil {
		rt = workspace.NewMemoryRuntime()
	}
	if len(jwtSecret) == 0 {
		jwtSecret = []byte("dev-insecure-change-me")
	}
	return &App{
		Store:     st,
		Ledger:    &ledger.Service{Store: st},
		Runtime:   rt,
		JWT:       jwtSecret,
		AccessTTL: 15 * time.Minute,
	}
}

func (a *App) Register(ctx context.Context, username, email, password string) (*models.User, error) {
	username = strings.TrimSpace(username)
	email = strings.ToLower(strings.TrimSpace(email))
	if username == "" || email == "" || len(password) < 6 {
		return nil, store.ErrInvalidInput
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	u := &models.User{
		ID: uuid.New(), Username: username, Email: email,
		PasswordHash: hash, PlatformRole: models.RolePlatformUser,
		Status: models.UserActive, TokenVersion: 1, CreatedAt: now, UpdatedAt: now,
	}
	if err := a.Store.CreateUser(ctx, u); err != nil {
		return nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{ActorUserID: u.ID, Action: "user.register", ResourceType: "user", ResourceID: u.ID.String()})
	return u, nil
}

func (a *App) Login(ctx context.Context, username, password string) (string, *models.User, error) {
	u, err := a.Store.GetUserByUsername(ctx, username)
	if err != nil {
		return "", nil, store.ErrUnauthorized
	}
	if u.Status != models.UserActive || !auth.VerifyPassword(password, u.PasswordHash) {
		return "", nil, store.ErrUnauthorized
	}
	tok, err := auth.SignAccess(a.JWT, u.ID, u.Username, u.PlatformRole, u.TokenVersion, a.AccessTTL)
	if err != nil {
		return "", nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{ActorUserID: u.ID, Action: "user.login", ResourceType: "user", ResourceID: u.ID.String()})
	return tok, u, nil
}

func (a *App) CreateProject(ctx context.Context, actor uuid.UUID, name, slug string) (*models.Project, error) {
	name = strings.TrimSpace(name)
	slug = strings.ToLower(strings.TrimSpace(slug))
	if name == "" || slug == "" {
		return nil, store.ErrInvalidInput
	}
	if len(name) > 128 || len(slug) > 64 || !validProjectSlug(slug) {
		return nil, store.ErrInvalidInput
	}
	p := &models.Project{ID: uuid.New(), Name: name, Slug: slug, OwnerID: actor, Status: "active", CreatedAt: time.Now()}
	if err := a.Store.CreateProject(ctx, p, models.RoleOwner); err != nil {
		return nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{ActorUserID: actor, Action: "project.create", ResourceType: "project", ResourceID: p.ID.String()})
	return p, nil
}

func (a *App) RequireMembership(ctx context.Context, user models.User, projectID uuid.UUID, minRole string) (*models.Membership, error) {
	if user.PlatformRole == models.RolePlatformAdmin {
		return &models.Membership{ProjectID: projectID, UserID: user.ID, Role: models.RoleOwner}, nil
	}
	m, err := a.Store.GetMembership(ctx, projectID, user.ID)
	if err != nil {
		return nil, store.ErrForbidden
	}
	if models.RoleRank(m.Role) < models.RoleRank(minRole) {
		return nil, store.ErrForbidden
	}
	return m, nil
}

type CreateWorkspaceInput struct {
	ProjectID  uuid.UUID
	Name       string
	Plan       string
	Arch       string
	Visibility string
	Actor      models.User
}

func (a *App) CreateWorkspace(ctx context.Context, in CreateWorkspaceInput) (*models.Workspace, error) {
	if _, err := a.RequireMembership(ctx, in.Actor, in.ProjectID, models.RoleDeveloper); err != nil {
		return nil, err
	}
	plan, ok := models.Plans()[in.Plan]
	if !ok {
		return nil, store.ErrInvalidInput
	}
	arch := in.Arch
	if arch == "" {
		arch = models.ArchAny
	}
	vis := in.Visibility
	if vis == "" {
		vis = models.VisShared
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = "ws-" + in.Plan
	}
	if err := a.checkProjectBudget(ctx, in.ProjectID, plan); err != nil {
		return nil, err
	}

	res, err := a.Ledger.Reserve(ctx, ledger.ReserveRequest{ProjectID: in.ProjectID, Plan: plan, Arch: arch})
	if err != nil {
		return nil, err
	}
	w := &models.Workspace{
		ID: uuid.New(), ProjectID: in.ProjectID, Name: name, Plan: in.Plan,
		Arch: res.Node.Arch, Visibility: vis, OwnerUserID: in.Actor.ID,
		NodeID: res.Node.ID, AllocationID: res.Allocation.ID,
		Status: models.WSProvisioning, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	if err := a.Store.CreateWorkspace(ctx, w); err != nil {
		_ = a.Ledger.Release(ctx, res.Allocation.ID)
		return nil, err
	}
	keys, _ := a.Store.ListSSHKeys(ctx, in.Actor.ID)
	pubs := make([]string, 0, len(keys))
	for _, k := range keys {
		pubs = append(pubs, k.PublicKey)
	}
	inst, err := a.Runtime.Launch(ctx, *w, res.Node, pubs)
	if err != nil {
		w.Status = models.WSFailed
		_ = a.Store.UpdateWorkspace(ctx, w)
		_ = a.Ledger.Release(ctx, res.Allocation.ID)
		return nil, fmt.Errorf("provision: %w", err)
	}
	if err := a.Store.ActivateAllocation(ctx, res.Allocation.ID); err != nil {
		_ = a.Runtime.Destroy(ctx, w.ID)
		_ = a.Ledger.Release(ctx, res.Allocation.ID)
		return nil, err
	}
	w.Status = models.WSRunning
	w.SSHPort = inst.SSHPort
	w.HostKeyFP = inst.HostKeyFP
	w.UpdatedAt = time.Now()
	if err := a.Store.UpdateWorkspace(ctx, w); err != nil {
		return nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: in.Actor.ID, Action: "workspace.create",
		ResourceType: "workspace", ResourceID: w.ID.String(),
		Meta: map[string]any{"plan": in.Plan, "node": res.Node.Name},
	})
	return w, nil
}

func (a *App) DestroyWorkspace(ctx context.Context, actor models.User, id uuid.UUID) error {
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return err
	}
	if _, err := a.RequireMembership(ctx, actor, w.ProjectID, models.RoleDeveloper); err != nil {
		return err
	}
	if w.Visibility == models.VisPrivate && w.OwnerUserID != actor.ID && actor.PlatformRole != models.RolePlatformAdmin {
		m, _ := a.Store.GetMembership(ctx, w.ProjectID, actor.ID)
		if m == nil || models.RoleRank(m.Role) < models.RoleRank(models.RoleAdmin) {
			return store.ErrForbidden
		}
	}
	w.Status = models.WSDestroying
	_ = a.Store.UpdateWorkspace(ctx, w)
	_ = a.Runtime.Destroy(ctx, w.ID)
	if err := a.Ledger.Release(ctx, w.AllocationID); err != nil && !errors.Is(err, store.ErrNotFound) {
		return err
	}
	w.Status = models.WSDestroyed
	w.UpdatedAt = time.Now()
	_ = a.Store.UpdateWorkspace(ctx, w)
	_ = a.Store.AddAudit(ctx, models.AuditLog{ActorUserID: actor.ID, Action: "workspace.destroy", ResourceType: "workspace", ResourceID: id.String()})
	return nil
}

func (a *App) StopWorkspace(ctx context.Context, actor models.User, id uuid.UUID) error {
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return err
	}
	if _, err := a.RequireMembership(ctx, actor, w.ProjectID, models.RoleDeveloper); err != nil {
		return err
	}
	if err := a.Runtime.Stop(ctx, id); err != nil {
		return err
	}
	w.Status = models.WSStopped
	w.UpdatedAt = time.Now()
	return a.Store.UpdateWorkspace(ctx, w)
}

func (a *App) StartWorkspace(ctx context.Context, actor models.User, id uuid.UUID) error {
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return err
	}
	if _, err := a.RequireMembership(ctx, actor, w.ProjectID, models.RoleDeveloper); err != nil {
		return err
	}
	if err := a.Runtime.Start(ctx, id); err != nil {
		return err
	}
	w.Status = models.WSRunning
	w.UpdatedAt = time.Now()
	return a.Store.UpdateWorkspace(ctx, w)
}

func SSHFingerprint(pub string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(pub)))
	return hex.EncodeToString(sum[:])
}

func (a *App) SSHTarget(ctx context.Context, actor models.User, workspaceID uuid.UUID) (*models.Workspace, *models.Node, error) {
	w, err := a.Store.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	m, err := a.RequireMembership(ctx, actor, w.ProjectID, models.RoleDeveloper)
	if err != nil {
		return nil, nil, err
	}
	if !models.CanSSH(m.Role) && actor.PlatformRole != models.RolePlatformAdmin {
		return nil, nil, store.ErrForbidden
	}
	if w.Visibility == models.VisPrivate && w.OwnerUserID != actor.ID && models.RoleRank(m.Role) < models.RoleRank(models.RoleAdmin) {
		return nil, nil, store.ErrForbidden
	}
	if w.Status != models.WSRunning && w.Status != models.WSDegraded {
		return nil, nil, store.ErrInvalidInput
	}
	n, err := a.Store.GetNode(ctx, w.NodeID)
	if err != nil {
		return nil, nil, err
	}
	return w, n, nil
}

func (a *App) Heartbeat(ctx context.Context, n models.Node) (*models.Node, error) {
	if n.Name == "" || n.Arch == "" {
		return nil, store.ErrInvalidInput
	}
	existing, err := a.Store.GetNodeByName(ctx, n.Name)
	if err == nil {
		n.ID = existing.ID
	} else {
		n.ID = uuid.New()
	}
	n.LastHeartbeat = time.Now()
	n.Ready = true
	if n.Role == "" {
		n.Role = "worker"
	}
	if err := a.Store.UpsertNode(ctx, &n); err != nil {
		return nil, err
	}
	out, err := a.Store.GetNodeByName(ctx, n.Name)
	return out, err
}
