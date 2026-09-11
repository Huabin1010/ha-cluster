package requestmeta

import "context"

type ctxKey int

const clientIPKey ctxKey = 1

func WithClientIP(ctx context.Context, ip string) context.Context {
	if ip == "" {
		return ctx
	}
	return context.WithValue(ctx, clientIPKey, ip)
}

func ClientIP(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	s, _ := ctx.Value(clientIPKey).(string)
	return s
}
