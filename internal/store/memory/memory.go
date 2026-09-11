package memory

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/requestmeta"
	"ha-cluster/internal/store"
)

// snapshotUser persists credentials that models.User hides from API JSON (json:"-").
type snapshotUser struct {
	ID           uuid.UUID `json:"id"`
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"password_hash,omitempty"`
	PlatformRole string    `json:"platform_role"`
	Status       string    `json:"status"`
	TokenVersion int       `json:"token_version,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type Snapshot struct {
	Users       map[uuid.UUID]*snapshotUser        `json:"users,omitempty"`
	SSHKeys     map[uuid.UUID]*models.SSHKey       `json:"ssh_keys,omitempty"`
	Projects    map[uuid.UUID]*models.Project      `json:"projects,omitempty"`
	Memberships map[string]models.Membership       `json:"memberships,omitempty"`
	Nodes       map[uuid.UUID]*models.Node         `json:"nodes,omitempty"`
	Allocs      map[uuid.UUID]*models.Allocation   `json:"allocs,omitempty"`
	Workspaces  map[uuid.UUID]*models.Workspace    `json:"workspaces,omitempty"`
	Audit       []models.AuditLog                  `json:"audit,omitempty"`
	AuditSeq    int64                              `json:"audit_seq,omitempty"`
	Invites     map[string]*models.Invitation      `json:"invites,omitempty"`
	Refresh     map[string]models.RefreshSession   `json:"refresh,omitempty"`
	Ingress     map[uuid.UUID]*models.IngressRoute `json:"ingress,omitempty"`
}

func userToSnapshot(u *models.User) *snapshotUser {
	if u == nil {
		return nil
	}
	return &snapshotUser{
		ID:           u.ID,
		Username:     u.Username,
		Email:        u.Email,
		PasswordHash: u.PasswordHash,
		PlatformRole: u.PlatformRole,
		Status:       u.Status,
		TokenVersion: u.TokenVersion,
		CreatedAt:    u.CreatedAt,
		UpdatedAt:    u.UpdatedAt,
	}
}

func snapshotToUser(u *snapshotUser) *models.User {
	if u == nil {
		return nil
	}
	return &models.User{
		ID:           u.ID,
		Username:     u.Username,
		Email:        u.Email,
		PasswordHash: u.PasswordHash,
		PlatformRole: u.PlatformRole,
		Status:       u.Status,
		TokenVersion: u.TokenVersion,
		CreatedAt:    u.CreatedAt,
		UpdatedAt:    u.UpdatedAt,
	}
}

type Store struct {
	mu               sync.Mutex
	snapshotPath     string
	users            map[uuid.UUID]*models.User
	userByName       map[string]uuid.UUID
	userByEmail      map[string]uuid.UUID
	sshKeys          map[uuid.UUID]*models.SSHKey
	projects         map[uuid.UUID]*models.Project
	memberships      map[string]models.Membership // projectID|userID
	nodes            map[uuid.UUID]*models.Node
	nodeByName       map[string]uuid.UUID
	allocs           map[uuid.UUID]*models.Allocation
	workspaces       map[uuid.UUID]*models.Workspace
	audit            []models.AuditLog
	auditSeq         int64
	invites          map[string]*models.Invitation
	refresh          map[string]models.RefreshSession
	ingress          map[uuid.UUID]*models.IngressRoute
	dockerRegistries map[uuid.UUID]*models.DockerRegistry
}

func New() *Store {
	return &Store{
		users:            map[uuid.UUID]*models.User{},
		userByName:       map[string]uuid.UUID{},
		userByEmail:      map[string]uuid.UUID{},
		sshKeys:          map[uuid.UUID]*models.SSHKey{},
		projects:         map[uuid.UUID]*models.Project{},
		memberships:      map[string]models.Membership{},
		nodes:            map[uuid.UUID]*models.Node{},
		nodeByName:       map[string]uuid.UUID{},
		allocs:           map[uuid.UUID]*models.Allocation{},
		workspaces:       map[uuid.UUID]*models.Workspace{},
		invites:          map[string]*models.Invitation{},
		refresh:          map[string]models.RefreshSession{},
		ingress:          map[uuid.UUID]*models.IngressRoute{},
		dockerRegistries: map[uuid.UUID]*models.DockerRegistry{},
	}
}

