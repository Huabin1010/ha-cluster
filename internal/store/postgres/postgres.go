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
	"ha-cluster/internal/requestmeta"
	"ha-cluster/internal/store"
)

//go:embed sql/001_init.sql
var initSQL string

//go:embed sql/002_workspace_spec.sql
var specSQL string

//go:embed sql/003_ingress.sql
var ingressSQL string

//go:embed sql/004_ingress_approval.sql
var ingressApprovalSQL string

//go:embed sql/005_node_metrics_and_activity.sql
var metricsSQL string

//go:embed sql/006_node_type_remark_tags.sql
var nodeMetaSQL string

//go:embed sql/007_membership_ssh.sql
var membershipSSHSQL string

//go:embed sql/008_workspace_destroy_resize.sql
var workspaceDestroySQL string

//go:embed sql/009_docker_registries.sql
var dockerRegistriesSQL string

//go:embed sql/010_node_host_totals.sql
var nodeHostTotalsSQL string

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
	if _, err := db.ExecContext(ctx, specSQL); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err := db.ExecContext(ctx, ingressSQL); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err := db.ExecContext(ctx, ingressApprovalSQL); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err := db.ExecContext(ctx, metricsSQL); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err := db.ExecContext(ctx, nodeMetaSQL); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err := db.ExecContext(ctx, membershipSSHSQL); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err := db.ExecContext(ctx, workspaceDestroySQL); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err := db.ExecContext(ctx, dockerRegistriesSQL); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err := db.ExecContext(ctx, nodeHostTotalsSQL); err != nil {
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

func nullTime(t time.Time) sql.NullTime {
	if t.IsZero() {
		return sql.NullTime{}
	}
	return sql.NullTime{Time: t, Valid: true}
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
	ownerMem := models.Membership{ProjectID: p.ID, UserID: p.OwnerID, Role: ownerRole}
	models.NormalizeMembershipSSH(&ownerMem)
	_, err = tx.ExecContext(ctx, `INSERT INTO memberships (project_id,user_id,role,ssh_access,ssh_mode) VALUES ($1,$2,$3,$4,$5)`,
		p.ID, p.OwnerID, ownerRole, ownerMem.SSHAccess, ownerMem.SSHMode)
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
	res, err := s.db.ExecContext(ctx, `UPDATE projects SET name=$2,slug=$3,status=$4,budget_cpu_milli=$5,budget_mem_bytes=$6,budget_disk_bytes=$7 WHERE id=$1`,
		p.ID, p.Name, p.Slug, p.Status, p.BudgetCPUMilli, p.BudgetMemBytes, p.BudgetDiskBytes)
	if err != nil {
		return store.ErrConflict
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
}

func (s *Store) DeleteProject(ctx context.Context, id uuid.UUID) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM ingress_routes WHERE project_id=$1`, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM workspaces WHERE project_id=$1`, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM allocations WHERE project_id=$1`, id); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM projects WHERE id=$1`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return tx.Commit()
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
	models.NormalizeMembershipSSH(&m)
	_, err := s.db.ExecContext(ctx, `INSERT INTO memberships (project_id,user_id,role,ssh_access,ssh_mode) VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (project_id,user_id) DO UPDATE SET role=EXCLUDED.role, ssh_access=EXCLUDED.ssh_access, ssh_mode=EXCLUDED.ssh_mode`,
		m.ProjectID, m.UserID, m.Role, m.SSHAccess, m.SSHMode)
	return err
}

func (s *Store) UpdateMembership(ctx context.Context, m models.Membership) error {
	models.NormalizeMembershipSSH(&m)
	res, err := s.db.ExecContext(ctx, `UPDATE memberships SET role=$3, ssh_access=$4, ssh_mode=$5 WHERE project_id=$1 AND user_id=$2`,
		m.ProjectID, m.UserID, m.Role, m.SSHAccess, m.SSHMode)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
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
	err := s.db.QueryRowContext(ctx, `SELECT project_id,user_id,role,ssh_access,ssh_mode FROM memberships WHERE project_id=$1 AND user_id=$2`, projectID, userID).
		Scan(&m.ProjectID, &m.UserID, &m.Role, &m.SSHAccess, &m.SSHMode)
	if err != nil {
		return nil, mapErr(err)
	}
	return m, nil
}

func (s *Store) ListMemberships(ctx context.Context, projectID uuid.UUID) ([]models.Membership, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT project_id,user_id,role,ssh_access,ssh_mode FROM memberships WHERE project_id=$1`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Membership
	for rows.Next() {
		var m models.Membership
		if err := rows.Scan(&m.ProjectID, &m.UserID, &m.Role, &m.SSHAccess, &m.SSHMode); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func scanNode(row interface{ Scan(dest ...any) error }) (*models.Node, error) {
	n := &models.Node{}
	var tagsRaw []byte
	err := row.Scan(&n.ID, &n.Name, &n.Arch, &n.Class, &n.Power, &n.Role, &n.FabricIP, &n.LanIP, &n.BreakglassSSH,
		&n.AllocatableCPU, &n.AllocatableMem, &n.AllocatableDisk, &n.UsedCPU, &n.UsedMem, &n.UsedDisk,
		&n.FabricPath, &n.FabricRTTMS, &n.HealthStatus, &n.CPUUsagePct, &n.MemAvailableBytes, &n.DiskFreeBytes,
		&n.MemTotalBytes, &n.DiskTotalBytes,
		&n.Ready, &n.LastHeartbeat, &n.MachineType, &n.Remark, &tagsRaw)
	if err != nil {
		return nil, mapErr(err)
	}
	if len(tagsRaw) > 0 {
		_ = json.Unmarshal(tagsRaw, &n.Tags)
	}
	return n, nil
}

const nodeCols = `id,name,arch,class,power,role,fabric_ip,lan_ip,breakglass_ssh,
		allocatable_cpu_milli,allocatable_mem_bytes,allocatable_disk_bytes,used_cpu_milli,used_mem_bytes,used_disk_bytes,
		fabric_path,fabric_rtt_ms,health_status,cpu_usage_pct,mem_available_bytes,disk_free_bytes,
		mem_total_bytes,disk_total_bytes,ready,last_heartbeat,
		machine_type,remark,tags`

func (s *Store) UpsertNode(ctx context.Context, n *models.Node) error {
	if n.HealthStatus == "" {
		n.HealthStatus = models.NodeHealthy
	}
	if n.MachineType == "" {
		n.MachineType = models.MachineTypeSelf
	}
	tagsJSON, err := json.Marshal(n.Tags)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO nodes (`+nodeCols+`)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
		ON CONFLICT (name) DO UPDATE SET
			arch=EXCLUDED.arch, class=EXCLUDED.class, power=EXCLUDED.power, role=EXCLUDED.role,
			fabric_ip=EXCLUDED.fabric_ip, lan_ip=EXCLUDED.lan_ip, breakglass_ssh=EXCLUDED.breakglass_ssh,
			allocatable_cpu_milli=EXCLUDED.allocatable_cpu_milli, allocatable_mem_bytes=EXCLUDED.allocatable_mem_bytes,
			allocatable_disk_bytes=EXCLUDED.allocatable_disk_bytes,
			fabric_path=EXCLUDED.fabric_path, fabric_rtt_ms=EXCLUDED.fabric_rtt_ms,
			health_status=EXCLUDED.health_status, cpu_usage_pct=EXCLUDED.cpu_usage_pct,
			mem_available_bytes=EXCLUDED.mem_available_bytes, disk_free_bytes=EXCLUDED.disk_free_bytes,
			mem_total_bytes=EXCLUDED.mem_total_bytes, disk_total_bytes=EXCLUDED.disk_total_bytes,
			ready=EXCLUDED.ready, last_heartbeat=EXCLUDED.last_heartbeat`,
		n.ID, n.Name, n.Arch, n.Class, n.Power, n.Role, n.FabricIP, n.LanIP, n.BreakglassSSH,
		n.AllocatableCPU, n.AllocatableMem, n.AllocatableDisk, n.UsedCPU, n.UsedMem, n.UsedDisk,
		n.FabricPath, n.FabricRTTMS, n.HealthStatus, n.CPUUsagePct, n.MemAvailableBytes, n.DiskFreeBytes,
		n.MemTotalBytes, n.DiskTotalBytes,
		n.Ready, n.LastHeartbeat, n.MachineType, n.Remark, tagsJSON)
	return err
}

