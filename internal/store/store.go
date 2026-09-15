package store

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

var (
	ErrNotFound        = errors.New("not found")
	ErrConflict        = errors.New("conflict")
	ErrNoCapacity      = errors.New("insufficient capacity")
	ErrUnauthorized    = errors.New("unauthorized")
	ErrAccountDisabled = errors.New("ACCOUNT_DISABLED")
	ErrForbidden       = errors.New("forbidden")
	ErrInvalidInput    = errors.New("invalid input")
	ErrAlreadyReleased = errors.New("already released")
	ErrDiskShrink      = errors.New("DISK_SHRINK_NOT_SUPPORTED")
	ErrNotExpansion    = errors.New("ONLY_EXPANSION")
	ErrSecondPort      = errors.New("SECOND_PORT_CONFIRM_REQUIRED")
	ErrPurposeRequired = errors.New("PURPOSE_REQUIRED")
)

// Wrap attaches a human/agent-readable reason to a sentinel so HTTP error
// bodies are not a bare "conflict" / "insufficient capacity".
func Wrap(sentinel error, reason string) error {
	reason = strings.TrimSpace(reason)
	if sentinel == nil {
		if reason == "" {
			return errors.New("error")
		}
		return errors.New(reason)
	}
	if reason == "" {
		return sentinel
	}
	return fmt.Errorf("%w: %s", sentinel, reason)
}

// Reason returns the human-readable suffix attached by Wrap, or empty if the
// error is a bare sentinel.
func Reason(err, sentinel error) string {
	if err == nil {
		return ""
	}
	full := strings.TrimSpace(err.Error())
	if sentinel == nil {
		return full
	}
	base := sentinel.Error()
	if full == "" || full == base {
		return ""
	}
	full = strings.TrimPrefix(full, base+": ")
	full = strings.TrimPrefix(full, base+":")
	return strings.TrimSpace(full)
}

