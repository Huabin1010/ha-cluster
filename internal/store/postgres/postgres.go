package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	_ "embed"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

//go:embed sql/001_init.sql
var initSQL string

type Store struct {
	db *sql.DB
}

func Open(ctx context.Context, dsn string) (*Store, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(16)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err := db.ExecContext(ctx, initSQL); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func mapErr(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return store.ErrNotFound
	}
	return err
}

func (s *Store) CreateUser(ctx context.Context, u *models.User) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO users (id,username,email,password_hash,platform_role,status,token_version,created_at,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		u.ID, u.Username, u.Email, u.PasswordHash, u.PlatformRole, u.Status, u.TokenVersion, u.CreatedAt, u.UpdatedAt)
	if err != nil {
		return store.ErrConflict
	}
	return nil
}

func scanUser(row interface{ Scan(dest ...any) error }) (*models.User, error) {
	u := &models.User{}
	err := row.Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.PlatformRole, &u.Status, &u.TokenVersion, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, mapErr(err)
	}
	return u, nil
}

func (s *Store) GetUserByID(ctx context.Context, id uuid.UUID) (*models.User, error) {
	return scanUser(s.db.QueryRowContext(ctx, `SELECT id,username,email,password_hash,platform_role,status,token_version,created_at,updated_at FROM users WHERE id=$1`, id))
}
func (s *Store) GetUserByUsername(ctx context.Context, username string) (*models.User, error) {
	return scanUser(s.db.QueryRowContext(ctx, `SELECT id,username,email,password_hash,platform_role,status,token_version,created_at,updated_at FROM users WHERE lower(username)=lower($1)`, username))
}
func (s *Store) GetUserByEmail(ctx context.Context, email string) (*models.User, error) {
	return scanUser(s.db.QueryRowContext(ctx, `SELECT id,username,email,password_hash,platform_role,status,token_version,created_at,updated_at FROM users WHERE lower(email)=lower($1)`, email))
}

func (s *Store) ListUsers(ctx context.Context) ([]models.User, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,username,email,password_hash,platform_role,status,token_version,created_at,updated_at FROM users WHERE status<>'deleted'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}

func (s *Store) UpdateUser(ctx context.Context, u *models.User) error {
	_, err := s.db.ExecContext(ctx, `UPDATE users SET username=$2,email=$3,password_hash=$4,platform_role=$5,status=$6,token_version=$7,updated_at=$8 WHERE id=$1`,
		u.ID, u.Username, u.Email, u.PasswordHash, u.PlatformRole, u.Status, u.TokenVersion, u.UpdatedAt)
	return err
}

func (s *Store) AddSSHKey(ctx context.Context, k *models.SSHKey) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO ssh_keys (id,user_id,name,public_key,fingerprint,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
		k.ID, k.UserID, k.Name, k.PublicKey, k.Fingerprint, k.CreatedAt)
	if err != nil {
		return store.ErrConflict
	}
	return nil
}