func (s *Store) UpdateNodeMeta(ctx context.Context, id uuid.UUID, machineType, remark string, tags []string) error {
	tagsJSON, err := json.Marshal(tags)
	if err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx, `UPDATE nodes SET machine_type=$2, remark=$3, tags=$4 WHERE id=$1`,
		id, machineType, remark, tagsJSON)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrNotFound
	}
	return nil
}

func (s *Store) GetNode(ctx context.Context, id uuid.UUID) (*models.Node, error) {
	return scanNode(s.db.QueryRowContext(ctx, `SELECT `+nodeCols+` FROM nodes WHERE id=$1`, id))
}

func (s *Store) GetNodeByName(ctx context.Context, name string) (*models.Node, error) {
	return scanNode(s.db.QueryRowContext(ctx, `SELECT `+nodeCols+` FROM nodes WHERE name=$1`, name))
}

func (s *Store) ListNodes(ctx context.Context) ([]models.Node, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+nodeCols+` FROM nodes`)
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

func (s *Store) DeleteNode(ctx context.Context, id uuid.UUID) error {
	if _, err := s.db.ExecContext(ctx,
		`DELETE FROM allocations WHERE node_id=$1 AND state=$2`, id, models.AllocReleased); err != nil {
		return err
	}
	var active int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM allocations WHERE node_id=$1 AND state <> $2`, id, models.AllocReleased).Scan(&active); err != nil {
		return err
	}
	if active > 0 {
		return store.ErrConflict
	}
	res, err := s.db.ExecContext(ctx, `DELETE FROM nodes WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrNotFound
	}
	return nil
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