func memKey(pid, uid uuid.UUID) string { return pid.String() + "|" + uid.String() }

func (s *Store) CreateUser(_ context.Context, u *models.User) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	name := strings.ToLower(u.Username)
	email := strings.ToLower(u.Email)
	if _, ok := s.userByName[name]; ok {
		return store.ErrConflict
	}
	if _, ok := s.userByEmail[email]; ok {
		return store.ErrConflict
	}
	cp := *u
	s.users[u.ID] = &cp
	s.userByName[name] = u.ID
	s.userByEmail[email] = u.ID
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) GetUserByID(_ context.Context, id uuid.UUID) (*models.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := *u
	return &cp, nil
}

func (s *Store) GetUserByUsername(_ context.Context, username string) (*models.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, ok := s.userByName[strings.ToLower(username)]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := *s.users[id]
	return &cp, nil
}

func (s *Store) GetUserByEmail(_ context.Context, email string) (*models.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, ok := s.userByEmail[strings.ToLower(email)]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := *s.users[id]
	return &cp, nil
}

func (s *Store) ListUsers(_ context.Context) ([]models.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]models.User, 0, len(s.users))
	for _, u := range s.users {
		if u.Status == models.UserDeleted {
			continue
		}
		out = append(out, *u)
	}
	return out, nil
}

func (s *Store) UpdateUser(_ context.Context, u *models.User) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[u.ID]; !ok {
		return store.ErrNotFound
	}
	cp := *u
	s.users[u.ID] = &cp
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) AddSSHKey(_ context.Context, k *models.SSHKey) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.sshKeys {
		if e.Fingerprint == k.Fingerprint {
			return store.ErrConflict
		}
	}
	cp := *k
	s.sshKeys[k.ID] = &cp
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) ListSSHKeys(_ context.Context, userID uuid.UUID) ([]models.SSHKey, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []models.SSHKey
	for _, k := range s.sshKeys {
		if k.UserID == userID {
			out = append(out, *k)
		}
	}
	return out, nil
}

func (s *Store) DeleteSSHKey(_ context.Context, userID, keyID uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	k, ok := s.sshKeys[keyID]
	if !ok || k.UserID != userID {
		return store.ErrNotFound
	}
	delete(s.sshKeys, keyID)
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) GetSSHKeysByUsername(_ context.Context, username string) ([]models.SSHKey, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, ok := s.userByName[strings.ToLower(username)]
	if !ok {
		return nil, store.ErrNotFound
	}
	var out []models.SSHKey
	for _, k := range s.sshKeys {
		if k.UserID == id {
			out = append(out, *k)
		}
	}
	return out, nil
}

func (s *Store) CreateProject(_ context.Context, p *models.Project, ownerRole string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.projects {
		if e.Slug == p.Slug {
			return store.ErrConflict
		}
	}
	cp := *p
	s.projects[p.ID] = &cp
	ownerMem := models.Membership{ProjectID: p.ID, UserID: p.OwnerID, Role: ownerRole}
	models.NormalizeMembershipSSH(&ownerMem)
	s.memberships[memKey(p.ID, p.OwnerID)] = ownerMem
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) GetProject(_ context.Context, id uuid.UUID) (*models.Project, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.projects[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := *p
	return &cp, nil
}

func (s *Store) UpdateProject(_ context.Context, p *models.Project) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.projects[p.ID]; !ok {
		return store.ErrNotFound
	}
	for _, e := range s.projects {
		if e.ID != p.ID && e.Slug == p.Slug {
			return store.ErrConflict
		}
	}
	cp := *p
	s.projects[p.ID] = &cp
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) DeleteProject(_ context.Context, id uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.projects[id]; !ok {
		return store.ErrNotFound
	}
	delete(s.projects, id)
	for k, m := range s.memberships {
		if m.ProjectID == id {
			delete(s.memberships, k)
		}
	}
	for tok, inv := range s.invites {
		if inv.ProjectID == id {
			delete(s.invites, tok)
		}
	}
	for wid, w := range s.workspaces {
		if w.ProjectID == id {
			delete(s.workspaces, wid)
		}
	}
	for aid, a := range s.allocs {
		if a.ProjectID == id {
			delete(s.allocs, aid)
		}
	}
	for iid, r := range s.ingress {
		if r.ProjectID == id {
			delete(s.ingress, iid)
		}
	}
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) ListProjectsForUser(_ context.Context, userID uuid.UUID) ([]models.Project, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []models.Project
	for _, m := range s.memberships {
		if m.UserID == userID {
			if p, ok := s.projects[m.ProjectID]; ok {
				out = append(out, *p)
			}
		}
	}
	return out, nil
}