func (s *Store) ListSSHKeys(ctx context.Context, userID uuid.UUID) ([]models.SSHKey, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,user_id,name,public_key,fingerprint,created_at FROM ssh_keys WHERE user_id=$1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.SSHKey
	for rows.Next() {
		var k models.SSHKey
		if err := rows.Scan(&k.ID, &k.UserID, &k.Name, &k.PublicKey, &k.Fingerprint, &k.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

func (s *Store) DeleteSSHKey(ctx context.Context, userID, keyID uuid.UUID) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM ssh_keys WHERE id=$1 AND user_id=$2`, keyID, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
}

func (s *Store) GetSSHKeysByUsername(ctx context.Context, username string) ([]models.SSHKey, error) {
	u, err := s.GetUserByUsername(ctx, username)
	if err != nil {
		return nil, err
	}
	return s.ListSSHKeys(ctx, u.ID)
}

func (s *Store) CreateProject(ctx context.Context, p *models.Project, ownerRole string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `INSERT INTO projects (id,name,slug,owner_id,status,budget_cpu_milli,budget_mem_bytes,budget_disk_bytes,created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, p.ID, p.Name, p.Slug, p.OwnerID, p.Status, p.BudgetCPUMilli, p.BudgetMemBytes, p.BudgetDiskBytes, p.CreatedAt)
	if err != nil {
		return store.ErrConflict
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO memberships (project_id,user_id,role) VALUES ($1,$2,$3)`, p.ID, p.OwnerID, ownerRole)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) GetProject(ctx context.Context, id uuid.UUID) (*models.Project, error) {
	p := &models.Project{}
	err := s.db.QueryRowContext(ctx, `SELECT id,name,slug,owner_id,status,budget_cpu_milli,budget_mem_bytes,budget_disk_bytes,created_at FROM projects WHERE id=$1`, id).
		Scan(&p.ID, &p.Name, &p.Slug, &p.OwnerID, &p.Status, &p.BudgetCPUMilli, &p.BudgetMemBytes, &p.BudgetDiskBytes, &p.CreatedAt)
	if err != nil {
		return nil, mapErr(err)
	}
	return p, nil
}

func (s *Store) UpdateProject(ctx context.Context, p *models.Project) error {
	_, err := s.db.ExecContext(ctx, `UPDATE projects SET name=$2,slug=$3,status=$4,budget_cpu_milli=$5,budget_mem_bytes=$6,budget_disk_bytes=$7 WHERE id=$1`,
		p.ID, p.Name, p.Slug, p.Status, p.BudgetCPUMilli, p.BudgetMemBytes, p.BudgetDiskBytes)
	return err
}

func (s *Store) ListProjectsForUser(ctx context.Context, userID uuid.UUID) ([]models.Project, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT p.id,p.name,p.slug,p.owner_id,p.status,p.budget_cpu_milli,p.budget_mem_bytes,p.budget_disk_bytes,p.created_at
		FROM projects p JOIN memberships m ON m.project_id=p.id WHERE m.user_id=$1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Project
	for rows.Next() {
		var p models.Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Slug, &p.OwnerID, &p.Status, &p.BudgetCPUMilli, &p.BudgetMemBytes, &p.BudgetDiskBytes, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) AddMembership(ctx context.Context, m models.Membership) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO memberships (project_id,user_id,role) VALUES ($1,$2,$3)
		ON CONFLICT (project_id,user_id) DO UPDATE SET role=EXCLUDED.role`, m.ProjectID, m.UserID, m.Role)
	return err
}

func (s *Store) RemoveMembership(ctx context.Context, projectID, userID uuid.UUID) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM memberships WHERE project_id=$1 AND user_id=$2`, projectID, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
}

func (s *Store) GetMembership(ctx context.Context, projectID, userID uuid.UUID) (*models.Membership, error) {
	m := &models.Membership{}
	err := s.db.QueryRowContext(ctx, `SELECT project_id,user_id,role FROM memberships WHERE project_id=$1 AND user_id=$2`, projectID, userID).
		Scan(&m.ProjectID, &m.UserID, &m.Role)
	if err != nil {
		return nil, mapErr(err)
	}
	return m, nil
}

func (s *Store) ListMemberships(ctx context.Context, projectID uuid.UUID) ([]models.Membership, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT project_id,user_id,role FROM memberships WHERE project_id=$1`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Membership
	for rows.Next() {
		var m models.Membership
		if err := rows.Scan(&m.ProjectID, &m.UserID, &m.Role); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func scanNode(row interface{ Scan(dest ...any) error }) (*models.Node, error) {
	n := &models.Node{}
	err := row.Scan(&n.ID, &n.Name, &n.Arch, &n.Class, &n.Power, &n.Role, &n.FabricIP, &n.LanIP, &n.BreakglassSSH,
		&n.AllocatableCPU, &n.AllocatableMem, &n.AllocatableDisk, &n.UsedCPU, &n.UsedMem, &n.UsedDisk,
		&n.FabricPath, &n.FabricRTTMS, &n.Ready, &n.LastHeartbeat)
	if err != nil {
		return nil, mapErr(err)
	}
	return n, nil
}

func (s *Store) UpsertNode(ctx context.Context, n *models.Node) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO nodes (id,name,arch,class,power,role,fabric_ip,lan_ip,breakglass_ssh,
		allocatable_cpu_milli,allocatable_mem_bytes,allocatable_disk_bytes,used_cpu_milli,used_mem_bytes,used_disk_bytes,
		fabric_path,fabric_rtt_ms,ready,last_heartbeat)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
		ON CONFLICT (name) DO UPDATE SET
			arch=EXCLUDED.arch, class=EXCLUDED.class, power=EXCLUDED.power, role=EXCLUDED.role,
			fabric_ip=EXCLUDED.fabric_ip, lan_ip=EXCLUDED.lan_ip, breakglass_ssh=EXCLUDED.breakglass_ssh,
			allocatable_cpu_milli=EXCLUDED.allocatable_cpu_milli, allocatable_mem_bytes=EXCLUDED.allocatable_mem_bytes,
			allocatable_disk_bytes=EXCLUDED.allocatable_disk_bytes,
			fabric_path=EXCLUDED.fabric_path, fabric_rtt_ms=EXCLUDED.fabric_rtt_ms, ready=EXCLUDED.ready,
			last_heartbeat=EXCLUDED.last_heartbeat`,
		n.ID, n.Name, n.Arch, n.Class, n.Power, n.Role, n.FabricIP, n.LanIP, n.BreakglassSSH,
		n.AllocatableCPU, n.AllocatableMem, n.AllocatableDisk, n.UsedCPU, n.UsedMem, n.UsedDisk,
		n.FabricPath, n.FabricRTTMS, n.Ready, n.LastHeartbeat)
	return err
}

func (s *Store) GetNode(ctx context.Context, id uuid.UUID) (*models.Node, error) {
	return scanNode(s.db.QueryRowContext(ctx, `SELECT id,name,arch,class,power,role,fabric_ip,lan_ip,breakglass_ssh,
		allocatable_cpu_milli,allocatable_mem_bytes,allocatable_disk_bytes,used_cpu_milli,used_mem_bytes,used_disk_bytes,
		fabric_path,fabric_rtt_ms,ready,last_heartbeat FROM nodes WHERE id=$1`, id))
}

func (s *Store) GetNodeByName(ctx context.Context, name string) (*models.Node, error) {
	return scanNode(s.db.QueryRowContext(ctx, `SELECT id,name,arch,class,power,role,fabric_ip,lan_ip,breakglass_ssh,
		allocatable_cpu_milli,allocatable_mem_bytes,allocatable_disk_bytes,used_cpu_milli,used_mem_bytes,used_disk_bytes,
		fabric_path,fabric_rtt_ms,ready,last_heartbeat FROM nodes WHERE name=$1`, name))
}

func (s *Store) ListNodes(ctx context.Context) ([]models.Node, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,arch,class,power,role,fabric_ip,lan_ip,breakglass_ssh,
		allocatable_cpu_milli,allocatable_mem_bytes,allocatable_disk_bytes,used_cpu_milli,used_mem_bytes,used_disk_bytes,
		fabric_path,fabric_rtt_ms,ready,last_heartbeat FROM nodes`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Node
	for rows.Next() {
		n, err := scanNode(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *n)
	}
	return out, rows.Err()
}

func (s *Store) ReserveOnNode(ctx context.Context, nodeID uuid.UUID, a *models.Allocation) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var ready bool
	var allocCPU, allocMem, allocDisk, usedCPU, usedMem, usedDisk int64
	err = tx.QueryRowContext(ctx, `SELECT ready,allocatable_cpu_milli,allocatable_mem_bytes,allocatable_disk_bytes,used_cpu_milli,used_mem_bytes,used_disk_bytes
		FROM nodes WHERE id=$1 FOR UPDATE`, nodeID).Scan(&ready, &allocCPU, &allocMem, &allocDisk, &usedCPU, &usedMem, &usedDisk)
	if err != nil {
		return mapErr(err)
	}
	if !ready || allocCPU-usedCPU < a.CPUMilli || allocMem-usedMem < a.MemBytes || allocDisk-usedDisk < a.DiskBytes {
		return store.ErrNoCapacity
	}
	_, err = tx.ExecContext(ctx, `UPDATE nodes SET used_cpu_milli=used_cpu_milli+$2, used_mem_bytes=used_mem_bytes+$3, used_disk_bytes=used_disk_bytes+$4 WHERE id=$1`,
		nodeID, a.CPUMilli, a.MemBytes, a.DiskBytes)
	if err != nil {
		return err
	}
	a.NodeID = nodeID
	a.State = models.AllocReserved
	_, err = tx.ExecContext(ctx, `INSERT INTO allocations (id,workspace_id,project_id,node_id,cpu_milli,mem_bytes,disk_bytes,arch,state,created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, a.ID, uuid.Nil, a.ProjectID, nodeID, a.CPUMilli, a.MemBytes, a.DiskBytes, a.Arch, a.State, a.CreatedAt)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ActivateAllocation(ctx context.Context, id uuid.UUID) error {
	res, err := s.db.ExecContext(ctx, `UPDATE allocations SET state=$2 WHERE id=$1 AND state<>$3`, id, models.AllocActive, models.AllocReleased)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
}

func (s *Store) ReleaseAllocation(ctx context.Context, id uuid.UUID) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var a models.Allocation
	err = tx.QueryRowContext(ctx, `SELECT id,project_id,node_id,cpu_milli,mem_bytes,disk_bytes,state FROM allocations WHERE id=$1 FOR UPDATE`, id).
		Scan(&a.ID, &a.ProjectID, &a.NodeID, &a.CPUMilli, &a.MemBytes, &a.DiskBytes, &a.State)
	if err != nil {
		return mapErr(err)
	}
	if a.State == models.AllocReleased {
		return tx.Commit()
	}
	_, err = tx.ExecContext(ctx, `UPDATE nodes SET used_cpu_milli=GREATEST(used_cpu_milli-$2,0), used_mem_bytes=GREATEST(used_mem_bytes-$3,0), used_disk_bytes=GREATEST(used_disk_bytes-$4,0) WHERE id=$1`,
		a.NodeID, a.CPUMilli, a.MemBytes, a.DiskBytes)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE allocations SET state=$2, released_at=$3 WHERE id=$1`, id, models.AllocReleased, time.Now())
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) GetAllocation(ctx context.Context, id uuid.UUID) (*models.Allocation, error) {
	a := &models.Allocation{}
	var ws sql.NullString
	var rel sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT id,workspace_id,project_id,node_id,cpu_milli,mem_bytes,disk_bytes,arch,state,created_at,released_at FROM allocations WHERE id=$1`, id).
		Scan(&a.ID, &ws, &a.ProjectID, &a.NodeID, &a.CPUMilli, &a.MemBytes, &a.DiskBytes, &a.Arch, &a.State, &a.CreatedAt, &rel)
	if err != nil {
		return nil, mapErr(err)
	}
	if rel.Valid {
		a.ReleasedAt = &rel.Time
	}
	return a, nil
}

func (s *Store) CreateWorkspace(ctx context.Context, w *models.Workspace) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO workspaces (id,project_id,name,plan,arch,visibility,owner_user_id,node_id,allocation_id,status,ssh_port,host_key_fp,created_at,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
		w.ID, w.ProjectID, w.Name, w.Plan, w.Arch, w.Visibility, w.OwnerUserID, w.NodeID, w.AllocationID, w.Status, w.SSHPort, w.HostKeyFP, w.CreatedAt, w.UpdatedAt)
	if err != nil {
		return store.ErrConflict
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE allocations SET workspace_id=$2 WHERE id=$1`, w.AllocationID, w.ID)
	return nil
}

