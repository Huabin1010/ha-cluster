package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/approval"
	"ha-cluster/internal/auth"
	"ha-cluster/internal/authz"
	hak8s "ha-cluster/internal/k8s"
	"ha-cluster/internal/ledger"
	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
	"ha-cluster/internal/webshell"
	"ha-cluster/internal/workspace"
)

var projectSlugRE = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func validProjectSlug(slug string) bool {
	return projectSlugRE.MatchString(slug)
}

func normalizeWorkspaceArch(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", models.ArchAny:
		return models.ArchAny
	case models.ArchAMD64, "x86_64", "x64":
		return models.ArchAMD64
	case models.ArchARM64, "aarch64", "arm":
		return models.ArchARM64
	default:
		return ""
	}
}

type App struct {
	Store     store.Store
	Ledger    *ledger.Service
	Runtime   workspace.Runtime
	K8s       hak8s.Cluster
	JWT       []byte
	AccessTTL time.Duration

	provisionCancel sync.Map // workspace ID → context.CancelFunc
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
		K8s:       hak8s.NewFromEnv(),
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
	role := models.RolePlatformUser
	users, err := a.Store.ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	if len(users) == 0 {
		role = models.RolePlatformAdmin
	}
	u := &models.User{
		ID: uuid.New(), Username: username, Email: email,
		PasswordHash: hash, PlatformRole: role,
		Status: models.UserActive, TokenVersion: 1, CreatedAt: now, UpdatedAt: now,
	}
	if err := a.Store.CreateUser(ctx, u); err != nil {
		if errors.Is(err, store.ErrConflict) {
			return nil, store.Wrap(store.ErrConflict, "用户名或邮箱已被占用")
		}
		return nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: u.ID, Action: "user.register", ResourceType: "user", ResourceID: u.ID.String(),
		Meta: userAuditMeta(u),
	})
	return u, nil
}

func (a *App) Login(ctx context.Context, username, password string) (string, *models.User, error) {
	u, err := a.Store.GetUserByUsername(ctx, username)
	if err != nil {
		return "", nil, store.ErrUnauthorized
	}
	if u.Status != models.UserActive {
		return "", nil, store.ErrAccountDisabled
	}
	if !auth.VerifyPassword(password, u.PasswordHash) {
		return "", nil, store.ErrUnauthorized
	}
	tok, err := auth.SignAccess(a.JWT, u.ID, u.Username, u.PlatformRole, u.TokenVersion, a.AccessTTL)
	if err != nil {
		return "", nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: u.ID, Action: "user.login", ResourceType: "user", ResourceID: u.ID.String(),
		Meta: userAuditMeta(u),
	})
	return tok, u, nil
}

const projectNameHint = "项目名称须为英文（字母、数字、空格或短横线，如 Office Snacks）"

func (a *App) CreateProject(ctx context.Context, actor uuid.UUID, name, slug, purpose string) (*models.Project, error) {
	normalized, ok := models.NormalizeProjectName(name)
	if !ok {
		return nil, store.Wrap(store.ErrInvalidInput, projectNameHint)
	}
	name = normalized
	slug = strings.ToLower(strings.TrimSpace(slug))
	if slug == "" || len(slug) > 64 || !validProjectSlug(slug) {
		return nil, store.ErrInvalidInput
	}
	purposeNorm, ok := models.NormalizeProjectPurpose(purpose)
	if !ok {
		return nil, store.ErrInvalidInput
	}
	if strings.EqualFold(purposeNorm, name) || strings.EqualFold(purposeNorm, slug) {
		return nil, store.ErrInvalidInput
	}
	p := &models.Project{ID: uuid.New(), Name: name, Slug: slug, Purpose: purposeNorm, OwnerID: actor, Status: "active", CreatedAt: time.Now()}
	if err := a.Store.CreateProject(ctx, p, models.RoleOwner); err != nil {
		if errors.Is(err, store.ErrConflict) {
			return nil, store.Wrap(store.ErrConflict, "slug "+slug+" 已被占用")
		}
		return nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor, Action: "project.create", ResourceType: "project", ResourceID: p.ID.String(),
		Meta: projectAuditMeta(p),
	})
	return p, nil
}