func (s *Store) AddMembership(_ context.Context, m models.Membership) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.projects[m.ProjectID]; !ok {
		return store.ErrNotFound
	}
	models.NormalizeMembershipSSH(&m)
	s.memberships[memKey(m.ProjectID, m.UserID)] = m
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) UpdateMembership(_ context.Context, m models.Membership) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := memKey(m.ProjectID, m.UserID)
	if _, ok := s.memberships[k]; !ok {
		return store.ErrNotFound
	}
	models.NormalizeMembershipSSH(&m)
	s.memberships[k] = m
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) RemoveMembership(_ context.Context, projectID, userID uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := memKey(projectID, userID)
	if _, ok := s.memberships[k]; !ok {
		return store.ErrNotFound
	}
	delete(s.memberships, k)
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) GetMembership(_ context.Context, projectID, userID uuid.UUID) (*models.Membership, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.memberships[memKey(projectID, userID)]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := m
	return &cp, nil
}

func (s *Store) ListMemberships(_ context.Context, projectID uuid.UUID) ([]models.Membership, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []models.Membership
	for _, m := range s.memberships {
		if m.ProjectID == projectID {
			out = append(out, m)
		}
	}
	return out, nil
}

func (s *Store) UpsertNode(_ context.Context, n *models.Node) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if existingID, ok := s.nodeByName[n.Name]; ok {
		old := s.nodes[existingID]
		n.ID = existingID
		n.UsedCPU = old.UsedCPU
		n.UsedMem = old.UsedMem
		n.UsedDisk = old.UsedDisk
		n.MachineType = old.MachineType
		n.Remark = old.Remark
		n.Tags = append([]string(nil), old.Tags...)
	} else if n.MachineType == "" {
		n.MachineType = models.MachineTypeSelf
	}
	cp := *n
	s.nodes[n.ID] = &cp
	s.nodeByName[n.Name] = n.ID
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) UpdateNodeMeta(_ context.Context, id uuid.UUID, machineType, remark string, tags []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	n, ok := s.nodes[id]
	if !ok {
		return store.ErrNotFound
	}
	n.MachineType = machineType
	n.Remark = remark
	n.Tags = append([]string(nil), tags...)
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) GetNode(_ context.Context, id uuid.UUID) (*models.Node, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n, ok := s.nodes[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := *n
	return &cp, nil
}

func (s *Store) GetNodeByName(_ context.Context, name string) (*models.Node, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, ok := s.nodeByName[name]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := *s.nodes[id]
	return &cp, nil
}

func (s *Store) ListNodes(_ context.Context) ([]models.Node, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]models.Node, 0, len(s.nodes))
	for _, n := range s.nodes {
		out = append(out, *n)
	}
	return out, nil
}

