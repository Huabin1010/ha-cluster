package authz

import "errors"

// ErrNotFound masks non-membership as missing resource (HTTP 404).
var ErrNotFound = errors.New("not found")

// ErrForbidden is member without sufficient permission (HTTP 403).
var ErrForbidden = errors.New("forbidden")
