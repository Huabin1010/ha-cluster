package memory

import (
	"context"
	"sort"
	"strings"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func (s *Store) CreateIngressDomainZone(_ context.Context, z *models.IngressDomainZone) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ingressZones == nil {
		s.ingressZones = map[uuid.UUID]*models.IngressDomainZone{}
	}
	suf := strings.ToLower(strings.TrimSpace(z.Suffix))
	for _, e := range s.ingressZones {
		if strings.ToLower(e.Suffix) == suf {
			return store.ErrConflict
		}
	}
	cp := *z
	s.ingressZones[z.ID] = &cp
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) GetIngressDomainZone(_ context.Context, id uuid.UUID) (*models.IngressDomainZone, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	z, ok := s.ingressZones[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := *z
	return &cp, nil
}

func (s *Store) GetIngressDomainZoneBySuffix(_ context.Context, suffix string) (*models.IngressDomainZone, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	suf := strings.ToLower(strings.TrimSpace(suffix))
	for _, z := range s.ingressZones {
		if strings.ToLower(z.Suffix) == suf {
			cp := *z
			return &cp, nil
		}
	}
	return nil, store.ErrNotFound
}

func (s *Store) ListIngressDomainZones(_ context.Context) ([]models.IngressDomainZone, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]models.IngressDomainZone, 0, len(s.ingressZones))
	for _, z := range s.ingressZones {
		out = append(out, *z)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].SortOrder != out[j].SortOrder {
			return out[i].SortOrder < out[j].SortOrder
		}
		return out[i].Suffix < out[j].Suffix
	})
	return out, nil
}

func (s *Store) UpdateIngressDomainZone(_ context.Context, z *models.IngressDomainZone) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.ingressZones[z.ID]; !ok {
		return store.ErrNotFound
	}
	suf := strings.ToLower(strings.TrimSpace(z.Suffix))
	for id, e := range s.ingressZones {
		if id != z.ID && strings.ToLower(e.Suffix) == suf {
			return store.ErrConflict
		}
	}
	cp := *z
	s.ingressZones[z.ID] = &cp
	s.saveSnapshotLocked()
	return nil
}

func (s *Store) DeleteIngressDomainZone(_ context.Context, id uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.ingressZones[id]; !ok {
		return store.ErrNotFound
	}
	delete(s.ingressZones, id)
	s.saveSnapshotLocked()
	return nil
}