func (a *App) RequireMembership(ctx context.Context, user models.User, projectID uuid.UUID, minRole string) (*models.Membership, error) {
	m, err := authz.RequireProjectMember(ctx, a.Store, user, projectID, minRole)
	if err == authz.ErrNotFound {
		return nil, store.ErrNotFound
	}
	if err == authz.ErrForbidden {
		return nil, store.ErrForbidden
	}
	return m, err
}

func (a *App) requireProjectPurpose(ctx context.Context, projectID uuid.UUID) error {
	p, err := a.Store.GetProject(ctx, projectID)
	if err != nil {
		return err
	}
	if !models.HasProjectPurpose(p.Purpose) {
		return store.ErrPurposeRequired
	}
	return nil
}

// RequireProjectReady is membership plus a filled purpose. Use for mutations
// (create machine, members, SSH, ingress). GET / PATCH purpose / 删除项目除外。
func (a *App) RequireProjectReady(ctx context.Context, user models.User, projectID uuid.UUID, minRole string) (*models.Membership, error) {
	m, err := a.RequireMembership(ctx, user, projectID, minRole)
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectPurpose(ctx, projectID); err != nil {
		return nil, err
	}
	return m, nil
}

type CreateWorkspaceInput struct {
	ProjectID  uuid.UUID
	Name       string
	Plan       string
	Arch       string
	Visibility string
	Runtime    string
	CPUMilli   int64
	MemBytes   int64
	DiskBytes  int64
	Actor      models.User
}

func (a *App) CreateWorkspace(ctx context.Context, in CreateWorkspaceInput) (*models.Workspace, error) {
	mem, err := a.RequireProjectReady(ctx, in.Actor, in.ProjectID, models.RoleDeveloper)
	if err != nil {
		return nil, err
	}
	spec, err := models.ResolveSpec(in.Plan, in.CPUMilli, in.MemBytes, in.DiskBytes)
	if err != nil {
		return nil, store.ErrInvalidInput
	}
	arch := normalizeWorkspaceArch(in.Arch)
	if arch == "" {
		return nil, store.ErrInvalidInput
	}
	vis := in.Visibility
	if vis == "" {
		vis = models.VisShared
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = "ws-" + spec.Name
	}
	rt := models.NormalizeRuntime(in.Runtime)
	if rt == "" {
		return nil, store.ErrInvalidInput
	}
	if err := a.requireLiveK8s(ctx, rt); err != nil {
		return nil, err
	}
	in.Arch = arch
	in.Visibility = vis
	in.Name = name
	in.Plan = spec.Name
	in.Runtime = rt
	in.CPUMilli = spec.CPUMilli
	in.MemBytes = spec.MemBytes
	in.DiskBytes = spec.DiskBytes
	if approval.NeedsProjectApproval(mem.Role, approval.KindWorkspaceCreate) {
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
		Runtime: in.Runtime, Status: models.WSRequested, CreatedAt: now, UpdatedAt: now,
	}
	*w = w.ApplySpec(spec)
	if err := a.Store.CreateWorkspace(ctx, w); err != nil {
		return nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: in.Actor.ID, Action: "workspace.request",
		ResourceType: "workspace", ResourceID: w.ID.String(),
		Meta: map[string]any{
			"workspace_name": in.Name, "plan": spec.Name, "arch": in.Arch, "runtime": in.Runtime,
			"cpu_milli": spec.CPUMilli, "mem_bytes": spec.MemBytes, "disk_bytes": spec.DiskBytes,
		},
	})
	return w, nil
}

