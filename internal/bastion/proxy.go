package bastion

import (
	"fmt"
	"io"
	"net"
	"time"
)

func DialProxy(addr string, in io.Reader, out io.Writer, timeout time.Duration) error {
	d := net.Dialer{Timeout: timeout}
	c, err := d.Dial("tcp", addr)
	if err != nil {
		return fmt.Errorf("dial %s: %w", addr, err)
	}
	defer c.Close()
	errc := make(chan error, 2)
	go func() {
		_, e := io.Copy(c, in)
		if tc, ok := c.(*net.TCPConn); ok {
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
