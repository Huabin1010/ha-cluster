package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

const tlsCols = `id,name,names_json,zone_id,auto_renew,status,not_before,not_after,issuer,cert_pem,key_pem,last_error,last_issued_at,created_at,updated_at`

func scanTLS(row interface{ Scan(dest ...any) error }) (*models.TLSCert, error) {
	c := &models.TLSCert{}
	var namesJSON string
	var zone sql.NullString
	var nb, na, li sql.NullTime
	err := row.Scan(&c.ID, &c.Name, &namesJSON, &zone, &c.AutoRenew, &c.Status, &nb, &na, &c.Issuer, &c.CertPEM, &c.KeyPEM, &c.LastError, &li, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, mapErr(err)
	}
	_ = json.Unmarshal([]byte(namesJSON), &c.Names)
	if zone.Valid {
		if id, err := uuid.Parse(zone.String); err == nil {
			c.ZoneID = &id
		}
	}
	if nb.Valid {
		t := nb.Time
		c.NotBefore = &t
	}
	if na.Valid {
		t := na.Time
		c.NotAfter = &t
	}
	if li.Valid {
		t := li.Time
		c.LastIssuedAt = &t
	}
	return c, nil
}

func tlsArgs(c *models.TLSCert) []any {
	raw, _ := json.Marshal(c.Names)
	var zone any
	if c.ZoneID != nil {
		zone = c.ZoneID.String()
	}
	return []any{c.ID, c.Name, string(raw), zone, c.AutoRenew, c.Status, c.NotBefore, c.NotAfter, c.Issuer, c.CertPEM, c.KeyPEM, c.LastError, c.LastIssuedAt, c.CreatedAt, c.UpdatedAt}
}

func (s *Store) CreateTLSCert(ctx context.Context, c *models.TLSCert) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO tls_certs (`+tlsCols+`) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, tlsArgs(c)...)
	if err != nil {
		return store.ErrConflict
	}
	return nil
}

func (s *Store) GetTLSCert(ctx context.Context, id uuid.UUID) (*models.TLSCert, error) {
	return scanTLS(s.db.QueryRowContext(ctx, `SELECT `+tlsCols+` FROM tls_certs WHERE id=$1`, id))
}

func (s *Store) GetTLSCertByZone(ctx context.Context, zoneID uuid.UUID) (*models.TLSCert, error) {
	return scanTLS(s.db.QueryRowContext(ctx, `SELECT `+tlsCols+` FROM tls_certs WHERE zone_id=$1`, zoneID))
}

func (s *Store) ListTLSCerts(ctx context.Context) ([]models.TLSCert, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+tlsCols+` FROM tls_certs ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.TLSCert
	for rows.Next() {
		c, err := scanTLS(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

func (s *Store) UpdateTLSCert(ctx context.Context, c *models.TLSCert) error {
	args := tlsArgs(c)
	// $1=id … $13=last_issued_at, $14=updated_at（跳过 created_at）
	res, err := s.db.ExecContext(ctx, `UPDATE tls_certs SET name=$2,names_json=$3,zone_id=$4,auto_renew=$5,status=$6,not_before=$7,not_after=$8,issuer=$9,cert_pem=$10,key_pem=$11,last_error=$12,last_issued_at=$13,updated_at=$14 WHERE id=$1`,
		args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7], args[8], args[9], args[10], args[11], args[12], args[14])
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
}

func (s *Store) DeleteTLSCert(ctx context.Context, id uuid.UUID) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM tls_certs WHERE id=$1`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
}

func (s *Store) GetACMEAccount(ctx context.Context) (*models.ACMEAccount, error) {
	acc := &models.ACMEAccount{}
	err := s.db.QueryRowContext(ctx, `SELECT directory,email,key_pem,account_url,updated_at FROM tls_acme_account WHERE id=1`).
		Scan(&acc.Directory, &acc.Email, &acc.KeyPEM, &acc.URL, &acc.UpdatedAt)
	if err != nil {
		return nil, mapErr(err)
	}
	return acc, nil
}

func (s *Store) SaveACMEAccount(ctx context.Context, acc *models.ACMEAccount) error {
	if acc.UpdatedAt.IsZero() {
		acc.UpdatedAt = time.Now()
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO tls_acme_account (id,directory,email,key_pem,account_url,updated_at)
VALUES (1,$1,$2,$3,$4,$5)
ON CONFLICT (id) DO UPDATE SET directory=$1,email=$2,key_pem=$3,account_url=$4,updated_at=$5`,
		acc.Directory, acc.Email, acc.KeyPEM, acc.URL, acc.UpdatedAt)
	return err
}