func (a *App) provisionNewWorkspace(ctx context.Context, in CreateWorkspaceInput, spec models.Plan) (*models.Workspace, error) {
	if err := a.checkProjectBudget(ctx, in.ProjectID, spec); err != nil {
		return nil, err
	}
	res, err := a.Ledger.Reserve(ctx, ledger.ReserveRequest{
		ProjectID: in.ProjectID, Plan: spec, Arch: in.Arch, RequireK8s: models.IsK8sRuntime(in.Runtime),
	})
	if err != nil {
		return nil, err
	}
	w := &models.Workspace{
		ID: uuid.New(), ProjectID: in.ProjectID, Name: in.Name, Plan: spec.Name,
		Arch: res.Node.Arch, Visibility: in.Visibility, OwnerUserID: in.Actor.ID,
		Runtime: in.Runtime, NodeID: res.Node.ID, AllocationID: res.Allocation.ID,
		Status: models.WSProvisioning, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	*w = w.ApplySpec(spec)
	if err := a.Store.CreateWorkspace(ctx, w); err != nil {
		_ = a.Ledger.Release(ctx, res.Allocation.ID)
		return nil, err
	}
	return a.startProvision(w, res.Node, res.Allocation.ID, in.Actor.ID, "workspace.create")
}

func (a *App) collectWorkspacePubkeys(ctx context.Context, w models.Workspace) []string {
	members, _ := a.Store.ListMemberships(ctx, w.ProjectID)
	ids := authz.CollectWorkspaceSSHUserIDs(members, w.OwnerUserID, w.Visibility)
	seen := map[string]struct{}{}
	var pubs []string
	for _, uid := range ids {
		keys, _ := a.Store.ListSSHKeys(ctx, uid)
		for _, k := range keys {
			p := strings.TrimSpace(k.PublicKey)
			if p == "" {
				continue
			}
			if _, ok := seen[p]; ok {
				continue
			}
			seen[p] = struct{}{}
			pubs = append(pubs, p)
		}
	}
	if k := strings.TrimSpace(webshell.AuthorizedKey()); k != "" {
		if _, ok := seen[k]; !ok {
			pubs = append(pubs, k)
		}
	}
	return pubs
}

func (a *App) WorkspaceSSHKeys(ctx context.Context, w models.Workspace) []string {
	return a.collectWorkspacePubkeys(ctx, w)
}

func (a *App) dropAbortedProvision(id, allocID uuid.UUID) {
	_ = a.Runtime.Destroy(context.Background(), id)
	if allocID != uuid.Nil {
		_ = a.Ledger.Release(context.Background(), allocID)
	}
}

func (a *App) commitProvisioningStatus(latest *models.Workspace) error {
	err := a.Store.UpdateWorkspaceIfStatus(context.Background(), latest, models.WSProvisioning)
	if err == nil {
		return nil
	}
	if errors.Is(err, store.ErrConflict) {
		_ = a.Runtime.Destroy(context.Background(), latest.ID)
		return fmt.Errorf("provision aborted: %w", err)
	}
	return err
}

func (a *App) finishProvision(ctx context.Context, w *models.Workspace, node models.Node, allocID, actorID uuid.UUID, action string) (*models.Workspace, error) {
	var inst workspace.Instance
	var launchErr error
	if models.IsK8sRuntime(w.Runtime) {
		slug := "ws"
		if p, perr := a.Store.GetProject(ctx, w.ProjectID); perr == nil && p != nil {
			slug = p.Slug
		}
		ns, _, err := a.K8s.Provision(ctx, *w, slug)
		if err != nil {
			launchErr = err
		} else if err := a.syncK8sPullSecrets(ctx, ns); err != nil {
			_ = a.K8s.DestroyNS(ctx, ns)
			launchErr = err
		} else {
			w.RuntimeRef = ns
			inst = workspace.Instance{ID: w.ID, NodeID: node.ID, Running: true}
		}
	} else {
		pubs := a.collectWorkspacePubkeys(ctx, *w)
		regs, err := a.CollectAutoInjectRegistryCreds(ctx)
		if err != nil {
			return nil, fmt.Errorf("docker registries: %w", err)
		}
		launchCtx := workspace.WithLaunchContext(ctx, workspace.LaunchContext{
			SSHKeys: pubs, DockerRegistries: regs,
		})
		inst, launchErr = a.Runtime.Launch(launchCtx, *w, node, pubs)
	}

	// Re-read after Launch: force-destroy during provisioning must not be
	// overwritten by a late running/failed write (the machine "comes back").
	latest, loadErr := a.Store.GetWorkspace(context.Background(), w.ID)
	if loadErr != nil {
		a.dropAbortedProvision(w.ID, allocID)
		return nil, loadErr
	}
	if !models.ProvisioningLive(latest.Status) {
		a.dropAbortedProvision(latest.ID, allocID)
		return latest, fmt.Errorf("provision aborted: workspace is %s", latest.Status)
	}

	if launchErr != nil {
		latest.Status = models.WSFailed
		latest.UpdatedAt = time.Now()
		if err := a.commitProvisioningStatus(latest); err != nil {
			return latest, fmt.Errorf("provision: %w", launchErr)
		}
		_ = a.Ledger.Release(context.Background(), allocID)
		return nil, fmt.Errorf("provision: %w", launchErr)
	}
	if err := a.Store.ActivateAllocation(context.Background(), allocID); err != nil {
		a.dropAbortedProvision(latest.ID, allocID)
		return nil, err
	}
	latest.Status = models.WSRunning
	latest.SSHPort = inst.SSHPort
	latest.HostKeyFP = inst.HostKeyFP
	if w.RuntimeRef != "" {
		latest.RuntimeRef = w.RuntimeRef
	}
	if w.Runtime != "" {
		latest.Runtime = w.Runtime
	}
	latest.UpdatedAt = time.Now()
	if err := a.commitProvisioningStatus(latest); err != nil {
		return latest, err
	}
	_ = a.Store.AddAudit(context.Background(), models.AuditLog{
		ActorUserID: actorID, Action: action,
		ResourceType: "workspace", ResourceID: latest.ID.String(),
		Meta: map[string]any{"workspace_name": latest.Name, "plan": latest.Plan, "node": node.Name},
	})
	return latest, nil
}

func (a *App) ApproveWorkspace(ctx context.Context, actor models.User, id uuid.UUID) (*models.Workspace, error) {
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return nil, err
	}
	if _, err := a.RequireProjectReady(ctx, actor, w.ProjectID, models.RoleAdmin); err != nil {
		return nil, err
	}
	if w.Status != models.WSRequested {
		return nil, store.ErrInvalidInput
	}
	spec := w.Spec()
	if spec.CPUMilli == 0 {
		return nil, store.ErrInvalidInput
	}
	if err := a.requireLiveK8s(ctx, w.Runtime); err != nil {
		return nil, err
	}
	if err := a.checkProjectBudget(ctx, w.ProjectID, spec); err != nil {
		return nil, err
	}
	res, err := a.Ledger.Reserve(ctx, ledger.ReserveRequest{
		ProjectID: w.ProjectID, Plan: spec, Arch: w.Arch, RequireK8s: models.IsK8sRuntime(w.Runtime),
	})
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
	return a.startProvision(w, res.Node, res.Allocation.ID, actor.ID, "workspace.approve")
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
	if _, err := a.RequireProjectReady(ctx, actor, w.ProjectID, models.RoleDeveloper); err != nil {
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
		return nil, store.Wrap(store.ErrConflict, "该工作区已有待审扩容")
	}
	cur := w.Spec()
	target, err := models.ResolveSpec("custom", cpu, mem, disk)
	if err != nil {
		return nil, store.ErrInvalidInput
	}
	kind, err := classifyResize(cur, target)
	if err != nil {
		return nil, err
	}
	if kind == models.ResizeUpgrade {
		delta := models.Plan{
			CPUMilli:  target.CPUMilli - cur.CPUMilli,
			MemBytes:  target.MemBytes - cur.MemBytes,
			DiskBytes: target.DiskBytes - cur.DiskBytes,
		}
		if err := a.checkProjectBudget(ctx, w.ProjectID, delta); err != nil {
			return nil, err
		}
	}
	w.PendingCPUMilli = target.CPUMilli
	w.PendingMemBytes = target.MemBytes
	w.PendingDiskBytes = target.DiskBytes
	w.ResizeStatus = models.ResizePending
	w.ResizeKind = kind
	w.UpdatedAt = time.Now()
	if err := a.Store.UpdateWorkspace(ctx, w); err != nil {
		return nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "workspace.resize.request",
		ResourceType: "workspace", ResourceID: w.ID.String(),
		Meta: resizeAuditMeta(w, cur, target, kind),
	})
	// Upgrade may apply immediately for project/platform admins.
	// Downgrade always stays pending so shrinking compute goes through review.
	if kind == models.ResizeUpgrade && a.actorCanApproveResize(ctx, actor, w.ProjectID) {
		return a.ApproveResize(ctx, actor, id)
	}
	return w, nil
}

