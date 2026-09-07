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
	Store     store.Store
	Ledger    *ledger.Service
	Runtime   workspace.Runtime
	JWT       []byte
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
	CPUMilli   int64
	MemBytes   int64
	DiskBytes  int64
	Actor      models.User
}

func (a *App) CreateWorkspace(ctx context.Context, in CreateWorkspaceInput) (*models.Workspace, error) {
	mem, err := a.RequireMembership(ctx, in.Actor, in.ProjectID, models.RoleDeveloper)
	if err != nil {
		return nil, err
	}
	spec, err := models.ResolveSpec(in.Plan, in.CPUMilli, in.MemBytes, in.DiskBytes)
	if err != nil {
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
		name = "ws-" + spec.Name
	}
	in.Arch = arch
	in.Visibility = vis
	in.Name = name
	in.Plan = spec.Name
	in.CPUMilli = spec.CPUMilli
	in.MemBytes = spec.MemBytes
	in.DiskBytes = spec.DiskBytes
	if !models.CanApproveWorkspace(mem.Role) {
		return a.requestWorkspace(ctx, in, spec)
	}
	return a.provisionNewWorkspace(ctx, in, spec)
}

func (a *App) requestWorkspace(ctx context.Context, in CreateWorkspaceInput, spec models.Plan) (*models.Workspace, error) {
	if err := a.checkProjectBudget(ctx, in.ProjectID, spec); err != nil {
		return nil, err
	}
	now := time.Now()
	w := &models.Workspace{
		ID: uuid.New(), ProjectID: in.ProjectID, Name: in.Name, Plan: spec.Name,
		Arch: in.Arch, Visibility: in.Visibility, OwnerUserID: in.Actor.ID,
		Status: models.WSRequested, CreatedAt: now, UpdatedAt: now,
	}
	*w = w.ApplySpec(spec)
	if err := a.Store.CreateWorkspace(ctx, w); err != nil {
		return nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: in.Actor.ID, Action: "workspace.request",
		ResourceType: "workspace", ResourceID: w.ID.String(),
		Meta: map[string]any{"plan": spec.Name, "arch": in.Arch, "cpu_milli": spec.CPUMilli, "mem_bytes": spec.MemBytes, "disk_bytes": spec.DiskBytes},
	})
	return w, nil
}

func (a *App) provisionNewWorkspace(ctx context.Context, in CreateWorkspaceInput, spec models.Plan) (*models.Workspace, error) {
	if err := a.checkProjectBudget(ctx, in.ProjectID, spec); err != nil {
		return nil, err
	}
	res, err := a.Ledger.Reserve(ctx, ledger.ReserveRequest{ProjectID: in.ProjectID, Plan: spec, Arch: in.Arch})
	if err != nil {
		return nil, err
	}
	w := &models.Workspace{
		ID: uuid.New(), ProjectID: in.ProjectID, Name: in.Name, Plan: spec.Name,
		Arch: res.Node.Arch, Visibility: in.Visibility, OwnerUserID: in.Actor.ID,
		NodeID: res.Node.ID, AllocationID: res.Allocation.ID,
		Status: models.WSProvisioning, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	*w = w.ApplySpec(spec)
	if err := a.Store.CreateWorkspace(ctx, w); err != nil {
		_ = a.Ledger.Release(ctx, res.Allocation.ID)
		return nil, err
	}
	return a.finishProvision(ctx, w, res.Node, res.Allocation.ID, in.Actor.ID, "workspace.create")
}

func (a *App) finishProvision(ctx context.Context, w *models.Workspace, node models.Node, allocID, actorID uuid.UUID, action string) (*models.Workspace, error) {
	keys, _ := a.Store.ListSSHKeys(ctx, w.OwnerUserID)
	pubs := make([]string, 0, len(keys))
	for _, k := range keys {
		pubs = append(pubs, k.PublicKey)
	}
	inst, err := a.Runtime.Launch(ctx, *w, node, pubs)
	if err != nil {
		w.Status = models.WSFailed
		_ = a.Store.UpdateWorkspace(ctx, w)
		_ = a.Ledger.Release(ctx, allocID)
		return nil, fmt.Errorf("provision: %w", err)
	}
	if err := a.Store.ActivateAllocation(ctx, allocID); err != nil {
		_ = a.Runtime.Destroy(ctx, w.ID)
		_ = a.Ledger.Release(ctx, allocID)
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
		ActorUserID: actorID, Action: action,
		ResourceType: "workspace", ResourceID: w.ID.String(),
		Meta: map[string]any{"plan": w.Plan, "node": node.Name},
	})
	return w, nil
}

