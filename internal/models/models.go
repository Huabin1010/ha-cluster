package models

import (
	"fmt"
	"sort"
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

	UserActive    = "active"
	UserSuspended = "suspended"
	UserDeleted   = "deleted"

	AllocReserved = "reserved"
	AllocActive   = "active"
	AllocReleased = "released"

	WSRequested    = "requested"
	WSProvisioning = "provisioning"
	WSRunning      = "running"
	WSStopped      = "stopped"
	WSFailed       = "failed"
	WSRejected     = "rejected"
	WSDestroying   = "destroying"
	WSDestroyed    = "destroyed"
	WSNodeLost     = "node_lost"
	WSDegraded     = "fabric_degraded"

	ResizePending = "pending"

	VisShared  = "shared"
	VisPrivate = "private"

	ArchAMD64 = "amd64"
	ArchARM64 = "arm64"
	ArchAny   = "any"
)

type User struct {
	ID           uuid.UUID `json:"id"`
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	PlatformRole string    `json:"platform_role"`
	Status       string    `json:"status"`
	TokenVersion int       `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
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
	ID              uuid.UUID `json:"id"`
	Name            string    `json:"name"`
	Slug            string    `json:"slug"`
	OwnerID         uuid.UUID `json:"owner_id"`
	Status          string    `json:"status"`
	BudgetCPUMilli  int64     `json:"budget_cpu_milli,omitempty"`
	BudgetMemBytes  int64     `json:"budget_mem_bytes,omitempty"`
	BudgetDiskBytes int64     `json:"budget_disk_bytes,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	MyRole          string    `json:"my_role,omitempty"`
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
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspace_id"`
	ProjectID   uuid.UUID  `json:"project_id"`
	NodeID      uuid.UUID  `json:"node_id"`
	CPUMilli    int64      `json:"cpu_milli"`
	MemBytes    int64      `json:"mem_bytes"`
	DiskBytes   int64      `json:"disk_bytes"`
	Arch        string     `json:"arch"`
	State       string     `json:"state"`
	CreatedAt   time.Time  `json:"created_at"`
	ReleasedAt  *time.Time `json:"released_at,omitempty"`
}

type Workspace struct {
	ID               uuid.UUID `json:"id"`
	ProjectID        uuid.UUID `json:"project_id"`
	Name             string    `json:"name"`
	Plan             string    `json:"plan"`
	Arch             string    `json:"arch"`
	Visibility       string    `json:"visibility"`
	OwnerUserID      uuid.UUID `json:"owner_user_id"`
	NodeID           uuid.UUID `json:"node_id"`
	AllocationID     uuid.UUID `json:"allocation_id"`
	Status           string    `json:"status"`
	SSHPort          int       `json:"ssh_port"`
	HostKeyFP        string    `json:"host_key_fp,omitempty"`
	CPUMilli         int64     `json:"cpu_milli,omitempty"`
	MemBytes         int64     `json:"mem_bytes,omitempty"`
	DiskBytes        int64     `json:"disk_bytes,omitempty"`
	PendingCPUMilli  int64     `json:"pending_cpu_milli,omitempty"`
	PendingMemBytes  int64     `json:"pending_mem_bytes,omitempty"`
	PendingDiskBytes int64     `json:"pending_disk_bytes,omitempty"`
	ResizeStatus     string    `json:"resize_status,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
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
		"2c2g":   {Name: "2c2g", CPUMilli: 2000, MemBytes: 2 * Gi, DiskBytes: 5 * Gi},
		"medium": {Name: "medium", CPUMilli: 2000, MemBytes: 1 * Gi, DiskBytes: 15 * Gi},
		"large":  {Name: "large", CPUMilli: 4000, MemBytes: 2 * Gi, DiskBytes: 20 * Gi},
		"xlarge": {Name: "xlarge", CPUMilli: 6000, MemBytes: 3 * Gi, DiskBytes: 30 * Gi},
	}
}

func PlanList() []Plan {
	m := Plans()
	out := make([]Plan, 0, len(m))
	for _, p := range m {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CPUMilli != out[j].CPUMilli {
			return out[i].CPUMilli < out[j].CPUMilli
		}
		if out[i].MemBytes != out[j].MemBytes {
			return out[i].MemBytes < out[j].MemBytes
		}
		return out[i].Name < out[j].Name
	})
	return out
}

const (
	MinCPUMilli  int64 = 100
	MinMemBytes  int64 = 64 * 1024 * 1024
	MinDiskBytes int64 = 1024 * 1024 * 1024
	MaxCPUMilli  int64 = 32_000
	MaxMemBytes  int64 = 64 * 1024 * 1024 * 1024
	MaxDiskBytes int64 = 500 * 1024 * 1024 * 1024
)

func ValidSpec(cpu, mem, disk int64) bool {
	return cpu >= MinCPUMilli && cpu <= MaxCPUMilli &&
		mem >= MinMemBytes && mem <= MaxMemBytes &&
		disk >= MinDiskBytes && disk <= MaxDiskBytes
}

func ResolveSpec(planName string, cpu, mem, disk int64) (Plan, error) {
	if cpu > 0 || mem > 0 || disk > 0 {
		if !ValidSpec(cpu, mem, disk) {
			return Plan{}, fmt.Errorf("invalid spec")
		}
		if p, ok := Plans()[planName]; ok && p.CPUMilli == cpu && p.MemBytes == mem && p.DiskBytes == disk {
			return p, nil
		}
		return Plan{Name: "custom", CPUMilli: cpu, MemBytes: mem, DiskBytes: disk}, nil
	}
	p, ok := Plans()[planName]
	if !ok {
		return Plan{}, fmt.Errorf("unknown plan")
	}
	return p, nil
}

func (w Workspace) Spec() Plan {
	if w.CPUMilli > 0 && w.MemBytes > 0 && w.DiskBytes > 0 {
		name := w.Plan
		if name == "" {
			name = "custom"
		}
		return Plan{Name: name, CPUMilli: w.CPUMilli, MemBytes: w.MemBytes, DiskBytes: w.DiskBytes}
	}
	if p, ok := Plans()[w.Plan]; ok {
		return p
	}
	return Plan{Name: w.Plan}
}

func (w Workspace) HasPendingResize() bool {
	return w.ResizeStatus == ResizePending
}

func (w Workspace) ApplySpec(p Plan) Workspace {
	w.Plan = p.Name
	w.CPUMilli = p.CPUMilli
	w.MemBytes = p.MemBytes
	w.DiskBytes = p.DiskBytes
	return w
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

func CanApproveWorkspace(role string) bool {
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

const (
	IngressNocache     = "nocache"
	IngressTransparent = "transparent"
	IngressCache       = "cache"
	IngressActive      = "active"
	IngressPendingDNS  = "pending_dns"
)

type IngressRoute struct {
	ID           uuid.UUID `json:"id"`
	WorkspaceID  uuid.UUID `json:"workspace_id"`
	ProjectID    uuid.UUID `json:"project_id"`
	Domain       string    `json:"domain"`
	Path         string    `json:"path"`
	Port         int       `json:"port"`
	Preset       string    `json:"preset"`
	ExtraNginx   string    `json:"extra_nginx,omitempty"`
	Status       string    `json:"status"`
	NginxPreview string    `json:"nginx_preview,omitempty"`
	DNSHint      string    `json:"dns_hint,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}