func (a *App) actorCanApproveResize(ctx context.Context, actor models.User, projectID uuid.UUID) bool {
	_, err := a.RequireProjectReady(ctx, actor, projectID, models.RoleAdmin)
	return err == nil
}

func (a *App) ApproveResize(ctx context.Context, actor models.User, id uuid.UUID) (*models.Workspace, error) {
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return nil, err
	}
	if _, err := a.RequireProjectReady(ctx, actor, w.ProjectID, models.RoleAdmin); err != nil {
		return nil, err
	}
	if !w.HasPendingResize() {
		return nil, store.ErrInvalidInput
	}
	cur := w.Spec()
	target := models.Plan{Name: w.Plan, CPUMilli: w.PendingCPUMilli, MemBytes: w.PendingMemBytes, DiskBytes: w.PendingDiskBytes}
	kind := w.ResizeKind
	if kind == "" {
		kind, _ = classifyResize(cur, target)
	}
	deltaCPU := target.CPUMilli - cur.CPUMilli
	deltaMem := target.MemBytes - cur.MemBytes
	deltaDisk := target.DiskBytes - cur.DiskBytes
	if kind == models.ResizeUpgrade {
		if err := a.checkProjectBudget(ctx, w.ProjectID, models.Plan{CPUMilli: deltaCPU, MemBytes: deltaMem, DiskBytes: deltaDisk}); err != nil {
			return nil, err
		}
	}
	if w.AllocationID == uuid.Nil {
		return nil, store.ErrInvalidInput
	}
	if kind == models.ResizeDowngrade {
		if deltaCPU > 0 || deltaMem > 0 || deltaDisk > 0 {
			return nil, store.ErrInvalidInput
		}
		if err := a.Ledger.Shrink(ctx, w.AllocationID, -deltaCPU, -deltaMem, -deltaDisk); err != nil {
			return nil, err
		}
	} else {
		if err := a.Ledger.Expand(ctx, w.AllocationID, deltaCPU, deltaMem, deltaDisk); err != nil {
			return nil, err
		}
	}
	resized := w.ApplySpec(target)
	resized.PendingCPUMilli = 0
	resized.PendingMemBytes = 0
	resized.PendingDiskBytes = 0
	resized.ResizeStatus = ""
	resized.ResizeKind = ""
	resized.UpdatedAt = time.Now()
	if err := a.Runtime.Resize(ctx, resized); err != nil {
		if kind == models.ResizeDowngrade {
			_ = a.Ledger.Expand(ctx, w.AllocationID, deltaCPU, deltaMem, deltaDisk)
		} else {
			_ = a.Ledger.Expand(ctx, w.AllocationID, -deltaCPU, -deltaMem, -deltaDisk)
		}
		return nil, fmt.Errorf("resize: %w", err)
	}
	if err := a.Store.UpdateWorkspace(ctx, &resized); err != nil {
		return nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "workspace.resize.approve",
		ResourceType: "workspace", ResourceID: w.ID.String(),
		Meta: resizeAuditMeta(w, cur, target, kind),
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
	from := w.Spec()
	to := models.Plan{Name: w.Plan, CPUMilli: w.PendingCPUMilli, MemBytes: w.PendingMemBytes, DiskBytes: w.PendingDiskBytes}
	kind := w.ResizeKind
	w.PendingCPUMilli = 0
	w.PendingMemBytes = 0
	w.PendingDiskBytes = 0
	w.ResizeStatus = ""
	w.UpdatedAt = time.Now()
	if err := a.Store.UpdateWorkspace(ctx, w); err != nil {
		return err
	}
	meta := resizeAuditMeta(w, from, to, kind)
	if r := strings.TrimSpace(reason); r != "" {
		meta["reason"] = r
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "workspace.resize.reject",
		ResourceType: "workspace", ResourceID: w.ID.String(),
		Meta: meta,
	})
	return nil
}

