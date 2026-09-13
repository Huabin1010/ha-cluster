#!/bin/bash
# Temporary nested-docker probe. Deletes ha-fuse-probe when done.
set -eu
CNAME="${1:-ha-fuse-probe}"
sudo -n incus delete "${CNAME}" --force 2>/dev/null || true
sudo -n incus launch ha-ubuntu-24.04 "${CNAME}" \
  --config security.nesting=true --storage ha-disk -d root,size=8GiB </dev/null
for i in $(seq 1 40); do
  sudo -n incus exec "${CNAME}" -- true >/dev/null 2>&1 && break
  sleep 1
done
sudo -n incus exec "${CNAME}" -- mkdir -p /tmp/ha-fuse-debs
shopt -s nullglob
for f in /var/lib/ha-cluster/workspace-debs/fuse-overlayfs_*.deb \
         /var/lib/ha-cluster/workspace-debs/libfuse*.deb \
         /var/lib/ha-cluster/workspace-debs/fuse3_*.deb; do
  sudo -n incus file push "${f}" "${CNAME}/tmp/ha-fuse-debs/$(basename "${f}")"
done
sudo -n incus exec "${CNAME}" --env DEBIAN_FRONTEND=noninteractive -- bash -s <<'EOS'
set -e
dpkg -i /tmp/ha-fuse-debs/*.deb >/tmp/ha-fuse-dpkg.log 2>&1 || true
command -v fuse-overlayfs
mkdir -p /etc/docker
printf '%s\n' '{"storage-driver":"fuse-overlayfs"}' > /etc/docker/daemon.json
systemctl unmask docker 2>/dev/null || true
systemctl enable --now docker 2>/dev/null || service docker start || true
systemctl restart docker
for i in $(seq 1 25); do
  if docker info >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
echo "DRIVER=$(docker info --format '{{.Driver}}')"
docker pull alpine:3.20
docker pull alpine:3.19
echo IMAGES
docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}'
echo "DU=$(du -sh /var/lib/docker | awk '{print $1}')"
if [ -d /var/lib/docker/fuse-overlayfs ]; then
  echo FUSE_DIR_OK
fi
if [ -d /var/lib/docker/vfs ]; then
  echo VFS_DIR_PRESENT
else
  echo VFS_DIR_ABSENT
fi
docker info 2>/dev/null | sed -n '/Storage Driver/,/Logging Driver/p'
EOS
sudo -n incus delete "${CNAME}" --force
echo TEST_DONE
