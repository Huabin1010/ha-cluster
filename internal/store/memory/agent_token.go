package memory

import (
	"context"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func (s *Store) UpsertAgentToken(_ context.Context, t *models.AgentToken) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.agentTokens == nil {
		s.agentTokens = map[uuid.UUID]*models.AgentToken{}
	}
	cp := *t
	s.agentTokens[t.UserID] = &cp
	return nil
}

func (s *Store) GetAgentTokenByToken(_ context.Context, token string) (*models.AgentToken, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.agentTokens {
		if t.Token == token {
			cp := *t
			return &cp, nil
		}
	}
	return nil, store.ErrNotFound
}

func (s *Store) GetAgentTokenByUser(_ context.Context, userID uuid.UUID) (*models.AgentToken, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.agentTokens[userID]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := *t
	return &cp, nil
}

func (s *Store) TouchAgentToken(_ context.Context, id uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for _, t := range s.agentTokens {
		if t.ID == id {
			t.LastUsedAt = &now
			return nil
		}
	}
	return store.ErrNotFound
}

func (s *Store) DeleteAgentTokenByUser(_ context.Context, userID uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.agentTokens[userID]; !ok {
		return store.ErrNotFound
	}
	delete(s.agentTokens, userID)
	return nil
}