// RequestDestroyWorkspace starts destroy. Developers need project then platform
// approval; project owner/admin skip the request queue and go to platform
// review; platform admins destroy immediately.
func (a *App) RequestDestroyWorkspace(ctx context.Context, actor models.User, id uuid.UUID) error {
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return err
	}
	mem, err := a.RequireMembership(ctx, actor, w.ProjectID, models.RoleDeveloper)
	if err != nil {
		return err
	}
	if w.Visibility == models.VisPrivate && w.OwnerUserID != actor.ID && actor.PlatformRole != models.RolePlatformAdmin {
		if mem == nil || models.RoleRank(mem.Role) < models.RoleRank(models.RoleAdmin) {
			return store.ErrForbidden
		}
	}
	switch w.Status {
	case models.WSDestroyRequested, models.WSDestroyPendingPlatform, models.WSDestroying, models.WSDestroyed:
		return store.Wrap(store.ErrConflict, "该工作区已在销毁流程中")
	}
	fromStatus := w.Status
	if authz.CanApproveDangerousOps(actor) {
		return a.executeDestroy(ctx, actor, w)
	}
	if models.CanApproveWorkspace(mem.Role) {
		w.Status = models.WSDestroyPendingPlatform
		w.UpdatedAt = time.Now()
		if err := a.Store.UpdateWorkspace(ctx, w); err != nil {
			return err
		}
		_ = a.Store.AddAudit(ctx, models.AuditLog{
			ActorUserID: actor.ID, Action: "workspace.destroy.request",
			ResourceType: "workspace", ResourceID: id.String(),
			Meta: map[string]any{"skip_project_review": true, "from_status": fromStatus},
		})
		_ = a.Store.AddAudit(ctx, models.AuditLog{
			ActorUserID: actor.ID, Action: "workspace.destroy.approve_project",
			ResourceType: "workspace", ResourceID: id.String(),
			Meta: map[string]any{"auto": true},
		})
		return nil
	}
	w.Status = models.WSDestroyRequested
	w.UpdatedAt = time.Now()
	if err := a.Store.UpdateWorkspace(ctx, w); err != nil {
		return err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "workspace.destroy.request",
		ResourceType: "workspace", ResourceID: id.String(),
		Meta: map[string]any{"from_status": fromStatus},
	})
	return nil
}

