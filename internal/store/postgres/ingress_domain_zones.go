package postgres

import (
	"context"
	"strings"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

const zoneCols = `id,suffix,display_name,require_approval,enabled,allow_random,allow_custom_prefix,sort_order,created_at,updated_at`

func scanZone(row interface{ Scan(dest ...any) error }) (*models.IngressDomainZone, error) {
	z := &models.IngressDomainZone{}
	err := row.Scan(&z.ID, &z.Suffix, &z.DisplayName, &z.RequireApproval, &z.Enabled, &z.AllowRandom, &z.AllowCustomPrefix, &z.SortOrder, &z.CreatedAt, &z.UpdatedAt)
	if err != nil {
		return nil, mapErr(err)
	}
	return z, nil
}

func (s *Store) CreateIngressDomainZone(ctx context.Context, z *models.IngressDomainZone) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO ingress_domain_zones (`+zoneCols+`) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		z.ID, z.Suffix, z.DisplayName, z.RequireApproval, z.Enabled, z.AllowRandom, z.AllowCustomPrefix, z.SortOrder, z.CreatedAt, z.UpdatedAt)
	if err != nil {
		return store.ErrConflict
	}
	return nil
}

func (s *Store) GetIngressDomainZone(ctx context.Context, id uuid.UUID) (*models.IngressDomainZone, error) {
	return scanZone(s.db.QueryRowContext(ctx, `SELECT `+zoneCols+` FROM ingress_domain_zones WHERE id=$1`, id))
}

func (s *Store) GetIngressDomainZoneBySuffix(ctx context.Context, suffix string) (*models.IngressDomainZone, error) {
	return scanZone(s.db.QueryRowContext(ctx, `SELECT `+zoneCols+` FROM ingress_domain_zones WHERE lower(suffix)=lower($1)`, strings.TrimSpace(suffix)))
}

func (s *Store) ListIngressDomainZones(ctx context.Context) ([]models.IngressDomainZone, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+zoneCols+` FROM ingress_domain_zones ORDER BY sort_order ASC, created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.IngressDomainZone
	for rows.Next() {
		z, err := scanZone(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *z)
	}
	return out, rows.Err()
}

func (s *Store) UpdateIngressDomainZone(ctx context.Context, z *models.IngressDomainZone) error {
	res, err := s.db.ExecContext(ctx, `UPDATE ingress_domain_zones SET suffix=$2,display_name=$3,require_approval=$4,enabled=$5,allow_random=$6,allow_custom_prefix=$7,sort_order=$8,updated_at=$9 WHERE id=$1`,
		z.ID, z.Suffix, z.DisplayName, z.RequireApproval, z.Enabled, z.AllowRandom, z.AllowCustomPrefix, z.SortOrder, z.UpdatedAt)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
}

func (s *Store) DeleteIngressDomainZone(ctx context.Context, id uuid.UUID) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM ingress_domain_zones WHERE id=$1`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
}