package models

import (
	"time"

	"github.com/google/uuid"
)

const (
	RolePlatformAdmin = "platform_admin"
	RolePlatformOps   = "platform_ops"
	RolePlatformUser  = "platform_user"

	RoleOwner     = "owner"
	RoleAdmin     = "admin"
	RoleDeveloper = "developer"
	RoleViewer    = "viewer"

	UserActive     = "active"
	UserSuspended  = "suspended"
	UserDeleted    = "deleted"

	AllocReserved = "reserved"
	AllocActive   = "active"
	AllocReleased = "released"

	WSRequested     = "requested"
	WSProvisioning  = "provisioning"
	WSRunning       = "running"
	WSStopped       = "stopped"
	WSFailed        = "failed"
	WSDestroying    = "destroying"
	WSDestroyed     = "destroyed"
	WSNodeLost      = "node_lost"
	WSDegraded      = "fabric_degraded"

	VisShared  = "shared"
	VisPrivate = "private"

	ArchAMD64 = "amd64"
	ArchARM64 = "arm64"
	ArchAny   = "any"
)

type User struct {
	ID            uuid.UUID `json:"id"`
	Username      string    `json:"username"`
	Email         string    `json:"email"`
	PasswordHash  string    `json:"-"`
	PlatformRole  string    `json:"platform_role"`
	Status        string    `json:"status"`
	TokenVersion  int       `json:"-"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type SSHKey struct {
	ID          uuid.UUID `json:"id"`
	UserID      uuid.UUID `json:"user_id"`
	Name        string    `json:"name"`
	PublicKey   string    `json:"public_key"`
	Fingerprint string    `json:"fingerprint"`
	CreatedAt   time.Time `json:"created_at"`
}

type Project struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	OwnerID   uuid.UUID `json:"owner_id"`
	Status    string    `json:"status"`
	BudgetCPUMilli  int64 `json:"budget_cpu_milli,omitempty"`
	BudgetMemBytes  int64 `json:"budget_mem_bytes,omitempty"`
	BudgetDiskBytes int64 `json:"budget_disk_bytes,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type Membership struct {
	ProjectID uuid.UUID `json:"project_id"`
	UserID    uuid.UUID `json:"user_id"`
	Role      string    `json:"role"`
}

type Node struct {
	ID              uuid.UUID `json:"id"`
	Name            string    `json:"name"`
	Arch            string    `json:"arch"`
	Class           string    `json:"class"`
	Power           string    `json:"power"`
	Role            string    `json:"role"`
	FabricIP        string    `json:"fabric_ip"`
	LanIP           string    `json:"lan_ip,omitempty"`
	BreakglassSSH   string    `json:"breakglass_ssh,omitempty"`
	AllocatableCPU  int64     `json:"allocatable_cpu_milli"`
	AllocatableMem  int64     `json:"allocatable_mem_bytes"`
	AllocatableDisk int64     `json:"allocatable_disk_bytes"`
	UsedCPU         int64     `json:"used_cpu_milli"`
	UsedMem         int64     `json:"used_mem_bytes"`
	UsedDisk        int64     `json:"used_disk_bytes"`
	FabricPath      string    `json:"fabric_path,omitempty"`
	FabricRTTMS     int64     `json:"fabric_rtt_ms,omitempty"`
	Ready           bool      `json:"ready"`
	LastHeartbeat   time.Time `json:"last_heartbeat"`
}

type Allocation struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspace_id"`
	ProjectID   uuid.UUID `json:"project_id"`
	NodeID      uuid.UUID `json:"node_id"`
	CPUMilli    int64     `json:"cpu_milli"`
	MemBytes    int64     `json:"mem_bytes"`
	DiskBytes   int64     `json:"disk_bytes"`
	Arch        string    `json:"arch"`
	State       string    `json:"state"`
	CreatedAt   time.Time `json:"created_at"`
	ReleasedAt  *time.Time `json:"released_at,omitempty"`
}

type Workspace struct {
	ID           uuid.UUID `json:"id"`
	ProjectID    uuid.UUID `json:"project_id"`
	Name         string    `json:"name"`
	Plan         string    `json:"plan"`
	Arch         string    `json:"arch"`
	Visibility   string    `json:"visibility"`
	OwnerUserID  uuid.UUID `json:"owner_user_id"`
	NodeID       uuid.UUID `json:"node_id"`
	AllocationID uuid.UUID `json:"allocation_id"`
	Status       string    `json:"status"`
	SSHPort      int       `json:"ssh_port"`
	HostKeyFP    string    `json:"host_key_fp,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type AuditLog struct {
	ID           int64          `json:"id"`
	ActorUserID  uuid.UUID      `json:"actor_user_id"`
	Action       string         `json:"action"`
	ResourceType string         `json:"resource_type"`
	ResourceID   string         `json:"resource_id"`
	IP           string         `json:"ip,omitempty"`
	Meta         map[string]any `json:"meta,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
}

type Plan struct {
	Name      string `json:"name"`
	CPUMilli  int64  `json:"cpu_milli"`
	MemBytes  int64  `json:"mem_bytes"`
	DiskBytes int64  `json:"disk_bytes"`
}

func Plans() map[string]Plan {
	const Mi = int64(1024 * 1024)
	const Gi = 1024 * Mi
	return map[string]Plan{
		"nano":   {Name: "nano", CPUMilli: 500, MemBytes: 256 * Mi, DiskBytes: 5 * Gi},
		"small":  {Name: "small", CPUMilli: 1000, MemBytes: 512 * Mi, DiskBytes: 10 * Gi},
		"medium": {Name: "medium", CPUMilli: 2000, MemBytes: 1 * Gi, DiskBytes: 15 * Gi},
		"large":  {Name: "large", CPUMilli: 4000, MemBytes: 2 * Gi, DiskBytes: 20 * Gi},
		"xlarge": {Name: "xlarge", CPUMilli: 6000, MemBytes: 3 * Gi, DiskBytes: 30 * Gi},
	}
}

func RoleRank(role string) int {
	switch role {
	case RoleOwner:
		return 40
	case RoleAdmin:
		return 30
	case RoleDeveloper:
		return 20
	case RoleViewer:
		return 10
	default:
		return 0
	}
}

func CanSSH(role string) bool {
	return RoleRank(role) >= RoleRank(RoleDeveloper)
}

func CanMutateWorkspace(role string) bool {
	return RoleRank(role) >= RoleRank(RoleDeveloper)
}

func CanManageMembers(role string) bool {
	return RoleRank(role) >= RoleRank(RoleAdmin)
}

type Invitation struct {
	ID         uuid.UUID  `json:"id"`
	ProjectID  uuid.UUID  `json:"project_id"`
	Email      string     `json:"email"`
	Role       string     `json:"role"`
	Token      string     `json:"token"`
	ExpiresAt  time.Time  `json:"expires_at"`
	AcceptedAt *time.Time `json:"accepted_at,omitempty"`
}

type RefreshSession struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	Hash      string
	ExpiresAt time.Time
}