// ApproveDestroyProject project admin first pass; dangerous ops go to platform queue.
func (a *App) ApproveDestroyProject(ctx context.Context, actor models.User, id uuid.UUID) error {
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return err
	}
	if _, err := a.RequireMembership(ctx, actor, w.ProjectID, models.RoleAdmin); err != nil {
		return err
	}
	if w.Status == models.WSDestroyPendingPlatform {
		return nil
	}
	if w.Status != models.WSDestroyRequested {
		return store.ErrInvalidInput
	}
	next, err := approval.NextAfterProjectApprove(approval.KindWorkspaceDestroy)
	if err != nil {
		return err
	}
	if next == approval.PhasePendingPlatform {
		w.Status = models.WSDestroyPendingPlatform
	} else {
		return a.executeDestroy(ctx, actor, w)
	}
	w.UpdatedAt = time.Now()
	if err := a.Store.UpdateWorkspace(ctx, w); err != nil {
		return err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{ActorUserID: actor.ID, Action: "workspace.destroy.approve_project", ResourceType: "workspace", ResourceID: id.String()})
	return nil
}

// ApproveDestroyPlatform finalizes destroy after project approval.
func (a *App) ApproveDestroyPlatform(ctx context.Context, actor models.User, id uuid.UUID) error {
	if !authz.CanApproveDangerousOps(actor) {
		return store.ErrForbidden
	}
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return err
	}
	if w.Status != models.WSDestroyPendingPlatform {
		return store.ErrInvalidInput
	}
	return a.executeDestroy(ctx, actor, w)
}

// RejectDestroyProject turns down a project-level destroy request and restores the instance.
func (a *App) RejectDestroyProject(ctx context.Context, actor models.User, id uuid.UUID, reason string) error {
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return err
	}
	if _, err := a.RequireMembership(ctx, actor, w.ProjectID, models.RoleAdmin); err != nil {
		return err
	}
	if w.Status != models.WSDestroyRequested {
		return store.ErrInvalidInput
	}
	return a.restoreAfterDestroyReject(ctx, actor, w, reason, "workspace.destroy.reject_project")
}

// RejectDestroyPlatform turns down a platform destroy review and keeps the instance.
func (a *App) RejectDestroyPlatform(ctx context.Context, actor models.User, id uuid.UUID, reason string) error {
	if !authz.CanApproveDangerousOps(actor) {
		return store.ErrForbidden
	}
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return err
	}
	if w.Status != models.WSDestroyPendingPlatform {
		return store.ErrInvalidInput
	}
	return a.restoreAfterDestroyReject(ctx, actor, w, reason, "workspace.destroy.reject_platform")
}