func (s *Store) DeleteNode(_ context.Context, id uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	n, ok := s.nodes[id]
	if !ok {
		return store.ErrNotFound
	}
	for _, a := range s.allocs {
		if a.NodeID == id && a.State != models.AllocReleased {
			return store.ErrConflict
		}
	}
	for aid, a := range s.allocs {
		if a.NodeID == id && a.State == models.AllocReleased {
			delete(s.allocs, aid)
		}
	}
	delete(s.nodes, id)
	delete(s.nodeByName, n.Name)
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) ReserveOnNode(_ context.Context, nodeID uuid.UUID, a *models.Allocation) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	n, ok := s.nodes[nodeID]
	if !ok {
		return store.ErrNotFound
	}
	if !n.Ready {
		return store.ErrNoCapacity
	}
	freeCPU := n.AllocatableCPU - n.UsedCPU
	freeMem := n.AllocatableMem - n.UsedMem
	freeDisk := n.AllocatableDisk - n.UsedDisk
	if freeCPU < a.CPUMilli || freeMem < a.MemBytes || freeDisk < a.DiskBytes {
		return store.ErrNoCapacity
	}
	n.UsedCPU += a.CPUMilli
	n.UsedMem += a.MemBytes
	n.UsedDisk += a.DiskBytes
	a.NodeID = nodeID
	a.State = models.AllocReserved
	cp := *a
	s.allocs[a.ID] = &cp
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) ReserveBestNode(_ context.Context, arch string, cpu, mem, disk int64, a *models.Allocation) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	type scored struct {
		id    uuid.UUID
		arch  string
		score int64
	}
	var best *scored
	for _, n := range s.nodes {
		if !n.Ready || n.Role == "control-plane" {
			continue
		}
		if arch != "" && arch != models.ArchAny && n.Arch != arch {
			continue
		}
		freeCPU := n.AllocatableCPU - n.UsedCPU
		freeMem := n.AllocatableMem - n.UsedMem
		freeDisk := n.AllocatableDisk - n.UsedDisk
		if freeCPU < cpu || freeMem < mem || freeDisk < disk {
			continue
		}
		score := freeMem
		if n.Power == "mains" {
			score += 1 << 40
		}
		if n.FabricPath == "p2p" {
			score += 1 << 30
		}
		if best == nil || score > best.score {
			best = &scored{id: n.ID, arch: n.Arch, score: score}
		}
	}
	if best == nil {
		return store.ErrNoCapacity
	}
	n := s.nodes[best.id]
	n.UsedCPU += cpu
	n.UsedMem += mem
	n.UsedDisk += disk
	a.NodeID = best.id
	if a.Arch == "" {
		a.Arch = best.arch
	}
	a.State = models.AllocReserved
	cp := *a
	s.allocs[a.ID] = &cp
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) ActivateAllocation(_ context.Context, id uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.allocs[id]
	if !ok {
		return store.ErrNotFound
	}
	if a.State == models.AllocReleased {
		return store.ErrAlreadyReleased
	}
	a.State = models.AllocActive
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) ReleaseAllocation(_ context.Context, id uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.allocs[id]
	if !ok {
		return store.ErrNotFound
	}
	if a.State == models.AllocReleased {
		return nil
	}
	n, ok := s.nodes[a.NodeID]
	if ok {
		n.UsedCPU -= a.CPUMilli
		n.UsedMem -= a.MemBytes
		n.UsedDisk -= a.DiskBytes
		if n.UsedCPU < 0 {
			n.UsedCPU = 0
		}
		if n.UsedMem < 0 {
			n.UsedMem = 0
		}
		if n.UsedDisk < 0 {
			n.UsedDisk = 0
		}
	}
	now := time.Now()
	a.State = models.AllocReleased
	a.ReleasedAt = &now
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) GetAllocation(_ context.Context, id uuid.UUID) (*models.Allocation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.allocs[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := *a
	return &cp, nil
}

func (s *Store) ExpandAllocation(_ context.Context, id uuid.UUID, dCPU, dMem, dDisk int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.allocs[id]
	if !ok {
		return store.ErrNotFound
	}
	if a.State == models.AllocReleased {
		return store.ErrAlreadyReleased
	}
	n, ok := s.nodes[a.NodeID]
	if !ok {
		return store.ErrNotFound
	}
	if dCPU > 0 && n.AllocatableCPU-n.UsedCPU < dCPU {
		return store.ErrNoCapacity
	}
	if dMem > 0 && n.AllocatableMem-n.UsedMem < dMem {
		return store.ErrNoCapacity
	}
	if dDisk > 0 && n.AllocatableDisk-n.UsedDisk < dDisk {
		return store.ErrNoCapacity
	}
	n.UsedCPU += dCPU
	n.UsedMem += dMem
	n.UsedDisk += dDisk
	if n.UsedCPU < 0 {
		n.UsedCPU = 0
	}
	if n.UsedMem < 0 {
		n.UsedMem = 0
	}
	if n.UsedDisk < 0 {
		n.UsedDisk = 0
	}
	a.CPUMilli += dCPU
	a.MemBytes += dMem
	a.DiskBytes += dDisk
	if a.CPUMilli < 0 {
		a.CPUMilli = 0
	}
	if a.MemBytes < 0 {
		a.MemBytes = 0
	}
	if a.DiskBytes < 0 {
		a.DiskBytes = 0
	}
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) CreateWorkspace(_ context.Context, w *models.Workspace) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.workspaces {
		if e.ProjectID == w.ProjectID && e.Name == w.Name && e.Status != models.WSDestroyed {
			return store.ErrConflict
		}
	}
	cp := *w
	s.workspaces[w.ID] = &cp
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) GetWorkspace(_ context.Context, id uuid.UUID) (*models.Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w, ok := s.workspaces[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := *w
	return &cp, nil
}

func (s *Store) ListWorkspaces(_ context.Context, projectID *uuid.UUID) ([]models.Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []models.Workspace
	for _, w := range s.workspaces {
		if projectID != nil && w.ProjectID != *projectID {
			continue
		}
		out = append(out, *w)
	}
	return out, nil
}

func (s *Store) UpdateWorkspace(_ context.Context, w *models.Workspace) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.workspaces[w.ID]; !ok {
		return store.ErrNotFound
	}
	cp := *w
	s.workspaces[w.ID] = &cp
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) AddAudit(ctx context.Context, l models.AuditLog) error {
	if l.IP == "" {
		l.IP = requestmeta.ClientIP(ctx)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.auditSeq++
	l.ID = s.auditSeq
	if l.CreatedAt.IsZero() {
		l.CreatedAt = time.Now()
	}
	s.audit = append(s.audit, l)
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) ListAudit(_ context.Context, limit int) ([]models.AuditLog, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if limit <= 0 || limit > len(s.audit) {
		limit = len(s.audit)
	}
	start := len(s.audit) - limit
	if start < 0 {
		start = 0
	}
	out := make([]models.AuditLog, limit)
	copy(out, s.audit[start:])
	for i := range out {
		if u := s.users[out[i].ActorUserID]; u != nil {
			out[i].ActorUsername = u.Username
		}
	}
	return out, nil
}

func (s *Store) ListAuditByResource(_ context.Context, resourceID string, limit int) ([]models.AuditLog, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	out := make([]models.AuditLog, 0)
	for i := len(s.audit) - 1; i >= 0 && len(out) < limit; i-- {
		l := s.audit[i]
		if l.ResourceID != resourceID {
			wsID, _ := l.Meta["workspace"].(string)
			if wsID != resourceID {
				continue
			}
		}
		if u := s.users[l.ActorUserID]; u != nil {
			l.ActorUsername = u.Username
		}
		out = append(out, l)
	}
	return out, nil
}

func (s *Store) ListAllocations(_ context.Context) ([]models.Allocation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]models.Allocation, 0, len(s.allocs))
	for _, a := range s.allocs {
		out = append(out, *a)
	}
	return out, nil
}

