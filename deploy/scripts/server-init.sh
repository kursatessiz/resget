#!/usr/bin/env bash
# ==============================================================================
# Resget - Ubuntu 24.04 server bootstrap (preprod or production)
# Target: 6 GB RAM / 4 vCPU / 60 GB SSD
#
# Usage (as root, or with sudo from your own admin account):
#   sudo DEPLOY_SSH_PUBKEY="ssh-ed25519 AAAA... ci-deploy" TIMEZONE=UTC \
#     bash server-init.sh [deploy-user]
#
#   deploy-user        non-root account CI deploys as (default: deploy, or $DEPLOY_USER)
#   DEPLOY_SSH_PUBKEY  public key allowed to log in as the deploy user (optional;
#                      can also be added by hand to ~deploy/.ssh/authorized_keys)
#   TIMEZONE           host timezone (default: UTC; every restaurant keeps its
#                      own timezone in the database)
#
# Idempotent: safe to run again, e.g. after adding the deploy key.
# SSH hardening only happens once key-based access is confirmed; otherwise
# the script prints what is missing and leaves SSH as it is.
# ==============================================================================

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (or with sudo)." >&2
  exit 1
fi

DEPLOY_USER="${1:-${DEPLOY_USER:-deploy}}"
TIMEZONE="${TIMEZONE:-UTC}"
APP_DIR=/opt/resget
# The account the operator used to get here (sudo), if any.
ADMIN_USER="${SUDO_USER:-}"

if ! [[ "${DEPLOY_USER}" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || [ "${DEPLOY_USER}" = root ]; then
  echo "Invalid deploy user name: ${DEPLOY_USER}" >&2
  exit 2
fi
if [ ! -e "/usr/share/zoneinfo/${TIMEZONE}" ]; then
  echo "Unknown timezone: ${TIMEZONE}" >&2
  exit 2
fi

echo "======================================================================"
echo "Server bootstrap (deploy user: ${DEPLOY_USER}, timezone: ${TIMEZONE})"
echo "======================================================================"

# 1. Packages
echo "Updating APT packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get upgrade -y
apt-get install -y curl wget git ufw fail2ban ca-certificates gnupg lsb-release htop jq

# 2. 4 GB swap (vital for 6 GB RAM stability)
if [ ! -f /swapfile ]; then
  echo "Creating 4GB swap file..."
  fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
cat > /etc/sysctl.d/60-resget-memory.conf <<'SYSCTL'
vm.swappiness=10
vm.vfs_cache_pressure=50
SYSCTL
sysctl --system >/dev/null

# 3. Firewall: SSH, HTTP, HTTPS (+HTTP/3) only. PostgreSQL and Redis stay on
# Docker's internal network and are never published.
echo "Configuring UFW..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP Caddy'
ufw allow 443/tcp comment 'HTTPS Caddy'
ufw allow 443/udp comment 'HTTP/3 QUIC'
ufw --force enable
ufw status verbose

# 4. Fail2ban for SSH brute-force protection
systemctl enable --now fail2ban

# 5. Docker Engine and Compose plugin (official APT repository)
if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker Engine..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# Container log rotation (json-file). Applies to containers created after
# the change; deploy.sh recreates api/web on every release.
DAEMON_JSON=/etc/docker/daemon.json
LOG_OPTS='{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"5"}}'
mkdir -p /etc/docker
CURRENT_JSON='{}'
[ -s "${DAEMON_JSON}" ] && CURRENT_JSON="$(cat "${DAEMON_JSON}")"
MERGED_JSON="$(jq -S --argjson add "${LOG_OPTS}" '. * $add' <<<"${CURRENT_JSON}")"
if [ "$(jq -S . <<<"${CURRENT_JSON}")" != "${MERGED_JSON}" ]; then
  echo "Configuring Docker log rotation (10m x 5 per container)..."
  printf '%s\n' "${MERGED_JSON}" > "${DAEMON_JSON}"
  systemctl restart docker
fi
systemctl enable --now docker

# 6. Deploy user: owns /opt/resget, may run docker, logs in with an SSH key only.
if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  echo "Creating deploy user ${DEPLOY_USER}..."
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi
usermod -aG docker "${DEPLOY_USER}"
DEPLOY_HOME="$(getent passwd "${DEPLOY_USER}" | cut -d: -f6)"
AUTH_KEYS="${DEPLOY_HOME}/.ssh/authorized_keys"
install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${DEPLOY_HOME}/.ssh"
touch "${AUTH_KEYS}"
if [ -n "${DEPLOY_SSH_PUBKEY:-}" ]; then
  if ! [[ "${DEPLOY_SSH_PUBKEY}" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp[0-9]+|sk-ssh-ed25519@openssh.com)\ [A-Za-z0-9+/=]+ ]]; then
    echo "DEPLOY_SSH_PUBKEY does not look like an OpenSSH public key; not added." >&2
  elif ! grep -qxF "${DEPLOY_SSH_PUBKEY}" "${AUTH_KEYS}"; then
    printf '%s\n' "${DEPLOY_SSH_PUBKEY}" >> "${AUTH_KEYS}"
    echo "Deploy key added to ${AUTH_KEYS}."
  fi
fi
chown "${DEPLOY_USER}:${DEPLOY_USER}" "${AUTH_KEYS}"
chmod 600 "${AUTH_KEYS}"

# 7. Deployment directories, owned by the deploy user (deploy.sh, backups,
# releases and the deploy log are all written as that user).
mkdir -p "${APP_DIR}/caddy" "${APP_DIR}/backups" "${APP_DIR}/scripts" "${APP_DIR}/releases"
touch "${APP_DIR}/deploy.log"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}"
chmod 700 "${APP_DIR}/backups"