func (a *App) restoreAfterDestroyReject(ctx context.Context, actor models.User, w *models.Workspace, reason, action string) error {
	from := models.RestoreStatusAfterDestroyReject("")
	if logs, err := a.Store.ListAuditByResource(ctx, w.ID.String(), 80); err == nil {
		for _, l := range logs {
			if l.Action == "workspace.destroy.request" {
				from = models.RestoreStatusAfterDestroyReject(auditMetaString(l.Meta, "from_status"))
				break
			}
		}
	}
	w.Status = from
	w.UpdatedAt = time.Now()
	if err := a.Store.UpdateWorkspace(ctx, w); err != nil {
		return err
	}
	meta := map[string]any{"restored_status": from}
	if r := strings.TrimSpace(reason); r != "" {
		meta["reason"] = r
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: action,
		ResourceType: "workspace", ResourceID: w.ID.String(),
		Meta: meta,
	})
	return nil
}

func auditMetaString(meta map[string]any, key string) string {
	if meta == nil {
		return ""
	}
	s, _ := meta[key].(string)
	return strings.TrimSpace(s)
}

func (a *App) executeDestroy(ctx context.Context, actor models.User, w *models.Workspace) error {
	a.abortInFlightProvision(w.ID)
	w.Status = models.WSDestroying
	w.UpdatedAt = time.Now()
	_ = a.Store.UpdateWorkspace(ctx, w)
	a.dropWorkspaceIngress(ctx, w.ID)
	if models.IsK8sRuntime(w.Runtime) {
		if w.RuntimeRef != "" {
			_ = a.K8s.DestroyNS(ctx, w.RuntimeRef)
		}
	} else {
		_ = a.Runtime.Destroy(ctx, w.ID)
	}
	if w.AllocationID != uuid.Nil {
		if err := a.Ledger.Release(ctx, w.AllocationID); err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
	}
	w.Status = models.WSDestroyed
	w.UpdatedAt = time.Now()
	_ = a.Store.UpdateWorkspace(ctx, w)
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "workspace.destroy", ResourceType: "workspace", ResourceID: w.ID.String(),
		Meta: workspaceAuditMeta(w),
	})
	return nil
}

// DestroyWorkspace is deprecated; use RequestDestroyWorkspace + approvals. Platform admin may force.
func (a *App) DestroyWorkspace(ctx context.Context, actor models.User, id uuid.UUID) error {
	if actor.PlatformRole == models.RolePlatformAdmin {
		w, err := a.Store.GetWorkspace(ctx, id)
		if err != nil {
			return err
		}
		return a.executeDestroy(ctx, actor, w)
	}
	return a.RequestDestroyWorkspace(ctx, actor, id)
}

func (a *App) StopWorkspace(ctx context.Context, actor models.User, id uuid.UUID) error {
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return err
	}
	if _, err := a.RequireProjectReady(ctx, actor, w.ProjectID, models.RoleDeveloper); err != nil {
		return err
	}
	if models.WorkspaceClosed(w.Status) || w.Status == models.WSRequested {
		return store.ErrInvalidInput
	}
	if !models.IsK8sRuntime(w.Runtime) {
		if err := a.Runtime.Stop(ctx, id); err != nil {
			return err
		}
	}
	w.Status = models.WSStopped
	w.UpdatedAt = time.Now()
	if err := a.Store.UpdateWorkspace(ctx, w); err != nil {
		return err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "workspace.stop",
		ResourceType: "workspace", ResourceID: id.String(),
		Meta: workspaceAuditMeta(w),
	})
	return nil
}