func (s *Store) CreateInvitation(_ context.Context, inv *models.Invitation) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := *inv
	s.invites[inv.Token] = &cp
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) GetInvitationByToken(_ context.Context, token string) (*models.Invitation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	inv, ok := s.invites[token]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := *inv
	return &cp, nil
}

func (s *Store) AcceptInvitation(_ context.Context, token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	inv, ok := s.invites[token]
	if !ok {
		return store.ErrNotFound
	}
	if inv.AcceptedAt != nil {
		return store.ErrConflict
	}
	now := time.Now()
	inv.AcceptedAt = &now
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) PutRefresh(_ context.Context, sess models.RefreshSession) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refresh[sess.Hash] = sess
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) GetRefreshByHash(_ context.Context, hash string) (*models.RefreshSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s1, ok := s.refresh[hash]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := s1
	return &cp, nil
}

func (s *Store) DeleteRefresh(_ context.Context, hash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.refresh, hash)
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) CreateIngress(_ context.Context, r *models.IngressRoute) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	dom := strings.ToLower(strings.TrimSpace(r.Domain))
	for _, e := range s.ingress {
		if strings.ToLower(e.Domain) == dom {
			return store.ErrConflict
		}
	}
	cp := *r
	s.ingress[r.ID] = &cp
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) GetIngress(_ context.Context, id uuid.UUID) (*models.IngressRoute, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.ingress[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := *r
	return &cp, nil
}

func (s *Store) GetIngressByDomain(_ context.Context, domain string) (*models.IngressRoute, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dom := strings.ToLower(strings.TrimSpace(domain))
	for _, r := range s.ingress {
		if strings.ToLower(r.Domain) == dom {
			cp := *r
			return &cp, nil
		}
	}
	return nil, store.ErrNotFound
}

func (s *Store) ListIngress(_ context.Context, workspaceID *uuid.UUID) ([]models.IngressRoute, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]models.IngressRoute, 0)
	for _, r := range s.ingress {
		if workspaceID != nil && r.WorkspaceID != *workspaceID {
			continue
		}
		out = append(out, *r)
	}
	return out, nil
}

