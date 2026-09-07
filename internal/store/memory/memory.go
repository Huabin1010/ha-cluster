package memory

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

type Store struct {
	mu           sync.Mutex
	users        map[uuid.UUID]*models.User
	userByName   map[string]uuid.UUID
	userByEmail  map[string]uuid.UUID
	sshKeys      map[uuid.UUID]*models.SSHKey
	projects     map[uuid.UUID]*models.Project
	memberships  map[string]models.Membership // projectID|userID
	nodes        map[uuid.UUID]*models.Node
	nodeByName   map[string]uuid.UUID
	allocs       map[uuid.UUID]*models.Allocation
	workspaces   map[uuid.UUID]*models.Workspace
	audit        []models.AuditLog
	auditSeq     int64
	invites      map[string]*models.Invitation
	refresh      map[string]models.RefreshSession
}

func New() *Store {
	return &Store{
		users:       map[uuid.UUID]*models.User{},
		userByName:  map[string]uuid.UUID{},
		userByEmail: map[string]uuid.UUID{},
		sshKeys:     map[uuid.UUID]*models.SSHKey{},
		projects:    map[uuid.UUID]*models.Project{},
		memberships: map[string]models.Membership{},
		nodes:       map[uuid.UUID]*models.Node{},
		nodeByName:  map[string]uuid.UUID{},
		allocs:      map[uuid.UUID]*models.Allocation{},
		workspaces:  map[uuid.UUID]*models.Workspace{},
		invites:     map[string]*models.Invitation{},
		refresh:     map[string]models.RefreshSession{},
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
	s.memberships[memKey(p.ID, p.OwnerID)] = models.Membership{
		ProjectID: p.ID, UserID: p.OwnerID, Role: ownerRole,
	}
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
	cp := *p
	s.projects[p.ID] = &cp
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
	s.memberships[memKey(m.ProjectID, m.UserID)] = m
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
	if existingID, ok := s.nodeByName[n.Name]; ok && existingID != n.ID {
		old := s.nodes[existingID]
		n.ID = existingID
		n.UsedCPU = old.UsedCPU
		n.UsedMem = old.UsedMem
		n.UsedDisk = old.UsedDisk
	}
	cp := *n
	s.nodes[n.ID] = &cp
	s.nodeByName[n.Name] = n.ID
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
	return nil
}

func (s *Store) AddAudit(_ context.Context, l models.AuditLog) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.auditSeq++
	l.ID = s.auditSeq
	if l.CreatedAt.IsZero() {
		l.CreatedAt = time.Now()
	}
	s.audit = append(s.audit, l)
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
	return nil
}

func (s *Store) PutRefresh(_ context.Context, sess models.RefreshSession) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refresh[sess.Hash] = sess
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
	return nil
}

