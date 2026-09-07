package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/auth"
	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func (a *App) checkProjectBudget(ctx context.Context, projectID uuid.UUID, plan models.Plan) error {
	p, err := a.Store.GetProject(ctx, projectID)
	if err != nil {
		return err
	}
	if p.BudgetCPUMilli == 0 && p.BudgetMemBytes == 0 && p.BudgetDiskBytes == 0 {
		return nil
	}
	usedCPU, usedMem, usedDisk, err := a.projectUsed(ctx, projectID)
	if err != nil {
		return err
	}
	if p.BudgetCPUMilli > 0 && usedCPU+plan.CPUMilli > p.BudgetCPUMilli {
		return store.ErrNoCapacity
	}
	if p.BudgetMemBytes > 0 && usedMem+plan.MemBytes > p.BudgetMemBytes {
		return store.ErrNoCapacity
	}
	if p.BudgetDiskBytes > 0 && usedDisk+plan.DiskBytes > p.BudgetDiskBytes {
		return store.ErrNoCapacity
	}
	return nil
}

func (a *App) projectUsed(ctx context.Context, projectID uuid.UUID) (cpu, mem, disk int64, err error) {
	wss, err := a.Store.ListWorkspaces(ctx, &projectID)
	if err != nil {
		return 0, 0, 0, err
	}
	for _, ws := range wss {
		if ws.Status == models.WSDestroyed || ws.Status == models.WSFailed {
			continue
		}
		al, e := a.Store.GetAllocation(ctx, ws.AllocationID)
		if e != nil || al.State == models.AllocReleased {
			continue
		}
		cpu += al.CPUMilli
		mem += al.MemBytes
		disk += al.DiskBytes
	}
	return cpu, mem, disk, nil
}

func (a *App) LoginTokens(ctx context.Context, username, password string) (access, refresh string, u *models.User, err error) {
	access, u, err = a.Login(ctx, username, password)
	if err != nil {
		return "", "", nil, err
	}
	refresh, err = a.issueRefresh(ctx, u.ID)
	if err != nil {
		return "", "", nil, err
	}
	return access, refresh, u, nil
}

func (a *App) issueRefresh(ctx context.Context, userID uuid.UUID) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	plain := hex.EncodeToString(raw)
	sum := sha256.Sum256([]byte(plain))
	sess := models.RefreshSession{
		ID: uuid.New(), UserID: userID, Hash: hex.EncodeToString(sum[:]),
		ExpiresAt: time.Now().Add(30 * 24 * time.Hour),
	}
	if err := a.Store.PutRefresh(ctx, sess); err != nil {
		return "", err
	}
	return plain, nil
}

func (a *App) RefreshAccess(ctx context.Context, refresh string) (access, next string, u *models.User, err error) {
	sum := sha256.Sum256([]byte(strings.TrimSpace(refresh)))
	hash := hex.EncodeToString(sum[:])
	sess, err := a.Store.GetRefreshByHash(ctx, hash)
	if err != nil || time.Now().After(sess.ExpiresAt) {
		return "", "", nil, store.ErrUnauthorized
	}
	u, err = a.Store.GetUserByID(ctx, sess.UserID)
	if err != nil || u.Status != models.UserActive {
		return "", "", nil, store.ErrUnauthorized
	}
	_ = a.Store.DeleteRefresh(ctx, hash)
	access, err = auth.SignAccess(a.JWT, u.ID, u.Username, u.PlatformRole, u.TokenVersion, a.AccessTTL)
	if err != nil {
		return "", "", nil, err
	}
	next, err = a.issueRefresh(ctx, u.ID)
	return access, next, u, err
}

func (a *App) LogoutRefresh(ctx context.Context, refresh string) error {
	sum := sha256.Sum256([]byte(strings.TrimSpace(refresh)))
	return a.Store.DeleteRefresh(ctx, hex.EncodeToString(sum[:]))
}

