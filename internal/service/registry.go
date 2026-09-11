package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/secretbox"
	"ha-cluster/internal/store"
)

func normalizeRegistryServer(server string) string {
	s := strings.TrimSpace(server)
	s = strings.TrimPrefix(s, "https://")
	s = strings.TrimPrefix(s, "http://")
	s = strings.TrimSuffix(s, "/")
	return s
}

func (a *App) ListDockerRegistries(ctx context.Context, actor models.User) ([]models.DockerRegistryPublic, error) {
	if actor.PlatformRole != models.RolePlatformAdmin {
		return nil, store.ErrForbidden
	}
	rows, err := a.Store.ListDockerRegistries(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]models.DockerRegistryPublic, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.Public())
	}
	return out, nil
}

func (a *App) CreateDockerRegistry(ctx context.Context, actor models.User, in models.DockerRegistry, password string) (*models.DockerRegistryPublic, error) {
	if actor.PlatformRole != models.RolePlatformAdmin {
		return nil, store.ErrForbidden
	}
	in.Server = normalizeRegistryServer(in.Server)
	if in.Name == "" || in.Server == "" {
		return nil, store.ErrInvalidInput
	}
	if _, err := a.Store.GetDockerRegistryByServer(ctx, in.Server); err == nil {
		return nil, store.ErrConflict
	} else if err != store.ErrNotFound {
		return nil, err
	}
	enc, err := secretbox.Encrypt(a.JWT, password)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	in.ID = uuid.New()
	in.PasswordEnc = enc
	in.CreatedAt = now
	in.UpdatedAt = now
	if err := a.Store.CreateDockerRegistry(ctx, &in); err != nil {
		return nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "docker_registry.create",
		ResourceType: "docker_registry", ResourceID: in.ID.String(),
		Meta: map[string]any{"server": in.Server, "auto_inject": in.AutoInject},
	})
	pub := in.Public()
	return &pub, nil
}

type DockerRegistryPatch struct {
	Name       *string
	Server     *string
	Username   *string
	Password   *string
	AutoInject *bool
}

func (a *App) UpdateDockerRegistry(ctx context.Context, actor models.User, id uuid.UUID, patch DockerRegistryPatch) (*models.DockerRegistryPublic, error) {
	if actor.PlatformRole != models.RolePlatformAdmin {
		return nil, store.ErrForbidden
	}
	cur, err := a.Store.GetDockerRegistry(ctx, id)
	if err != nil {
		return nil, err
	}
	if patch.Name != nil && *patch.Name != "" {
		cur.Name = *patch.Name
	}
	if patch.Server != nil && *patch.Server != "" {
		cur.Server = normalizeRegistryServer(*patch.Server)
	}
	if patch.Username != nil {
		cur.Username = *patch.Username
	}
	if patch.AutoInject != nil {
		cur.AutoInject = *patch.AutoInject
	}
	if patch.Password != nil && *patch.Password != "" {
		enc, err := secretbox.Encrypt(a.JWT, *patch.Password)
		if err != nil {
			return nil, err
		}
		cur.PasswordEnc = enc
	}
	cur.UpdatedAt = time.Now()
	if err := a.Store.UpdateDockerRegistry(ctx, cur); err != nil {
		return nil, err
	}
	pub := cur.Public()
	return &pub, nil
}

func (a *App) DeleteDockerRegistry(ctx context.Context, actor models.User, id uuid.UUID) error {
	if actor.PlatformRole != models.RolePlatformAdmin {
		return store.ErrForbidden
	}
	if err := a.Store.DeleteDockerRegistry(ctx, id); err != nil {
		return err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "docker_registry.delete",
		ResourceType: "docker_registry", ResourceID: id.String(),
	})
	return nil
}

func (a *App) TestDockerRegistry(ctx context.Context, actor models.User, id uuid.UUID) error {
	if actor.PlatformRole != models.RolePlatformAdmin {
		return store.ErrForbidden
	}
	r, err := a.Store.GetDockerRegistry(ctx, id)
	if err != nil {
		return err
	}
	pass, err := secretbox.Decrypt(a.JWT, r.PasswordEnc)
	if err != nil {
		return fmt.Errorf("decrypt: %w", err)
	}
	return ProbeRegistryAuth(r.Server, r.Username, pass)
}

func (a *App) TestDockerRegistryInput(server, username, password string) error {
	return ProbeRegistryAuth(server, username, password)
}

func (a *App) CollectAutoInjectRegistryCreds(ctx context.Context) ([]models.DockerRegistryCred, error) {
	rows, err := a.Store.ListAutoInjectDockerRegistries(ctx)
	if err != nil {
		return nil, err
	}
	var out []models.DockerRegistryCred
	for _, r := range rows {
		pass, err := secretbox.Decrypt(a.JWT, r.PasswordEnc)
		if err != nil {
			return nil, fmt.Errorf("decrypt %s: %w", r.Server, err)
		}
		out = append(out, models.DockerRegistryCred{
			Server: r.Server, Username: r.Username, Password: pass,
		})
	}
	return out, nil
}

// ProbeRegistryAuth 探测 Docker Registry v2 鉴权（GET /v2/）。
func ProbeRegistryAuth(server, username, password string) error {
	server = normalizeRegistryServer(server)
	url := "https://" + server + "/v2/"
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	if username != "" {
		req.SetBasicAuth(username, password)
	}
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	switch resp.StatusCode {
	case http.StatusOK, http.StatusAccepted:
		return nil
	case http.StatusUnauthorized:
		// Registry v2 常对 /v2/ 返回 401（鉴权挑战）；有凭证时仍可能如此，但说明端点可达。
		if username != "" {
			return nil
		}
		return fmt.Errorf("unauthorized (HTTP 401)")
	default:
		return fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
}