func scanWS(row interface{ Scan(dest ...any) error }) (*models.Workspace, error) {
	w := &models.Workspace{}
	err := row.Scan(&w.ID, &w.ProjectID, &w.Name, &w.Plan, &w.Arch, &w.Visibility, &w.OwnerUserID, &w.NodeID, &w.AllocationID, &w.Status, &w.SSHPort, &w.HostKeyFP, &w.CreatedAt, &w.UpdatedAt)
	if err != nil {
		return nil, mapErr(err)
	}
	return w, nil
}

func (s *Store) GetWorkspace(ctx context.Context, id uuid.UUID) (*models.Workspace, error) {
	return scanWS(s.db.QueryRowContext(ctx, `SELECT id,project_id,name,plan,arch,visibility,owner_user_id,node_id,allocation_id,status,ssh_port,host_key_fp,created_at,updated_at FROM workspaces WHERE id=$1`, id))
}

func (s *Store) ListWorkspaces(ctx context.Context, projectID *uuid.UUID) ([]models.Workspace, error) {
	q := `SELECT id,project_id,name,plan,arch,visibility,owner_user_id,node_id,allocation_id,status,ssh_port,host_key_fp,created_at,updated_at FROM workspaces`
	var rows *sql.Rows
	var err error
	if projectID != nil {
		rows, err = s.db.QueryContext(ctx, q+` WHERE project_id=$1`, *projectID)
	} else {
		rows, err = s.db.QueryContext(ctx, q)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Workspace
	for rows.Next() {
		w, err := scanWS(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

func (s *Store) UpdateWorkspace(ctx context.Context, w *models.Workspace) error {
	_, err := s.db.ExecContext(ctx, `UPDATE workspaces SET name=$2,plan=$3,arch=$4,visibility=$5,status=$6,ssh_port=$7,host_key_fp=$8,updated_at=$9 WHERE id=$1`,
		w.ID, w.Name, w.Plan, w.Arch, w.Visibility, w.Status, w.SSHPort, w.HostKeyFP, w.UpdatedAt)
	return err
}

func (s *Store) AddAudit(ctx context.Context, l models.AuditLog) error {
	meta, _ := json.Marshal(l.Meta)
	_, err := s.db.ExecContext(ctx, `INSERT INTO audit_logs (actor_user_id,action,resource_type,resource_id,ip,meta,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		l.ActorUserID, l.Action, l.ResourceType, l.ResourceID, l.IP, meta, time.Now())
	return err
}

func (s *Store) ListAudit(ctx context.Context, limit int) ([]models.AuditLog, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,actor_user_id,action,resource_type,resource_id,ip,created_at FROM audit_logs ORDER BY id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.AuditLog
	for rows.Next() {
		var l models.AuditLog
		if err := rows.Scan(&l.ID, &l.ActorUserID, &l.Action, &l.ResourceType, &l.ResourceID, &l.IP, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *Store) ListAllocations(ctx context.Context) ([]models.Allocation, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,project_id,node_id,cpu_milli,mem_bytes,disk_bytes,arch,state,created_at FROM allocations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Allocation
	for rows.Next() {
		var a models.Allocation
		if err := rows.Scan(&a.ID, &a.ProjectID, &a.NodeID, &a.CPUMilli, &a.MemBytes, &a.DiskBytes, &a.Arch, &a.State, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Store) CreateInvitation(ctx context.Context, inv *models.Invitation) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO invitations (id,project_id,email,role,token,expires_at) VALUES ($1,$2,$3,$4,$5,$6)`,
		inv.ID, inv.ProjectID, inv.Email, inv.Role, inv.Token, inv.ExpiresAt)
	return err
}

func (s *Store) GetInvitationByToken(ctx context.Context, token string) (*models.Invitation, error) {
	inv := &models.Invitation{}
	var acc sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT id,project_id,email,role,token,expires_at,accepted_at FROM invitations WHERE token=$1`, token).
		Scan(&inv.ID, &inv.ProjectID, &inv.Email, &inv.Role, &inv.Token, &inv.ExpiresAt, &acc)
	if err != nil {
		return nil, mapErr(err)
	}
	if acc.Valid {
		inv.AcceptedAt = &acc.Time
	}
	return inv, nil
}

func (s *Store) AcceptInvitation(ctx context.Context, token string) error {
	res, err := s.db.ExecContext(ctx, `UPDATE invitations SET accepted_at=NOW() WHERE token=$1 AND accepted_at IS NULL`, token)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrConflict
	}
	return nil
}

func (s *Store) PutRefresh(ctx context.Context, sess models.RefreshSession) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO refresh_sessions (id,user_id,hash,expires_at) VALUES ($1,$2,$3,$4)`,
		sess.ID, sess.UserID, sess.Hash, sess.ExpiresAt)
	return err
}

func (s *Store) GetRefreshByHash(ctx context.Context, hash string) (*models.RefreshSession, error) {
	s1 := &models.RefreshSession{}
	err := s.db.QueryRowContext(ctx, `SELECT id,user_id,hash,expires_at FROM refresh_sessions WHERE hash=$1`, hash).
		Scan(&s1.ID, &s1.UserID, &s1.Hash, &s1.ExpiresAt)
	if err != nil {
		return nil, mapErr(err)
	}
	return s1, nil
}

func (s *Store) DeleteRefresh(ctx context.Context, hash string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM refresh_sessions WHERE hash=$1`, hash)
	return err
}