func (a *App) Invite(ctx context.Context, actor models.User, projectID uuid.UUID, email, role string) (*models.Invitation, error) {
	if _, err := a.RequireMembership(ctx, actor, projectID, models.RoleAdmin); err != nil {
		return nil, err
	}
	if models.RoleRank(role) == 0 {
		role = models.RoleDeveloper
	}
	raw := make([]byte, 16)
	_, _ = rand.Read(raw)
	inv := &models.Invitation{
		ID: uuid.New(), ProjectID: projectID, Email: strings.ToLower(strings.TrimSpace(email)),
		Role: role, Token: hex.EncodeToString(raw), ExpiresAt: time.Now().Add(7 * 24 * time.Hour),
	}
	if err := a.Store.CreateInvitation(ctx, inv); err != nil {
		return nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{ActorUserID: actor.ID, Action: "invite.create", ResourceType: "project", ResourceID: projectID.String()})
	return inv, nil
}

func (a *App) AcceptInvite(ctx context.Context, user models.User, token string) (uuid.UUID, error) {
	inv, err := a.Store.GetInvitationByToken(ctx, token)
	if err != nil {
		return uuid.Nil, err
	}
	if inv.AcceptedAt != nil || time.Now().After(inv.ExpiresAt) {
		return uuid.Nil, store.ErrConflict
	}
	if err := a.Store.AddMembership(ctx, models.Membership{ProjectID: inv.ProjectID, UserID: user.ID, Role: inv.Role}); err != nil {
		return uuid.Nil, err
	}
	if err := a.Store.AcceptInvitation(ctx, token); err != nil {
		return uuid.Nil, err
	}
	return inv.ProjectID, nil
}

func (a *App) SuspendUser(ctx context.Context, actor models.User, target uuid.UUID) error {
	if actor.PlatformRole != models.RolePlatformAdmin {
		return store.ErrForbidden
	}
	u, err := a.Store.GetUserByID(ctx, target)
	if err != nil {
		return err
	}
	u.Status = models.UserSuspended
	u.TokenVersion++
	u.UpdatedAt = time.Now()
	return a.Store.UpdateUser(ctx, u)
}

func (a *App) Reconcile(ctx context.Context) (released int, staleNodes int, err error) {
	allocs, err := a.Store.ListAllocations(ctx)
	if err != nil {
		return 0, 0, err
	}
	wss, err := a.Store.ListWorkspaces(ctx, nil)
	if err != nil {
		return 0, 0, err
	}
	wsByAlloc := map[uuid.UUID]models.Workspace{}
	for _, w := range wss {
		wsByAlloc[w.AllocationID] = w
	}
	for _, al := range allocs {
		if al.State == models.AllocReleased {
			continue
		}
		w, ok := wsByAlloc[al.ID]
		if !ok || w.Status == models.WSDestroyed || w.Status == models.WSFailed {
			if e := a.Store.ReleaseAllocation(ctx, al.ID); e == nil {
				released++
			}
		}
	}
	nodes, err := a.Store.ListNodes(ctx)
	if err != nil {
		return released, 0, err
	}
	cutoff := time.Now().Add(-2 * time.Minute)
	for _, n := range nodes {
		if n.Role == "control-plane" {
			continue
		}
		if n.LastHeartbeat.Before(cutoff) && n.Ready {
			n.Ready = false
			n.FabricPath = "stale"
			_ = a.Store.UpsertNode(ctx, &n)
			staleNodes++
		}
	}
	return released, staleNodes, nil
}

func (a *App) AuthorizedKeys(ctx context.Context, username string) (string, error) {
	u, err := a.Store.GetUserByUsername(ctx, username)
	if err != nil {
		return "", err
	}
	if u.Status != models.UserActive {
		return "", store.ErrForbidden
	}
	keys, err := a.Store.ListSSHKeys(ctx, u.ID)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for _, k := range keys {
		fmt.Fprintf(&b, "%s\n", strings.TrimSpace(k.PublicKey))
	}
	return b.String(), nil
}