# Daily host-side database backup at 02:30 (local rotation plus encrypted
# off-site copy when BACKUP_S3_BUCKET is set in /opt/resget/.env). Runs as the
# deploy user so its files stay writable for deploy.sh's pre-deploy backup.
cat > /etc/cron.d/resget-backup <<CRON
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 2 * * * ${DEPLOY_USER} ${APP_DIR}/scripts/backup.sh >> ${APP_DIR}/deploy.log 2>&1
CRON
chmod 644 /etc/cron.d/resget-backup

# 8. Timezone (UTC by default: restaurants keep their own timezone in the database)
timedatectl set-timezone "${TIMEZONE}"

# 9. SSH hardening, only once key-based access is confirmed.
has_key() { [ -f "$1" ] && grep -Eq '^(ssh-|ecdsa-|sk-)' "$1"; }
admin_ok=0
if [ -n "${ADMIN_USER}" ] && [ "${ADMIN_USER}" != root ] && [ "${ADMIN_USER}" != "${DEPLOY_USER}" ] \
  && id -nG "${ADMIN_USER}" | tr ' ' '\n' | grep -qx sudo; then
  ADMIN_HOME="$(getent passwd "${ADMIN_USER}" | cut -d: -f6)"
  has_key "${ADMIN_HOME}/.ssh/authorized_keys" && admin_ok=1
fi
root_key_ok=0
has_key /root/.ssh/authorized_keys && root_key_ok=1

HARDENING=/etc/ssh/sshd_config.d/05-resget-hardening.conf
if ! has_key "${AUTH_KEYS}"; then
  echo "----------------------------------------------------------------------"
  echo "SSH NOT hardened: ${DEPLOY_USER} has no authorized key yet."
  echo "Add the CI deploy public key to ${AUTH_KEYS}"
  echo "(or rerun with DEPLOY_SSH_PUBKEY=...), then run this script again."
  echo "----------------------------------------------------------------------"
elif [ "${admin_ok}" -eq 0 ] && [ "${root_key_ok}" -eq 0 ]; then
  echo "----------------------------------------------------------------------"
  echo "SSH NOT hardened: no key-based admin login was found (neither root's"
  echo "authorized_keys nor a sudo user running this script). Disabling"
  echo "passwords now could lock you out. Add your own public key to"
  echo "/root/.ssh/authorized_keys or to a sudo user, then run this again."
  echo "----------------------------------------------------------------------"
else
  # Root keeps key-only login unless a separate sudo admin with a key exists.
  ROOT_LOGIN=prohibit-password
  [ "${admin_ok}" -eq 1 ] && ROOT_LOGIN=no
  # 05- sorts before cloud-init's 50-cloud-init.conf; sshd uses the first value it reads.
  cat > "${HARDENING}.tmp" <<SSHD
# Managed by deploy/scripts/server-init.sh
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin ${ROOT_LOGIN}
SSHD
  mv "${HARDENING}.tmp" "${HARDENING}"
  if sshd -t; then
    systemctl reload ssh
    echo "SSH hardened: passwords off, root login ${ROOT_LOGIN}."
    if [ "${ROOT_LOGIN}" != no ]; then
      echo "Root can still log in with a key. To turn root login off, create a sudo"
      echo "user with your key and run this script again via sudo from that user."
    fi
  else
    rm -f "${HARDENING}"
    echo "sshd rejected the hardening config; it was removed and SSH is unchanged." >&2
  fi
fi

echo "======================================================================"
echo "Server bootstrap completed."
echo "   - Deploy user: ${DEPLOY_USER} (docker group, owns ${APP_DIR})"
echo "   - Swap: 4GB, firewall: 22/80/443, fail2ban, Docker with log rotation"
echo "   - Timezone: ${TIMEZONE}"
echo "Next: put ${APP_DIR}/.env in place (see .env.example), log in to GHCR as"
echo "${DEPLOY_USER} if the images are private, and follow docs/CICD_GUIDE.md."
echo "======================================================================"
