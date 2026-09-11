package postgres

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func (s *Store) CreateDockerRegistry(ctx context.Context, r *models.DockerRegistry) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO docker_registries
		(id,name,server,username,password_enc,auto_inject,created_at,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		r.ID, r.Name, normalizeRegistryServer(r.Server), r.Username, r.PasswordEnc, r.AutoInject, r.CreatedAt, r.UpdatedAt)
	return mapErr(err)
}

func (s *Store) GetDockerRegistry(ctx context.Context, id uuid.UUID) (*models.DockerRegistry, error) {
	var r models.DockerRegistry
	err := s.db.QueryRowContext(ctx, `SELECT id,name,server,username,password_enc,auto_inject,created_at,updated_at
		FROM docker_registries WHERE id=$1`, id).
		Scan(&r.ID, &r.Name, &r.Server, &r.Username, &r.PasswordEnc, &r.AutoInject, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return nil, mapErr(err)
	}
	return &r, nil
}

func (s *Store) GetDockerRegistryByServer(ctx context.Context, server string) (*models.DockerRegistry, error) {
	var r models.DockerRegistry
	err := s.db.QueryRowContext(ctx, `SELECT id,name,server,username,password_enc,auto_inject,created_at,updated_at
		FROM docker_registries WHERE server=$1`, normalizeRegistryServer(server)).
		Scan(&r.ID, &r.Name, &r.Server, &r.Username, &r.PasswordEnc, &r.AutoInject, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return nil, mapErr(err)
	}
	return &r, nil
}

func (s *Store) ListDockerRegistries(ctx context.Context) ([]models.DockerRegistry, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,server,username,password_enc,auto_inject,created_at,updated_at
		FROM docker_registries ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.DockerRegistry
	for rows.Next() {
		var r models.DockerRegistry
		if err := rows.Scan(&r.ID, &r.Name, &r.Server, &r.Username, &r.PasswordEnc, &r.AutoInject, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) ListAutoInjectDockerRegistries(ctx context.Context) ([]models.DockerRegistry, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,server,username,password_enc,auto_inject,created_at,updated_at
		FROM docker_registries WHERE auto_inject=TRUE ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.DockerRegistry
	for rows.Next() {
		var r models.DockerRegistry
		if err := rows.Scan(&r.ID, &r.Name, &r.Server, &r.Username, &r.PasswordEnc, &r.AutoInject, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) UpdateDockerRegistry(ctx context.Context, r *models.DockerRegistry) error {
	r.UpdatedAt = time.Now()
	res, err := s.db.ExecContext(ctx, `UPDATE docker_registries SET
		name=$2, server=$3, username=$4, password_enc=$5, auto_inject=$6, updated_at=$7
		WHERE id=$1`,
		r.ID, r.Name, normalizeRegistryServer(r.Server), r.Username, r.PasswordEnc, r.AutoInject, r.UpdatedAt)
	if err != nil {
		return mapErr(err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
}

func (s *Store) DeleteDockerRegistry(ctx context.Context, id uuid.UUID) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM docker_registries WHERE id=$1`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
}

func normalizeRegistryServer(server string) string {
	s := strings.TrimSpace(server)
	s = strings.TrimPrefix(s, "https://")
	s = strings.TrimPrefix(s, "http://")
	s = strings.TrimSuffix(s, "/")
	return s
}
