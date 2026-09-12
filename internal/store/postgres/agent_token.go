package postgres

import (
	"context"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func (s *Store) UpsertAgentToken(ctx context.Context, t *models.AgentToken) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO agent_tokens (id, user_id, token, prefix, created_at, last_used_at)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (user_id) DO UPDATE SET
			id = EXCLUDED.id,
			token = EXCLUDED.token,
			prefix = EXCLUDED.prefix,
			created_at = EXCLUDED.created_at,
			last_used_at = EXCLUDED.last_used_at`,
		t.ID, t.UserID, t.Token, t.Prefix, t.CreatedAt, t.LastUsedAt)
	return err
}

func (s *Store) GetAgentTokenByToken(ctx context.Context, token string) (*models.AgentToken, error) {
	return scanAgentToken(s.db.QueryRowContext(ctx,
		`SELECT id, user_id, token, prefix, created_at, last_used_at FROM agent_tokens WHERE token=$1`, token))
}

func (s *Store) GetAgentTokenByUser(ctx context.Context, userID uuid.UUID) (*models.AgentToken, error) {
	return scanAgentToken(s.db.QueryRowContext(ctx,
		`SELECT id, user_id, token, prefix, created_at, last_used_at FROM agent_tokens WHERE user_id=$1`, userID))
}

func (s *Store) TouchAgentToken(ctx context.Context, id uuid.UUID) error {
	_, err := s.db.ExecContext(ctx, `UPDATE agent_tokens SET last_used_at=$2 WHERE id=$1`, id, time.Now())
	return err
}

func (s *Store) DeleteAgentTokenByUser(ctx context.Context, userID uuid.UUID) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM agent_tokens WHERE user_id=$1`, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
}

func scanAgentToken(row interface{ Scan(dest ...any) error }) (*models.AgentToken, error) {
	var t models.AgentToken
	err := row.Scan(&t.ID, &t.UserID, &t.Token, &t.Prefix, &t.CreatedAt, &t.LastUsedAt)
	if err != nil {
		return nil, mapErr(err)
	}
	return &t, nil
}
