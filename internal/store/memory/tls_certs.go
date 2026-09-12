package memory

import (
	"context"
	"sort"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func (s *Store) CreateTLSCert(_ context.Context, c *models.TLSCert) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.tlsCerts == nil {
		s.tlsCerts = map[uuid.UUID]*models.TLSCert{}
	}
	if c.ZoneID != nil {
		for _, e := range s.tlsCerts {
			if e.ZoneID != nil && *e.ZoneID == *c.ZoneID {
				return store.ErrConflict
			}
		}
	}
	cp := *c
	cp.Names = append([]string{}, c.Names...)
	s.tlsCerts[c.ID] = &cp
	return nil
}

func (s *Store) GetTLSCert(_ context.Context, id uuid.UUID) (*models.TLSCert, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.tlsCerts[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := *c
	cp.Names = append([]string{}, c.Names...)
	return &cp, nil
}

func (s *Store) GetTLSCertByZone(_ context.Context, zoneID uuid.UUID) (*models.TLSCert, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.tlsCerts {
		if c.ZoneID != nil && *c.ZoneID == zoneID {
			cp := *c
			cp.Names = append([]string{}, c.Names...)
			return &cp, nil
		}
	}
	return nil, store.ErrNotFound
}

func (s *Store) ListTLSCerts(_ context.Context) ([]models.TLSCert, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]models.TLSCert, 0, len(s.tlsCerts))
	for _, c := range s.tlsCerts {
		cp := *c
		cp.Names = append([]string{}, c.Names...)
		out = append(out, cp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (s *Store) UpdateTLSCert(_ context.Context, c *models.TLSCert) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tlsCerts[c.ID]; !ok {
		return store.ErrNotFound
	}
	cp := *c
	cp.Names = append([]string{}, c.Names...)
	s.tlsCerts[c.ID] = &cp
	return nil
}

func (s *Store) DeleteTLSCert(_ context.Context, id uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tlsCerts[id]; !ok {
		return store.ErrNotFound
	}
	delete(s.tlsCerts, id)
	return nil
}

func (s *Store) GetACMEAccount(_ context.Context) (*models.ACMEAccount, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.acmeAccount == nil {
		return nil, store.ErrNotFound
	}
	cp := *s.acmeAccount
	return &cp, nil
}

func (s *Store) SaveACMEAccount(_ context.Context, acc *models.ACMEAccount) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := *acc
	if cp.UpdatedAt.IsZero() {
		cp.UpdatedAt = time.Now()
	}
	s.acmeAccount = &cp
	return nil
}

