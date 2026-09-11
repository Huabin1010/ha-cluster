package memory

import (
	"context"
	"strings"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func normServer(server string) string {
	s := strings.TrimSpace(server)
	s = strings.TrimPrefix(s, "https://")
	s = strings.TrimPrefix(s, "http://")
	return strings.TrimSuffix(s, "/")
}

func (s *Store) CreateDockerRegistry(_ context.Context, r *models.DockerRegistry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.dockerRegistries == nil {
		s.dockerRegistries = map[uuid.UUID]*models.DockerRegistry{}
	}
	r.Server = normServer(r.Server)
	for _, existing := range s.dockerRegistries {
		if existing.Server == r.Server {
			return store.ErrConflict
		}
	}
	s.dockerRegistries[r.ID] = r
	return nil
}

func (s *Store) GetDockerRegistry(_ context.Context, id uuid.UUID) (*models.DockerRegistry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.dockerRegistries[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := *r
	return &cp, nil
}

func (s *Store) GetDockerRegistryByServer(_ context.Context, server string) (*models.DockerRegistry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	server = normServer(server)
	for _, r := range s.dockerRegistries {
		if r.Server == server {
			cp := *r
			return &cp, nil
		}
	}
	return nil, store.ErrNotFound
}

func (s *Store) ListDockerRegistries(_ context.Context) ([]models.DockerRegistry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []models.DockerRegistry
	for _, r := range s.dockerRegistries {
		out = append(out, *r)
	}
	return out, nil
}

func (s *Store) ListAutoInjectDockerRegistries(_ context.Context) ([]models.DockerRegistry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []models.DockerRegistry
	for _, r := range s.dockerRegistries {
		if r.AutoInject {
			out = append(out, *r)
		}
	}
	return out, nil
}

func (s *Store) UpdateDockerRegistry(_ context.Context, r *models.DockerRegistry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.dockerRegistries[r.ID]; !ok {
		return store.ErrNotFound
	}
	cp := *r
	cp.Server = normServer(cp.Server)
	s.dockerRegistries[r.ID] = &cp
	return nil
}

func (s *Store) DeleteDockerRegistry(_ context.Context, id uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.dockerRegistries[id]; !ok {
		return store.ErrNotFound
	}
	delete(s.dockerRegistries, id)
	return nil
}
