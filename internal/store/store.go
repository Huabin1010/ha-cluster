package store

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

var (
	ErrNotFound        = errors.New("not found")
	ErrConflict        = errors.New("conflict")
	ErrNoCapacity      = errors.New("insufficient capacity")
	ErrUnauthorized    = errors.New("unauthorized")
	ErrForbidden       = errors.New("forbidden")
	ErrInvalidInput    = errors.New("invalid input")
	ErrAlreadyReleased = errors.New("already released")
	ErrDiskShrink      = errors.New("DISK_SHRINK_NOT_SUPPORTED")
	ErrNotExpansion    = errors.New("ONLY_EXPANSION")
	ErrSecondPort      = errors.New("SECOND_PORT_CONFIRM_REQUIRED")
)

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
	RemoveMembership(ctx context.Context, projectID, userID uuid.UUID) error
	GetMembership(ctx context.Context, projectID, userID uuid.UUID) (*models.Membership, error)
	ListMemberships(ctx context.Context, projectID uuid.UUID) ([]models.Membership, error)

	UpsertNode(ctx context.Context, n *models.Node) error
	GetNode(ctx context.Context, id uuid.UUID) (*models.Node, error)
	GetNodeByName(ctx context.Context, name string) (*models.Node, error)
	ListNodes(ctx context.Context) ([]models.Node, error)

	// ReserveOnNode is atomic: lock node capacity, insert allocation reserved, bump used.
	ReserveOnNode(ctx context.Context, nodeID uuid.UUID, a *models.Allocation) error
	ActivateAllocation(ctx context.Context, id uuid.UUID) error
	ReleaseAllocation(ctx context.Context, id uuid.UUID) error
	GetAllocation(ctx context.Context, id uuid.UUID) (*models.Allocation, error)
	ExpandAllocation(ctx context.Context, id uuid.UUID, dCPU, dMem, dDisk int64) error

	CreateWorkspace(ctx context.Context, w *models.Workspace) error
	GetWorkspace(ctx context.Context, id uuid.UUID) (*models.Workspace, error)
	ListWorkspaces(ctx context.Context, projectID *uuid.UUID) ([]models.Workspace, error)
	UpdateWorkspace(ctx context.Context, w *models.Workspace) error

	AddAudit(ctx context.Context, l models.AuditLog) error
	ListAudit(ctx context.Context, limit int) ([]models.AuditLog, error)

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
}