func (s *Store) ReserveBestNode(ctx context.Context, arch string, cpu, mem, disk int64, a *models.Allocation) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	archFilter := arch
	if archFilter == "" || archFilter == models.ArchAny {
		archFilter = ""
	}

	q := `SELECT id, arch, ready, allocatable_cpu_milli, allocatable_mem_bytes, allocatable_disk_bytes,
		used_cpu_milli, used_mem_bytes, used_disk_bytes, power, fabric_path
		FROM nodes
		WHERE role <> 'control-plane' AND ready = true`
	args := []any{}
	if archFilter != "" {
		q += ` AND arch = $1`
		args = append(args, archFilter)
	}
	q += ` ORDER BY
		(allocatable_mem_bytes - used_mem_bytes) DESC,
		CASE WHEN power = 'mains' THEN 1 ELSE 0 END DESC,
		CASE WHEN fabric_path = 'p2p' THEN 1 ELSE 0 END DESC
		FOR UPDATE SKIP LOCKED`

	rows, err := tx.QueryContext(ctx, q, args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	var pickedID uuid.UUID
	var pickedArch string
	for rows.Next() {
		var id uuid.UUID
		var nodeArch string
		var ready bool
		var allocCPU, allocMem, allocDisk, usedCPU, usedMem, usedDisk int64
		var power, fabricPath string
		if err := rows.Scan(&id, &nodeArch, &ready, &allocCPU, &allocMem, &allocDisk, &usedCPU, &usedMem, &usedDisk, &power, &fabricPath); err != nil {
			return err
		}
		if !ready || allocCPU-usedCPU < cpu || allocMem-usedMem < mem || allocDisk-usedDisk < disk {
			continue
		}
		pickedID = id
		pickedArch = nodeArch
		break
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if pickedID == uuid.Nil {
		return store.ErrNoCapacity
	}

	_, err = tx.ExecContext(ctx, `UPDATE nodes SET used_cpu_milli=used_cpu_milli+$2, used_mem_bytes=used_mem_bytes+$3, used_disk_bytes=used_disk_bytes+$4 WHERE id=$1`,
		pickedID, cpu, mem, disk)
	if err != nil {
		return err
	}
	a.NodeID = pickedID
	if a.Arch == "" {
		a.Arch = pickedArch
	}
	a.State = models.AllocReserved
	_, err = tx.ExecContext(ctx, `INSERT INTO allocations (id,workspace_id,project_id,node_id,cpu_milli,mem_bytes,disk_bytes,arch,state,created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, a.ID, uuid.Nil, a.ProjectID, pickedID, cpu, mem, disk, a.Arch, a.State, a.CreatedAt)
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

func (s *Store) ExpandAllocation(ctx context.Context, id uuid.UUID, dCPU, dMem, dDisk int64) error {
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
		return store.ErrAlreadyReleased
	}
	var allocCPU, allocMem, allocDisk, usedCPU, usedMem, usedDisk int64
	err = tx.QueryRowContext(ctx, `SELECT allocatable_cpu_milli,allocatable_mem_bytes,allocatable_disk_bytes,used_cpu_milli,used_mem_bytes,used_disk_bytes
		FROM nodes WHERE id=$1 FOR UPDATE`, a.NodeID).Scan(&allocCPU, &allocMem, &allocDisk, &usedCPU, &usedMem, &usedDisk)
	if err != nil {
		return mapErr(err)
	}
	if dCPU > 0 && allocCPU-usedCPU < dCPU {
		return store.ErrNoCapacity
	}
	if dMem > 0 && allocMem-usedMem < dMem {
		return store.ErrNoCapacity
	}
	if dDisk > 0 && allocDisk-usedDisk < dDisk {
		return store.ErrNoCapacity
	}
	_, err = tx.ExecContext(ctx, `UPDATE nodes SET used_cpu_milli=GREATEST(used_cpu_milli+$2,0), used_mem_bytes=GREATEST(used_mem_bytes+$3,0), used_disk_bytes=GREATEST(used_disk_bytes+$4,0) WHERE id=$1`,
		a.NodeID, dCPU, dMem, dDisk)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE allocations SET cpu_milli=GREATEST(cpu_milli+$2,0), mem_bytes=GREATEST(mem_bytes+$3,0), disk_bytes=GREATEST(disk_bytes+$4,0) WHERE id=$1`,
		id, dCPU, dMem, dDisk)
	if err != nil {
		return err
	}
	return tx.Commit()
}

const wsCols = `id,project_id,name,plan,arch,visibility,owner_user_id,node_id,allocation_id,status,ssh_port,host_key_fp,created_at,updated_at,cpu_milli,mem_bytes,disk_bytes,pending_cpu_milli,pending_mem_bytes,pending_disk_bytes,resize_status,resize_kind,last_activity_at,idle_suspend_hours`

func (s *Store) CreateWorkspace(ctx context.Context, w *models.Workspace) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO workspaces (`+wsCols+`)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
		w.ID, w.ProjectID, w.Name, w.Plan, w.Arch, w.Visibility, w.OwnerUserID, w.NodeID, w.AllocationID, w.Status, w.SSHPort, w.HostKeyFP, w.CreatedAt, w.UpdatedAt,
		w.CPUMilli, w.MemBytes, w.DiskBytes, w.PendingCPUMilli, w.PendingMemBytes, w.PendingDiskBytes, w.ResizeStatus, w.ResizeKind, nullTime(w.LastActivityAt), w.IdleSuspendHours)
	if err != nil {
		return store.ErrConflict
	}
	if w.AllocationID != uuid.Nil {
		_, _ = s.db.ExecContext(ctx, `UPDATE allocations SET workspace_id=$2 WHERE id=$1`, w.AllocationID, w.ID)
	}
	return nil
}

