package api

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type loginLimiter struct {
	mu      sync.Mutex
	entries map[string]*limitEntry
}

type limitEntry struct {
	failures    int
	lockedUntil time.Time
	lastFail    time.Time
}

var globalLoginLimiter = newLoginLimiter()

func newLoginLimiter() *loginLimiter {
	return &loginLimiter{entries: map[string]*limitEntry{}}
}

const (
	loginMaxFailures  = 5
	loginLockDuration = 5 * time.Minute
	loginWindow       = 15 * time.Minute
)

func (l *loginLimiter) key(ip, username string) string {
	return ip + "|" + strings.ToLower(strings.TrimSpace(username))
}

func (l *loginLimiter) Allow(ip, username string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	k := l.key(ip, username)
	e := l.entries[k]
	if e == nil {
		return true
	}
	if now.Before(e.lockedUntil) {
		return false
	}
	if now.Sub(e.lastFail) > loginWindow {
		delete(l.entries, k)
		return true
	}
	return e.failures < loginMaxFailures
}

func (l *loginLimiter) RecordFailure(ip, username string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	k := l.key(ip, username)
	e := l.entries[k]
	if e == nil {
		e = &limitEntry{}
		l.entries[k] = e
	}
	now := time.Now()
	if now.Sub(e.lastFail) > loginWindow {
		e.failures = 0
	}
	e.failures++
	e.lastFail = now
	if e.failures >= loginMaxFailures {
		e.lockedUntil = now.Add(loginLockDuration)
	}
}

func (l *loginLimiter) RecordSuccess(ip, username string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.entries, l.key(ip, username))
}

func clientIPFromRequest(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if len(parts) > 0 {
			return strings.TrimSpace(parts[0])
		}
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
