package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/agentpack"
	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func newAgentTokenSecret() (string, error) {
	var b [24]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return models.AgentTokenPrefix + hex.EncodeToString(b[:]), nil
}

func tokenPrefix(raw string) string {
	if len(raw) > 12 {
		return raw[:12]
	}
	return raw
}

// EnsureAgentToken returns the user's personal agent token, creating one if needed.
// rotate replaces the existing secret (old pack URLs stop working).
func (a *App) EnsureAgentToken(ctx context.Context, user models.User, rotate bool) (*models.AgentToken, bool, error) {
	if !rotate {
		if existing, err := a.Store.GetAgentTokenByUser(ctx, user.ID); err == nil && existing.Token != "" {
			return existing, false, nil
		} else if err != nil && !errors.Is(err, store.ErrNotFound) {
			return nil, false, err
		}
	}
	raw, err := newAgentTokenSecret()
	if err != nil {
		return nil, false, err
	}
	rec := &models.AgentToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		Token:     raw,
		Prefix:    tokenPrefix(raw),
		CreatedAt: time.Now(),
	}
	if err := a.Store.UpsertAgentToken(ctx, rec); err != nil {
		return nil, false, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID:  user.ID,
		Action:       "agent_token.issue",
		ResourceType: "user",
		ResourceID:   user.ID.String(),
		Meta:         map[string]any{"prefix": rec.Prefix, "rotate": rotate},
	})
	return rec, true, nil
}

func (a *App) LookupAgentUser(ctx context.Context, raw string) (*models.User, *models.AgentToken, error) {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, models.AgentTokenPrefix) {
		return nil, nil, store.ErrUnauthorized
	}
	tok, err := a.Store.GetAgentTokenByToken(ctx, raw)
	if err != nil {
		return nil, nil, store.ErrUnauthorized
	}
	u, err := a.Store.GetUserByID(ctx, tok.UserID)
	if err != nil || u.Status != models.UserActive {
		return nil, nil, store.ErrUnauthorized
	}
	go func() { _ = a.Store.TouchAgentToken(context.Background(), tok.ID) }()
	return u, tok, nil
}

func (a *App) BuildAgentPack(user models.User, rec *models.AgentToken, apiBase string) agentpack.Pack {
	if apiBase == "" {
		apiBase = agentpack.PublicAPIBase()
	}
	return agentpack.Build(user, rec.Token, apiBase)
}