func scanWS(row interface{ Scan(dest ...any) error }) (*models.Workspace, error) {
	w := &models.Workspace{}
	var lastAct sql.NullTime
	err := row.Scan(&w.ID, &w.ProjectID, &w.Name, &w.Plan, &w.Arch, &w.Visibility, &w.OwnerUserID, &w.NodeID, &w.AllocationID, &w.Status, &w.SSHPort, &w.HostKeyFP, &w.CreatedAt, &w.UpdatedAt,
		&w.CPUMilli, &w.MemBytes, &w.DiskBytes, &w.PendingCPUMilli, &w.PendingMemBytes, &w.PendingDiskBytes, &w.ResizeStatus, &w.ResizeKind, &lastAct, &w.IdleSuspendHours)
	if err != nil {
		return nil, mapErr(err)
	}
	if lastAct.Valid {
		w.LastActivityAt = lastAct.Time
	}
	return w, nil
}

func (s *Store) GetWorkspace(ctx context.Context, id uuid.UUID) (*models.Workspace, error) {
	return scanWS(s.db.QueryRowContext(ctx, `SELECT `+wsCols+` FROM workspaces WHERE id=$1`, id))
}

func (s *Store) ListWorkspaces(ctx context.Context, projectID *uuid.UUID) ([]models.Workspace, error) {
	q := `SELECT ` + wsCols + ` FROM workspaces`
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

const wsUpdateSET = `name=$2,plan=$3,arch=$4,visibility=$5,status=$6,ssh_port=$7,host_key_fp=$8,updated_at=$9,node_id=$10,allocation_id=$11,
		cpu_milli=$12,mem_bytes=$13,disk_bytes=$14,pending_cpu_milli=$15,pending_mem_bytes=$16,pending_disk_bytes=$17,resize_status=$18,resize_kind=$19,last_activity_at=$20,idle_suspend_hours=$21`

func workspaceUpdateArgs(w *models.Workspace) []any {
	return []any{
		w.ID, w.Name, w.Plan, w.Arch, w.Visibility, w.Status, w.SSHPort, w.HostKeyFP, w.UpdatedAt, w.NodeID, w.AllocationID,
		w.CPUMilli, w.MemBytes, w.DiskBytes, w.PendingCPUMilli, w.PendingMemBytes, w.PendingDiskBytes, w.ResizeStatus, w.ResizeKind, nullTime(w.LastActivityAt), w.IdleSuspendHours,
	}
}

func (s *Store) UpdateWorkspace(ctx context.Context, w *models.Workspace) error {
	_, err := s.db.ExecContext(ctx, `UPDATE workspaces SET `+wsUpdateSET+` WHERE id=$1`, workspaceUpdateArgs(w)...)
	if err != nil {
		return err
	}
	if w.AllocationID != uuid.Nil {
		_, _ = s.db.ExecContext(ctx, `UPDATE allocations SET workspace_id=$2 WHERE id=$1`, w.AllocationID, w.ID)
	}
	return nil
}

func (s *Store) UpdateWorkspaceIfStatus(ctx context.Context, w *models.Workspace, fromStatus string) error {
	args := append(workspaceUpdateArgs(w), fromStatus)
	res, err := s.db.ExecContext(ctx, `UPDATE workspaces SET `+wsUpdateSET+` WHERE id=$1 AND status=$22`, args...)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrConflict
	}
	if w.AllocationID != uuid.Nil {
		_, _ = s.db.ExecContext(ctx, `UPDATE allocations SET workspace_id=$2 WHERE id=$1`, w.AllocationID, w.ID)
	}
	return nil
}