type Store interface {
	CreateUser(ctx context.Context, u *models.User) error
	GetUserByID(ctx context.Context, id uuid.UUID) (*models.User, error)
	GetUserByUsername(ctx context.Context, username string) (*models.User, error)
	GetUserByEmail(ctx context.Context, email string) (*models.User, error)
	ListUsers(ctx context.Context) ([]models.User, error)
	UpdateUser(ctx context.Context, u *models.User) error

	AddSSHKey(ctx context.Context, k *models.SSHKey) error
	ListSSHKeys(ctx context.Context, userID uuid.UUID) ([]models.SSHKey, error)
	DeleteSSHKey(ctx context.Context, userID, keyID uuid.UUID) error
	GetSSHKeysByUsername(ctx context.Context, username string) ([]models.SSHKey, error)

	CreateProject(ctx context.Context, p *models.Project, ownerRole string) error
	GetProject(ctx context.Context, id uuid.UUID) (*models.Project, error)
	UpdateProject(ctx context.Context, p *models.Project) error
	DeleteProject(ctx context.Context, id uuid.UUID) error
	ListProjectsForUser(ctx context.Context, userID uuid.UUID) ([]models.Project, error)
	AddMembership(ctx context.Context, m models.Membership) error
	UpdateMembership(ctx context.Context, m models.Membership) error
	RemoveMembership(ctx context.Context, projectID, userID uuid.UUID) error
	GetMembership(ctx context.Context, projectID, userID uuid.UUID) (*models.Membership, error)
	ListMemberships(ctx context.Context, projectID uuid.UUID) ([]models.Membership, error)

	UpsertNode(ctx context.Context, n *models.Node) error
	UpdateNodeMeta(ctx context.Context, id uuid.UUID, machineType, remark string, tags []string) error
	GetNode(ctx context.Context, id uuid.UUID) (*models.Node, error)
	GetNodeByName(ctx context.Context, name string) (*models.Node, error)
	ListNodes(ctx context.Context) ([]models.Node, error)
	DeleteNode(ctx context.Context, id uuid.UUID) error

	// ReserveOnNode is atomic: lock node capacity, insert allocation reserved, bump used.
	ReserveOnNode(ctx context.Context, nodeID uuid.UUID, a *models.Allocation) error
	// ReserveBestNode atomically picks the best ready node and reserves capacity (postgres: SKIP LOCKED).
	ReserveBestNode(ctx context.Context, arch string, cpu, mem, disk int64, a *models.Allocation) error
	ActivateAllocation(ctx context.Context, id uuid.UUID) error
	ReleaseAllocation(ctx context.Context, id uuid.UUID) error
	GetAllocation(ctx context.Context, id uuid.UUID) (*models.Allocation, error)
	ExpandAllocation(ctx context.Context, id uuid.UUID, dCPU, dMem, dDisk int64) error

	CreateWorkspace(ctx context.Context, w *models.Workspace) error
	GetWorkspace(ctx context.Context, id uuid.UUID) (*models.Workspace, error)
	ListWorkspaces(ctx context.Context, projectID *uuid.UUID) ([]models.Workspace, error)
	UpdateWorkspace(ctx context.Context, w *models.Workspace) error
	// UpdateWorkspaceIfStatus writes w only when the current row status matches
	// fromStatus. Returns ErrConflict if the row is missing or the status changed
	// (e.g. force-destroy during provision).
	UpdateWorkspaceIfStatus(ctx context.Context, w *models.Workspace, fromStatus string) error
	// SetWorkspaceExec records the last SSH probe / exec handshake. Does not bump updated_at.
	SetWorkspaceExec(ctx context.Context, id uuid.UUID, ready bool, errMsg string) error

	AddAudit(ctx context.Context, l models.AuditLog) error
	ListAudit(ctx context.Context, limit int) ([]models.AuditLog, error)
	ListAuditByResource(ctx context.Context, resourceID string, limit int) ([]models.AuditLog, error)

	ListAllocations(ctx context.Context) ([]models.Allocation, error)
	CreateInvitation(ctx context.Context, inv *models.Invitation) error
	GetInvitationByToken(ctx context.Context, token string) (*models.Invitation, error)
	AcceptInvitation(ctx context.Context, token string) error
	PutRefresh(ctx context.Context, s models.RefreshSession) error
	GetRefreshByHash(ctx context.Context, hash string) (*models.RefreshSession, error)
	DeleteRefresh(ctx context.Context, hash string) error

	CreateIngress(ctx context.Context, r *models.IngressRoute) error
	GetIngress(ctx context.Context, id uuid.UUID) (*models.IngressRoute, error)
	GetIngressByDomain(ctx context.Context, domain string) (*models.IngressRoute, error)
	ListIngress(ctx context.Context, workspaceID *uuid.UUID) ([]models.IngressRoute, error)
	UpdateIngress(ctx context.Context, r *models.IngressRoute) error
	DeleteIngress(ctx context.Context, id uuid.UUID) error

	CreateIngressDomainZone(ctx context.Context, z *models.IngressDomainZone) error
	GetIngressDomainZone(ctx context.Context, id uuid.UUID) (*models.IngressDomainZone, error)
	GetIngressDomainZoneBySuffix(ctx context.Context, suffix string) (*models.IngressDomainZone, error)
	ListIngressDomainZones(ctx context.Context) ([]models.IngressDomainZone, error)
	UpdateIngressDomainZone(ctx context.Context, z *models.IngressDomainZone) error
	DeleteIngressDomainZone(ctx context.Context, id uuid.UUID) error

	CreateDockerRegistry(ctx context.Context, r *models.DockerRegistry) error
	GetDockerRegistry(ctx context.Context, id uuid.UUID) (*models.DockerRegistry, error)
	GetDockerRegistryByServer(ctx context.Context, server string) (*models.DockerRegistry, error)
	ListDockerRegistries(ctx context.Context) ([]models.DockerRegistry, error)
	UpdateDockerRegistry(ctx context.Context, r *models.DockerRegistry) error
	DeleteDockerRegistry(ctx context.Context, id uuid.UUID) error
	ListAutoInjectDockerRegistries(ctx context.Context) ([]models.DockerRegistry, error)

	UpsertAgentToken(ctx context.Context, t *models.AgentToken) error
	GetAgentTokenByToken(ctx context.Context, token string) (*models.AgentToken, error)
	GetAgentTokenByUser(ctx context.Context, userID uuid.UUID) (*models.AgentToken, error)
	TouchAgentToken(ctx context.Context, id uuid.UUID) error
	DeleteAgentTokenByUser(ctx context.Context, userID uuid.UUID) error

	CreateTLSCert(ctx context.Context, c *models.TLSCert) error
	GetTLSCert(ctx context.Context, id uuid.UUID) (*models.TLSCert, error)
	GetTLSCertByZone(ctx context.Context, zoneID uuid.UUID) (*models.TLSCert, error)
	ListTLSCerts(ctx context.Context) ([]models.TLSCert, error)
	UpdateTLSCert(ctx context.Context, c *models.TLSCert) error
	DeleteTLSCert(ctx context.Context, id uuid.UUID) error
	GetACMEAccount(ctx context.Context) (*models.ACMEAccount, error)
	SaveACMEAccount(ctx context.Context, acc *models.ACMEAccount) error
}
