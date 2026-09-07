package bastion

import (
	"fmt"
	"io"
	"net"
	"os"
	"time"
)

type IdleTimeoutConn struct {
	net.Conn
	IdleTimeout time.Duration
}

func (c *IdleTimeoutConn) Read(b []byte) (int, error) {
	if c.IdleTimeout > 0 {
		_ = c.Conn.SetReadDeadline(time.Now().Add(c.IdleTimeout))
	}
	return c.Conn.Read(b)
}

func (c *IdleTimeoutConn) Write(b []byte) (int, error) {
	if c.IdleTimeout > 0 {
		_ = c.Conn.SetWriteDeadline(time.Now().Add(c.IdleTimeout))
	}
	return c.Conn.Write(b)
}

func DialProxy(addr string, in io.Reader, out io.Writer, dialTimeout time.Duration, idleTimeout ...time.Duration) error {
	d := net.Dialer{Timeout: dialTimeout}
	rawConn, err := d.Dial("tcp", addr)
	if err != nil {
		return fmt.Errorf("dial %s: %w", addr, err)
	}
	defer rawConn.Close()

	idle := 30 * time.Minute
	if len(idleTimeout) > 0 && idleTimeout[0] > 0 {
		idle = idleTimeout[0]
	} else if v := os.Getenv("HA_IDLE_TIMEOUT"); v != "" {
		if dur, e := time.ParseDuration(v); e == nil && dur > 0 {
			idle = dur
		}
	}

	c := &IdleTimeoutConn{Conn: rawConn, IdleTimeout: idle}
	if idle > 0 {
		_ = rawConn.SetDeadline(time.Now().Add(idle))
	}

	errc := make(chan error, 2)
	go func() {
		_, e := io.Copy(c, in)
		if tc, ok := rawConn.(*net.TCPConn); ok {
			_ = tc.CloseWrite()
		}
		errc <- e
	}()
	go func() {
		_, e := io.Copy(out, c)
		errc <- e
	}()
	<-errc
	<-errc
	return nil
}