func (s *Store) UpdateIngress(_ context.Context, r *models.IngressRoute) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.ingress[r.ID]; !ok {
		return store.ErrNotFound
	}
	dom := strings.ToLower(strings.TrimSpace(r.Domain))
	for _, e := range s.ingress {
		if e.ID != r.ID && strings.ToLower(e.Domain) == dom {
			return store.ErrConflict
		}
	}
	cp := *r
	s.ingress[r.ID] = &cp
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) DeleteIngress(_ context.Context, id uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.ingress[id]; !ok {
		return store.ErrNotFound
	}
	delete(s.ingress, id)
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) SetSnapshotPath(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshotPath = path
}

func (s *Store) SaveSnapshot() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveSnapshotFile(s.snapshotPath)
}

func (s *Store) saveSnapshotLocked() {
	if s.snapshotPath == "" {
		return
	}
	_ = s.saveSnapshotFile(s.snapshotPath)
}

func (s *Store) saveSnapshotFile(filePath string) error {
	if filePath == "" {
		return nil
	}
	users := make(map[uuid.UUID]*snapshotUser, len(s.users))
	for id, u := range s.users {
		users[id] = userToSnapshot(u)
	}
	snap := Snapshot{
		Users:       users,
		SSHKeys:     s.sshKeys,
		Projects:    s.projects,
		Memberships: s.memberships,
		Nodes:       s.nodes,
		Allocs:      s.allocs,
		Workspaces:  s.workspaces,
		Audit:       s.audit,
		AuditSeq:    s.auditSeq,
		Invites:     s.invites,
		Refresh:     s.refresh,
		Ingress:     s.ingress,
	}
	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(filePath)
	if dir != "" && dir != "." {
		_ = os.MkdirAll(dir, 0755)
	}
	return os.WriteFile(filePath, data, 0644)
}

func (s *Store) LoadSnapshot(filePath string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}
	var snap Snapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return err
	}
	if snap.Users != nil {
		s.users = make(map[uuid.UUID]*models.User, len(snap.Users))
		s.userByName = make(map[string]uuid.UUID)
		s.userByEmail = make(map[string]uuid.UUID)
		for id, su := range snap.Users {
			u := snapshotToUser(su)
			s.users[id] = u
			s.userByName[strings.ToLower(u.Username)] = id
			s.userByEmail[strings.ToLower(u.Email)] = id
		}
	}
	if snap.SSHKeys != nil {
		s.sshKeys = snap.SSHKeys
	}
	if snap.Projects != nil {
		s.projects = snap.Projects
	}
	if snap.Memberships != nil {
		s.memberships = snap.Memberships
	}
	if snap.Nodes != nil {
		s.nodes = snap.Nodes
		s.nodeByName = make(map[string]uuid.UUID)
		for id, n := range s.nodes {
			s.nodeByName[strings.ToLower(n.Name)] = id
		}
	}
	if snap.Allocs != nil {
		s.allocs = snap.Allocs
	}
	if snap.Workspaces != nil {
		s.workspaces = snap.Workspaces
	}
	if snap.Audit != nil {
		s.audit = snap.Audit
		s.auditSeq = snap.AuditSeq
	}
	if snap.Invites != nil {
		s.invites = snap.Invites
	}
	if snap.Refresh != nil {
		s.refresh = snap.Refresh
	}
	if snap.Ingress != nil {
		s.ingress = snap.Ingress
	}
	return nil
}