func (a *App) ApproveWorkspace(ctx context.Context, actor models.User, id uuid.UUID) (*models.Workspace, error) {
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return nil, err
	}
	if _, err := a.RequireMembership(ctx, actor, w.ProjectID, models.RoleAdmin); err != nil {
		return nil, err
	}
	if w.Status != models.WSRequested {
		return nil, store.ErrInvalidInput
	}
	spec := w.Spec()
	if spec.CPUMilli == 0 {
		return nil, store.ErrInvalidInput
	}
	if err := a.checkProjectBudget(ctx, w.ProjectID, spec); err != nil {
		return nil, err
	}
	res, err := a.Ledger.Reserve(ctx, ledger.ReserveRequest{ProjectID: w.ProjectID, Plan: spec, Arch: w.Arch})
	if err != nil {
		return nil, err
	}
	w.Arch = res.Node.Arch
	w.NodeID = res.Node.ID
	w.AllocationID = res.Allocation.ID
	w.Status = models.WSProvisioning
	w.UpdatedAt = time.Now()
	if err := a.Store.UpdateWorkspace(ctx, w); err != nil {
		_ = a.Ledger.Release(ctx, res.Allocation.ID)
		return nil, err
	}
	return a.finishProvision(ctx, w, res.Node, res.Allocation.ID, actor.ID, "workspace.approve")
}

func (a *App) RejectWorkspace(ctx context.Context, actor models.User, id uuid.UUID, reason string) error {
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return err
	}
	if _, err := a.RequireMembership(ctx, actor, w.ProjectID, models.RoleAdmin); err != nil {
		return err
	}
	if w.Status != models.WSRequested {
		return store.ErrInvalidInput
	}
	w.Status = models.WSRejected
	w.UpdatedAt = time.Now()
	if err := a.Store.UpdateWorkspace(ctx, w); err != nil {
		return err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "workspace.reject",
		ResourceType: "workspace", ResourceID: w.ID.String(),
		Meta: map[string]any{"reason": strings.TrimSpace(reason)},
	})
	return nil
}

func (a *App) RequestResize(ctx context.Context, actor models.User, id uuid.UUID, cpu, mem, disk int64) (*models.Workspace, error) {
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return nil, err
	}
	if _, err := a.RequireMembership(ctx, actor, w.ProjectID, models.RoleDeveloper); err != nil {
		return nil, err
	}
	if w.Visibility == models.VisPrivate && w.OwnerUserID != actor.ID && actor.PlatformRole != models.RolePlatformAdmin {
		m, _ := a.Store.GetMembership(ctx, w.ProjectID, actor.ID)
		if m == nil || models.RoleRank(m.Role) < models.RoleRank(models.RoleAdmin) {
			return nil, store.ErrForbidden
		}
	}
	switch w.Status {
	case models.WSRunning, models.WSStopped, models.WSDegraded:
	default:
		return nil, store.ErrInvalidInput
	}
	if w.HasPendingResize() {
		return nil, store.ErrConflict
	}
	cur := w.Spec()
	target, err := models.ResolveSpec("custom", cpu, mem, disk)
	if err != nil {
		return nil, store.ErrInvalidInput
	}
	if target.DiskBytes < cur.DiskBytes {
		return nil, store.ErrDiskShrink
	}
	if target.CPUMilli < cur.CPUMilli || target.MemBytes < cur.MemBytes {
		return nil, store.ErrNotExpansion
	}
	if target.CPUMilli == cur.CPUMilli && target.MemBytes == cur.MemBytes && target.DiskBytes == cur.DiskBytes {
		return nil, store.ErrNotExpansion
	}
	delta := models.Plan{
		CPUMilli:  target.CPUMilli - cur.CPUMilli,
		MemBytes:  target.MemBytes - cur.MemBytes,
		DiskBytes: target.DiskBytes - cur.DiskBytes,
	}
	if err := a.checkProjectBudget(ctx, w.ProjectID, delta); err != nil {
		return nil, err
	}
	w.PendingCPUMilli = target.CPUMilli
	w.PendingMemBytes = target.MemBytes
	w.PendingDiskBytes = target.DiskBytes
	w.ResizeStatus = models.ResizePending
	w.UpdatedAt = time.Now()
	if err := a.Store.UpdateWorkspace(ctx, w); err != nil {
		return nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "workspace.resize.request",
		ResourceType: "workspace", ResourceID: w.ID.String(),
		Meta: map[string]any{"cpu_milli": target.CPUMilli, "mem_bytes": target.MemBytes, "disk_bytes": target.DiskBytes},
	})
	return w, nil
}