func (s *Store) AddAudit(ctx context.Context, l models.AuditLog) error {
	if l.IP == "" {
		l.IP = requestmeta.ClientIP(ctx)
	}
	meta, _ := json.Marshal(l.Meta)
	_, err := s.db.ExecContext(ctx, `INSERT INTO audit_logs (actor_user_id,action,resource_type,resource_id,ip,meta,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		l.ActorUserID, l.Action, l.ResourceType, l.ResourceID, l.IP, meta, time.Now())
	return err
}

func scanAuditRows(rows *sql.Rows) ([]models.AuditLog, error) {
	defer rows.Close()
	var out []models.AuditLog
	for rows.Next() {
		var l models.AuditLog
		var metaRaw []byte
		if err := rows.Scan(&l.ID, &l.ActorUserID, &l.Action, &l.ResourceType, &l.ResourceID, &l.IP, &l.CreatedAt, &l.ActorUsername, &metaRaw); err != nil {
			return nil, err
		}
		if len(metaRaw) > 0 && string(metaRaw) != "null" {
			_ = json.Unmarshal(metaRaw, &l.Meta)
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *Store) ListAudit(ctx context.Context, limit int) ([]models.AuditLog, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT a.id, a.actor_user_id, a.action, a.resource_type, a.resource_id, a.ip, a.created_at, COALESCE(u.username, ''), a.meta
FROM audit_logs a
LEFT JOIN users u ON u.id = a.actor_user_id
ORDER BY a.id DESC
LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	return scanAuditRows(rows)
}

func (s *Store) ListAuditByResource(ctx context.Context, resourceID string, limit int) ([]models.AuditLog, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT a.id, a.actor_user_id, a.action, a.resource_type, a.resource_id, a.ip, a.created_at, COALESCE(u.username, ''), a.meta
FROM audit_logs a
LEFT JOIN users u ON u.id = a.actor_user_id
WHERE a.resource_id = $1
   OR COALESCE(a.meta->>'workspace', '') = $1
ORDER BY a.id DESC
LIMIT $2`, resourceID, limit)
	if err != nil {
		return nil, err
	}
	return scanAuditRows(rows)
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
	_, err := s.db.ExecContext(ctx, `INSERT INTO refresh_sessions (id,user_id,hash,fingerprint,expires_at) VALUES ($1,$2,$3,$4,$5)`,
		sess.ID, sess.UserID, sess.Hash, sess.Fingerprint, sess.ExpiresAt)
	return err
}