func (a *App) StartWorkspace(ctx context.Context, actor models.User, id uuid.UUID) error {
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return err
	}
	if _, err := a.RequireProjectReady(ctx, actor, w.ProjectID, models.RoleDeveloper); err != nil {
		return err
	}
	if models.WorkspaceClosed(w.Status) || w.Status == models.WSRequested {
		return store.ErrInvalidInput
	}
	if !models.IsK8sRuntime(w.Runtime) {
		if err := a.Runtime.Start(ctx, id); err != nil {
			return err
		}
		// 停机期间登记的公钥不会热同步；开机后再推一次，避免「运行中但 authorized_keys 为空」。
		if pubs := a.collectWorkspacePubkeys(ctx, *w); len(pubs) > 0 {
			_ = a.Runtime.SyncKeys(ctx, id, pubs)
		}
	} else if w.RuntimeRef != "" {
		if err := a.syncK8sPullSecrets(ctx, w.RuntimeRef); err != nil {
			return err
		}
	}
	w.Status = models.WSRunning
	now := time.Now()
	w.LastActivityAt = now
	w.UpdatedAt = now
	if err := a.Store.UpdateWorkspace(ctx, w); err != nil {
		return err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "workspace.start",
		ResourceType: "workspace", ResourceID: id.String(),
		Meta: workspaceAuditMeta(w),
	})
	return nil
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
	m, err := a.RequireProjectReady(ctx, actor, w.ProjectID, models.RoleDeveloper)
	if err != nil {
		return nil, nil, err
	}
	if !authz.CanSSHSession(actor, m, *w) {
		return nil, nil, store.ErrForbidden
	}
	if !models.WorkspaceConnectable(w.Status) {
		return nil, nil, store.ErrInvalidInput
	}
	if w.Status == models.WSSuspended || w.Status == models.WSStopped {
		if err := a.WakeWorkspaceIfSuspended(ctx, w); err != nil {
			return nil, nil, err
		}
		w, err = a.Store.GetWorkspace(ctx, workspaceID)
		if err != nil {
			return nil, nil, err
		}
	}
	a.touchWorkspaceActivity(ctx, w)
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
		if n.LanIP == "" {
			n.LanIP = existing.LanIP
		}
		n.Tags = models.NormalizeNodeTags(append(append([]string(nil), existing.Tags...), n.Tags...))
	} else {
		n.ID = uuid.New()
	}
	n.LastHeartbeat = time.Now()
	n.Ready = true
	n.HealthStatus = models.NodeHealthy
	if n.FabricPath == "degraded" || n.FabricPath == "offline" || n.FabricPath == "stale" {
		n.FabricPath = "p2p"
	}
	if n.Role == "" {
		n.Role = "worker"
	}
	if err := a.Store.UpsertNode(ctx, &n); err != nil {
		return nil, err
	}
	out, err := a.Store.GetNodeByName(ctx, n.Name)
	return out, err
}

func userAuditMeta(u *models.User) map[string]any {
	if u == nil {
		return nil
	}
	meta := map[string]any{"username": u.Username}
	if name := strings.TrimSpace(u.DisplayName); name != "" {
		meta["display_name"] = name
	}
	return meta
}

func projectAuditMeta(p *models.Project) map[string]any {
	if p == nil {
		return nil
	}
	return map[string]any{"project_name": p.Name, "project_slug": p.Slug, "project_purpose": p.Purpose}
}

func workspaceAuditMeta(w *models.Workspace) map[string]any {
	if w == nil {
		return nil
	}
	meta := map[string]any{}
	if w.Name != "" {
		meta["workspace_name"] = w.Name
	}
	if w.ProjectID != uuid.Nil {
		meta["project_id"] = w.ProjectID.String()
	}
	return meta
}

func resizeAuditMeta(w *models.Workspace, from, to models.Plan, kind string) map[string]any {
	meta := map[string]any{
		"kind":            kind,
		"from_cpu_milli":  from.CPUMilli,
		"from_mem_bytes":  from.MemBytes,
		"from_disk_bytes": from.DiskBytes,
		"to_cpu_milli":    to.CPUMilli,
		"to_mem_bytes":    to.MemBytes,
		"to_disk_bytes":   to.DiskBytes,
	}
	if w != nil && w.Name != "" {
		meta["workspace_name"] = w.Name
	}
	return meta
}

func classifyResize(cur, target models.Plan) (string, error) {
	if target.CPUMilli == cur.CPUMilli && target.MemBytes == cur.MemBytes && target.DiskBytes == cur.DiskBytes {
		return "", store.ErrNotExpansion
	}
	upgrade := target.CPUMilli > cur.CPUMilli || target.MemBytes > cur.MemBytes || target.DiskBytes > cur.DiskBytes
	downgrade := target.CPUMilli < cur.CPUMilli || target.MemBytes < cur.MemBytes || target.DiskBytes < cur.DiskBytes
	if upgrade && downgrade {
		return "", store.ErrInvalidInput
	}
	if upgrade {
		return models.ResizeUpgrade, nil
	}
	if downgrade {
		return models.ResizeDowngrade, nil
	}
	return "", store.ErrInvalidInput
}