func (a *App) ApproveResize(ctx context.Context, actor models.User, id uuid.UUID) (*models.Workspace, error) {
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return nil, err
	}
	if _, err := a.RequireMembership(ctx, actor, w.ProjectID, models.RoleAdmin); err != nil {
		return nil, err
	}
	if !w.HasPendingResize() {
		return nil, store.ErrInvalidInput
	}
	cur := w.Spec()
	target := models.Plan{Name: w.Plan, CPUMilli: w.PendingCPUMilli, MemBytes: w.PendingMemBytes, DiskBytes: w.PendingDiskBytes}
	if target.DiskBytes < cur.DiskBytes {
		return nil, store.ErrDiskShrink
	}
	if target.CPUMilli < cur.CPUMilli || target.MemBytes < cur.MemBytes {
		return nil, store.ErrNotExpansion
	}
	deltaCPU := target.CPUMilli - cur.CPUMilli
	deltaMem := target.MemBytes - cur.MemBytes
	deltaDisk := target.DiskBytes - cur.DiskBytes
	if err := a.checkProjectBudget(ctx, w.ProjectID, models.Plan{CPUMilli: deltaCPU, MemBytes: deltaMem, DiskBytes: deltaDisk}); err != nil {
		return nil, err
	}
	if w.AllocationID == uuid.Nil {
		return nil, store.ErrInvalidInput
	}
	if err := a.Ledger.Expand(ctx, w.AllocationID, deltaCPU, deltaMem, deltaDisk); err != nil {
		return nil, err
	}
	resized := w.ApplySpec(target)
	resized.PendingCPUMilli = 0
	resized.PendingMemBytes = 0
	resized.PendingDiskBytes = 0
	resized.ResizeStatus = ""
	resized.UpdatedAt = time.Now()
	if err := a.Runtime.Resize(ctx, resized); err != nil {
		_ = a.Ledger.Expand(ctx, w.AllocationID, -deltaCPU, -deltaMem, -deltaDisk)
		return nil, fmt.Errorf("resize: %w", err)
	}
	if err := a.Store.UpdateWorkspace(ctx, &resized); err != nil {
		return nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "workspace.resize.approve",
		ResourceType: "workspace", ResourceID: w.ID.String(),
		Meta: map[string]any{"cpu_milli": target.CPUMilli, "mem_bytes": target.MemBytes, "disk_bytes": target.DiskBytes},
	})
	return &resized, nil
}

func (a *App) RejectResize(ctx context.Context, actor models.User, id uuid.UUID, reason string) error {
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return err
	}
	if _, err := a.RequireMembership(ctx, actor, w.ProjectID, models.RoleDeveloper); err != nil {
		return err
	}
	if !w.HasPendingResize() {
		return store.ErrInvalidInput
	}
	w.PendingCPUMilli = 0
	w.PendingMemBytes = 0
	w.PendingDiskBytes = 0
	w.ResizeStatus = ""
	w.UpdatedAt = time.Now()
	if err := a.Store.UpdateWorkspace(ctx, w); err != nil {
		return err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "workspace.resize.reject",
		ResourceType: "workspace", ResourceID: w.ID.String(),
		Meta: map[string]any{"reason": strings.TrimSpace(reason)},
	})
	return nil
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
	a.dropWorkspaceIngress(ctx, w.ID)
	if w.AllocationID != uuid.Nil {
		_ = a.Runtime.Destroy(ctx, w.ID)
		if err := a.Ledger.Release(ctx, w.AllocationID); err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
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
	if w.Status == models.WSRequested || w.Status == models.WSRejected {
		return store.ErrInvalidInput
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
	if w.Status == models.WSRequested || w.Status == models.WSRejected {
		return store.ErrInvalidInput
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