func (s *Store) GetRefreshByHash(ctx context.Context, hash string) (*models.RefreshSession, error) {
	s1 := &models.RefreshSession{}
	err := s.db.QueryRowContext(ctx, `SELECT id,user_id,hash,fingerprint,expires_at FROM refresh_sessions WHERE hash=$1`, hash).
		Scan(&s1.ID, &s1.UserID, &s1.Hash, &s1.Fingerprint, &s1.ExpiresAt)
	if err != nil {
		return nil, mapErr(err)
	}
	return s1, nil
}

func (s *Store) DeleteRefresh(ctx context.Context, hash string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM refresh_sessions WHERE hash=$1`, hash)
	return err
}

const ingressCols = `id,workspace_id,project_id,domain,path,port,host_port,preset,extra_nginx,status,applicant_user_id,reviewed_by,reviewed_at,reject_reason,created_at`

func scanIngress(row interface{ Scan(dest ...any) error }) (*models.IngressRoute, error) {
	r := &models.IngressRoute{}
	var applicantID sql.NullString
	var reviewedBy sql.NullString
	var reviewedAt sql.NullTime
	err := row.Scan(&r.ID, &r.WorkspaceID, &r.ProjectID, &r.Domain, &r.Path, &r.Port, &r.HostPort, &r.Preset, &r.ExtraNginx, &r.Status, &applicantID, &reviewedBy, &reviewedAt, &r.RejectReason, &r.CreatedAt)
	if err != nil {
		return nil, mapErr(err)
	}
	if applicantID.Valid && applicantID.String != "" {
		r.ApplicantUserID, _ = uuid.Parse(applicantID.String)
	}
	if reviewedBy.Valid && reviewedBy.String != "" {
		id, err := uuid.Parse(reviewedBy.String)
		if err == nil {
			r.ReviewedBy = &id
		}
	}
	if reviewedAt.Valid {
		r.ReviewedAt = &reviewedAt.Time
	}
	return r, nil
}

func (s *Store) CreateIngress(ctx context.Context, r *models.IngressRoute) error {
	var appID *uuid.UUID
	if r.ApplicantUserID != uuid.Nil {
		appID = &r.ApplicantUserID
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO ingress_routes (`+ingressCols+`) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		r.ID, r.WorkspaceID, r.ProjectID, r.Domain, r.Path, r.Port, r.HostPort, r.Preset, r.ExtraNginx, r.Status, appID, r.ReviewedBy, r.ReviewedAt, r.RejectReason, r.CreatedAt)
	if err != nil {
		return store.ErrConflict
	}
	return nil
}

func (s *Store) GetIngress(ctx context.Context, id uuid.UUID) (*models.IngressRoute, error) {
	return scanIngress(s.db.QueryRowContext(ctx, `SELECT `+ingressCols+` FROM ingress_routes WHERE id=$1`, id))
}

func (s *Store) GetIngressByDomain(ctx context.Context, domain string) (*models.IngressRoute, error) {
	return scanIngress(s.db.QueryRowContext(ctx, `SELECT `+ingressCols+` FROM ingress_routes WHERE lower(domain)=lower($1)`, domain))
}

func (s *Store) ListIngress(ctx context.Context, workspaceID *uuid.UUID) ([]models.IngressRoute, error) {
	q := `SELECT ` + ingressCols + ` FROM ingress_routes`
	var rows *sql.Rows
	var err error
	if workspaceID != nil {
		rows, err = s.db.QueryContext(ctx, q+` WHERE workspace_id=$1 ORDER BY created_at`, *workspaceID)
	} else {
		rows, err = s.db.QueryContext(ctx, q+` ORDER BY created_at`)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.IngressRoute
	for rows.Next() {
		r, err := scanIngress(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

func (s *Store) UpdateIngress(ctx context.Context, r *models.IngressRoute) error {
	var appID *uuid.UUID
	if r.ApplicantUserID != uuid.Nil {
		appID = &r.ApplicantUserID
	}
	_, err := s.db.ExecContext(ctx, `UPDATE ingress_routes SET domain=$2,path=$3,port=$4,preset=$5,extra_nginx=$6,status=$7,applicant_user_id=$8,reviewed_by=$9,reviewed_at=$10,reject_reason=$11,host_port=$12 WHERE id=$1`,
		r.ID, r.Domain, r.Path, r.Port, r.Preset, r.ExtraNginx, r.Status, appID, r.ReviewedBy, r.ReviewedAt, r.RejectReason, r.HostPort)
	return err
}

func (s *Store) DeleteIngress(ctx context.Context, id uuid.UUID) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM ingress_routes WHERE id=$1`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
}
